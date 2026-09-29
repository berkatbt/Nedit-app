def _to_lrc_time(seconds: float) -> str:
    mm = int(seconds // 60)
    ss = seconds % 60
    return f"[{mm:02d}:{ss:05.2f}]"

def build_lrc(segments: list) -> str:
    lines = []
    for seg in segments:
        text = seg["text"].strip()
        if not text:
            continue
        lines.append(f"{_to_lrc_time(seg['start'])}{text}")
    return "\n".join(lines)