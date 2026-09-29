"""Pisahkan stem vokal dari musik memakai Demucs.

Whisper jauh lebih akurat kalau yang didengar hanya vokal. Pada lagu, musik dan
drum masuk ke mikrofon model dan menutupi suku kata — di sinilah typo dan baris
yang salah paling sering muncul.

Modul ini bersifat opsional: kalau Demucs tidak terpasang atau gagal, pemanggil
tetap lanjut memakai audio asli.
"""

import uuid
from pathlib import Path

from app.config import settings

_separator = None
_last_error = None


def available() -> bool:
    """Demucs + soundfile siap dipakai?"""
    try:
        import demucs.api  # noqa: F401
        import soundfile  # noqa: F401
    except Exception:
        return False
    return True


def last_error() -> str | None:
    return _last_error


def _device() -> str:
    if str(settings.device).lower() == "cpu":
        return "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _get_separator():
    global _separator
    if _separator is None:
        from demucs.api import Separator

        device = _device()
        print(f"[Demucs] Memuat model={settings.demucs_model} device={device}", flush=True)
        _separator = Separator(model=settings.demucs_model, device=device, progress=False)
    return _separator


def extract_vocals(path: str) -> str | None:
    """
    Tulis vokal (tanpa musik) ke file WAV sementara.

    Return path WAV, atau None kalau pemisahan tidak diaktifkan / gagal —
    dalam hal itu pemanggil harus memakai audio aslinya.
    """
    global _last_error

    if not settings.separate_vocals:
        return None

    if not available():
        _last_error = "demucs belum terpasang"
        print("[Demucs] Dilewati: demucs belum terpasang.", flush=True)
        return None

    try:
        import soundfile as sf

        separator = _get_separator()
        print(f"[Demucs] Memisahkan vokal dari: {path}", flush=True)

        _, stems = separator.separate_audio_file(Path(path))
        vocals = stems.get("vocals")
        if vocals is None:
            _last_error = "stem vokal tidak ada di hasil Demucs"
            print("[Demucs] Dilewati: stem vokal tidak ditemukan.", flush=True)
            return None

        settings.temp_path.mkdir(parents=True, exist_ok=True)
        out_path = settings.temp_path / f"vocals_{uuid.uuid4().hex}.wav"

        # Demucs mengembalikan tensor (channel, sample); soundfile minta (sample, channel)
        sf.write(str(out_path), vocals.cpu().numpy().T, separator.samplerate)

        print(f"[Demucs] Vokal siap: {out_path}", flush=True)
        return str(out_path)

    except Exception as e:
        _last_error = str(e)
        print(f"[Demucs] Gagal memisahkan vokal, lanjut pakai audio asli: {e}", flush=True)
        return None
