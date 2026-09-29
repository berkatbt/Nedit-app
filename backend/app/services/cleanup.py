"""Bersihkan hasil Whisper dari sampah khas lagu.

Yang dibuang:
- segmen yang isinya cuma tanda musik (♪, [Musik], (intro), dst.)
- kalimat penutup khas Whisper ("Terima kasih telah menonton", "Subtitle by", ...)
- loop: 3 segmen identik berturut-turut atau lebih (Whisper sering mengulang
  satu baris terus-menerus di bagian instrumental)
"""

import re

NOISE_PATTERNS = [
    re.compile(r"^[\s♪♫\-–—_\.\*·]+$"),
    re.compile(
        r"^[\[\(]?\s*(musik|music|instrumental|interlude|intro|outro|reff|chorus|verse|"
        r"tanpa vokal|no vocal)\s*[\]\)]?\s*:?$",
        re.I,
    ),
    re.compile(r"terima kasih (telah|sudah)? ?(menonton|mendengarkan)", re.I),
    re.compile(r"thank you for watching", re.I),
    re.compile(r"(subscribe|like and share|subtitle|caption|transcri(be|pt)) (by|oleh|:)"),
    re.compile(r"^\s*www\.\S+\s*$", re.I),
    re.compile(r"amara\.org", re.I),
    # segmen yang isinya hanya tanda dalam kurung, mis. "[Musik]", "(x2)"
    re.compile(r"^[\[\(].{0,40}[\]\)][\.\?\!]?$"),
]

# berapa kali segmen identik berturut-turut yang masih dianggap lirik asli
MAX_REPEAT = 2


def clean_text(text: str) -> str:
    t = re.sub(r"\s+", " ", (text or "")).strip()
    t = t.strip("♪♫*_ ")
    t = re.sub(r"\s+([,.!?;:])", r"\1", t)
    return t.strip()


def is_noise(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return True
    return any(pattern.search(t) for pattern in NOISE_PATTERNS)


def _key(text: str) -> str:
    return re.sub(r"[^\w]", "", text.lower())


def clean_segments(segments: list) -> list:
    """Buang segmen sampah + loop, rapikan spasi."""
    kept = []
    for seg in segments:
        text = clean_text(seg.get("text"))
        if is_noise(text):
            continue
        kept.append({**seg, "text": text})

    result = []
    for seg in kept:
        key = _key(seg["text"])
        repeat = 1
        for previous in reversed(result):
            if _key(previous["text"]) == key:
                repeat += 1
            else:
                break
        if repeat > MAX_REPEAT:
            continue  # bagian dari loop, bukan lirik
        result.append(seg)

    return result
