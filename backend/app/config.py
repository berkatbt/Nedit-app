from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root: backend/app/config.py -> app -> backend -> root
BASE_DIR = Path(__file__).resolve().parents[2]

# Path absolut: server bisa dijalankan dari folder mana pun dan .env tetap terbaca
ENV_FILE = BASE_DIR / "backend" / ".env"


class Settings(BaseSettings):
    # "auto" = pakai GPU kalau ada, otomatis turun ke CPU kalau tidak
    device: str = "auto"
    whisper_model: str = "large-v3"
    language: str = "id"
    temp_dir: str = "temp"
    model_dir: str = "models"
    output_dir: str = "output"
    max_duration: int = 600

    # Pisahkan vokal dari musik (Demucs) sebelum transkripsi — akurasi jauh lebih baik
    separate_vocals: bool = True
    demucs_model: str = "htdemucs"
    # Biarkan KOSONG. Diuji pada lagu asli: memberi prompt (walau pendek)
    # membuat Whisper berhenti dini — satu lagu 3,5 menit hanya jadi 2 segmen
    # (tanpa prompt: 21 segmen). Isi hanya kalau kamu memang tahu risikonya.
    initial_prompt: str = ""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        protected_namespaces=(),   # "model_dir" bukan field pydantic internal
    )

    @property
    def temp_path(self) -> Path:
        return BASE_DIR / self.temp_dir

    @property
    def model_path(self) -> Path:
        return BASE_DIR / self.model_dir

    @property
    def output_path(self) -> Path:
        return BASE_DIR / self.output_dir

settings = Settings()