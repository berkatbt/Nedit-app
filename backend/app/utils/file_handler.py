import os, shutil, uuid
from fastapi import UploadFile
from app.config import settings

ALLOWED_EXT = {".mp3", ".wav", ".m4a"}

def is_allowed(filename: str | None) -> bool:
    return os.path.splitext(filename or "")[1].lower() in ALLOWED_EXT

async def save_upload(file: UploadFile) -> str:
    temp_dir = settings.temp_path
    temp_dir.mkdir(parents=True, exist_ok=True)

    ext = os.path.splitext(file.filename or "")[1].lower() or ".mp3"
    path = temp_dir / f"{uuid.uuid4().hex}{ext}"
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return str(path)

def remove_upload(path: str | None) -> None:
    """Hapus file temp; file yang sudah tidak ada diabaikan."""
    if not path:
        return
    try:
        os.remove(path)
    except OSError:
        pass