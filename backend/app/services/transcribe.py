from faster_whisper import WhisperModel
from app.config import settings

# Cache model — load sekali saja
_model = None
_model_key = None


def _device_candidates(preferred: str) -> list:
    """
    Urutan device yang dicoba.

    "cpu"  -> hanya CPU
    "cuda" -> CUDA dulu, kalau gagal (tidak ada GPU / driver tidak cocok) turun ke CPU
    "auto" -> sama seperti di atas, tanpa perlu tahu mesinnya punya GPU atau tidak
    """
    preferred = (preferred or "auto").strip().lower()
    if preferred == "cpu":
        return ["cpu"]
    return ["cuda", "cpu"]


def cached_models() -> list:
    """Model faster-whisper yang sudah ada di folder cache lokal."""
    root = settings.model_path
    if not root.is_dir():
        return []
    prefix = "models--Systran--faster-whisper-"
    return sorted(
        entry.name[len(prefix):]
        for entry in root.iterdir()
        if entry.is_dir() and entry.name.startswith(prefix)
    )


def _load_error(err: Exception) -> RuntimeError:
    cached = cached_models()
    local = ", ".join(cached) if cached else "(kosong)"
    return RuntimeError(
        f"Model '{settings.whisper_model}' tidak bisa dimuat: {err}. "
        f"Model yang sudah ada di cache lokal: {local}. "
        f"Set WHISPER_MODEL di backend/.env ke salah satu model di atas, "
        f"atau sambungkan internet supaya model bisa diunduh."
    )


def _get_model():
    global _model, _model_key

    if _model is not None and _model_key == settings.whisper_model:
        return _model

    last_err = None
    for device in _device_candidates(settings.device):
        # compute_type: "float16" (GPU) / "int8" (CPU)
        compute_type = "float16" if device == "cuda" else "int8"

        print(f"[Whisper] Loading model={settings.whisper_model} "
              f"device={device} compute={compute_type}", flush=True)

        try:
            _model = WhisperModel(
                settings.whisper_model,
                device=device,
                compute_type=compute_type,
                download_root=str(settings.model_path)   # cache di folder project
            )
        except Exception as e:
            last_err = e
            print(f"[Whisper] Gagal load di {device}: {e}", flush=True)
            if device == "cuda":
                print("[Whisper] GPU CUDA tidak bisa dipakai - lanjut pakai CPU "
                      "(lebih lambat).", flush=True)
                continue
            raise _load_error(e) from e

        _model_key = settings.whisper_model
        return _model

    raise _load_error(last_err)


def transcribe_audio(path: str, prompt: str | None = None) -> list:
    """
    Return list of segments:
    [
      {"start": 0.0, "end": 3.5, "text": "lirik baris 1", "words": [...]},
      ...
    ]

    prompt: petunjuk tambahan untuk Whisper (opsional). Biarkan kosong supaya
    dipakai nilai INITIAL_PROMPT di backend/.env.
    """
    model = _get_model()

    print(f"[Whisper] Transcribing: {path}", flush=True)

    try:
        result = _run(model, path, prompt)
    except Exception as e:
        # errornya biasanya dari decoder: file bukan audio, terpotong, atau rusak
        raise RuntimeError(
            f"File audio tidak bisa diproses ({e}). "
            "Pastikan filenya benar-benar audio MP3/WAV/M4A yang tidak rusak."
        ) from e

    print(f"[Whisper] Done - {len(result)} segments", flush=True)
    return result


def _run(model, path: str, prompt: str | None = None) -> list:
    segments_iter, info = model.transcribe(
        path,
        language=settings.language,        # "id" untuk Indonesia
        beam_size=5,
        # temperatur bertingkat: kalau hasil di 0.0 kurang bagus (sering terjadi
        # di lagu), Whisper mencoba ulang dengan temperatur lebih tinggi
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
        no_speech_threshold=0.6,
        # PENTING untuk lagu: tanpa ini Whisper menyambung lirik baris sebelumnya
        # dan mengulang-ulang baris yang sama di bagian instrumental
        condition_on_previous_text=False,
        # Jangan diisi untuk lagu: prompt (walau cuma satu kalimat pendek)
        # membuat Whisper menganggap transkripnya sudah selesai dan berhenti
        # dini. Terukur di sini: 2 segmen dengan prompt vs 21 tanpa prompt.
        initial_prompt=(prompt or settings.initial_prompt or None),
        vad_filter=True,                   # skip bagian hening
        # Silero VAD dilatih untuk suara bicara, jadi di lagu parameternya
        # dilonggarkan supaya baris yang dinyanyikan tidak ikut terpotong
        vad_parameters=dict(min_silence_duration_ms=2000, speech_pad_ms=400),
        word_timestamps=True,              # AKTIFKAN word-level
        hallucination_silence_threshold=2.0,
    )

    print(f"[Whisper] Detected language: {info.language} "
          f"(prob={info.language_probability:.2f})", flush=True)

    result = []
    for seg in segments_iter:
        words = []
        if seg.words:
            words = [
                {
                    "word": w.word.strip(),
                    "start": round(w.start, 2),
                    "end": round(w.end, 2),
                }
                for w in seg.words
            ]

        result.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
            "words": words,
        })

    return result


if __name__ == "__main__":  # pragma: no cover - helper debug
    print("device setting:", settings.device)
    print("model setting :", settings.whisper_model)
    print("model cache   :", settings.model_path)
    print("models found  :", cached_models())