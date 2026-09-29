# Cara Menjalankan Project

Project ini menggunakan virtual environment di folder `.venv` dan disarankan memakai Python 3.12.

## 1) Buat environment baru (jika belum ada)

```powershell
cd C:\berkat_bt\musik_lirik
py -3.12 -m venv .venv
```

## 2) Aktifkan environment

```powershell
cd C:\berkat_bt\musik_lirik
.\.venv\Scripts\Activate.ps1
```

## 3) Install dependency

```powershell
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
```

## 4) Jalankan aplikasi

```powershell
python run.py
```

Aplikasi akan berjalan di:

```text
http://localhost:8002
```

## Catatan penting

- Jangan menggunakan Python 3.14 untuk project ini karena beberapa dependency gagal build di versi itu.
- Pakai hanya `.venv` yang ada di root project.
- Jika terminal sudah terbuka lama, tutup lalu buka terminal baru agar environment yang aktif ter-refresh.
- Jika ada error `ModuleNotFoundError: No module named 'uvicorn'`, berarti environment belum diaktifkan atau dependency belum terinstall.
