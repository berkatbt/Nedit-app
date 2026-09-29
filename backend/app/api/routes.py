from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.concurrency import run_in_threadpool
from app.config import settings
from app.services.transcribe import transcribe_audio
from app.services.lrc_builder import build_lrc
from app.services.cleanup import clean_segments
from app.services.align import clean_reference_lines, build_from_reference
from app.services.vocals import extract_vocals, available as demucs_ready, last_error as demucs_error
from app.utils.file_handler import save_upload, remove_upload, is_allowed
import traceback

router = APIRouter()

@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    lyrics: str | None = Form(None),
    separate_vocals: bool = Form(True),
):
    # Validasi: cek MIME atau ekstensi (sebagian browser salah kirim MIME)
    content_type = file.content_type or ""
    if not content_type.startswith("audio") and not is_allowed(file.filename):
        raise HTTPException(400, "File harus berupa audio (mp3/wav/m4a)")

    path = None
    vocal_path = None
    try:
        path = await save_upload(file)
        print(f"[API] File saved: {path}", flush=True)

        # 1. Pisahkan vokal dulu supaya musik tidak menutupi suku kata yang dinyanyikan
        # Kedua langkah di bawah memakai CPU lama; jalankan di threadpool supaya
        # event loop tetap bebas dan server tidak ikut membeku (halaman tidak bisa
        # dimuat ulang selama transkripsi berjalan kalau dijalankan langsung).
        if separate_vocals and settings.separate_vocals:
            vocal_path = await run_in_threadpool(extract_vocals, path)
        source = vocal_path or path
        vocals_used = vocal_path is not None

        # 2. Lirik asli dari user (kalau ada): teksnya jadi acuan, AI hanya mengisi waktu
        reference = clean_reference_lines(lyrics) if lyrics else []
        if reference:
            print(f"[API] Lirik asli dipakai: {len(reference)} baris", flush=True)

        # Catatan: lirik asli SENGAJA tidak dipakai sebagai initial_prompt.
        # Prompt sepanjang lirik membuat Whisper menganggap dirinya sudah
        # menuliskan semuanya dan berhenti dini (pernah kejadian: satu lagu
        # 3,5 menit hanya menghasilkan 2 segmen). Lirik asli hanya dipakai
        # setelahnya, untuk mengganti teks hasil ASR.
        segments = await run_in_threadpool(transcribe_audio, source)
        asr_end = segments[-1]["end"] if segments else None

        mode = "ai"
        estimated = []
        if reference:
            aligned, estimated = build_from_reference(reference, segments, asr_end)
            if aligned:
                segments = aligned
                mode = "reference"
                if estimated:
                    print(f"[API] {len(estimated)} baris waktunya diperkirakan", flush=True)
            else:
                print("[API] Lirik asli kosong, pakai hasil AI", flush=True)

        if mode == "ai":
            before = len(segments)
            segments = clean_segments(segments)
            if before != len(segments):
                print(f"[API] {before - len(segments)} segmen sampah dibuang", flush=True)

        print(f"[API] Got {len(segments)} segments "
              f"(mode={mode}, vocals={vocals_used})", flush=True)

        return {
            "lrc": build_lrc(segments),
            "segments": segments,
            "mode": mode,
            "vocals": vocals_used,
            "estimated": estimated,
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Transkripsi gagal: {str(e)}")

    finally:
        remove_upload(path)
        remove_upload(vocal_path)

@router.get("/health")
async def health():
    return {
        "status": "ok",
        "device": settings.device,
        "model": settings.whisper_model,
        "separation": bool(settings.separate_vocals and demucs_ready()),
        "separation_error": demucs_error(),
    }