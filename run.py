import sys
from pathlib import Path

import uvicorn

BACKEND_DIR = Path(__file__).resolve().parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8002,
        reload=True,
        # Folder data tidak berisi kode; kalau ikut dipantau, transkripsi yang
        # sedang berjalan bisa mati hanya karena file temp/model berubah.
        reload_excludes=[
            "temp", "temp/*",
            "models", "models/*",
            "output", "output/*",
            "uploads", "uploads/*",
        ],
    )