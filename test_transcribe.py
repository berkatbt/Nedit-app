from backend.app.services.transcribe import transcribe_audio
from backend.app.services.lrc_builder import build_lrc

# Ganti dengan path MP3 kamu
path = "test.mp3"

print("Mulai transkripsi...")
segments = transcribe_audio(path)
print(f"\nHasil: {len(segments)} segmen\n")

for s in segments[:10]:
    print(f"[{s['start']:.2f} - {s['end']:.2f}] {s['text']}")

print("\n--- LRC ---")
print(build_lrc(segments))