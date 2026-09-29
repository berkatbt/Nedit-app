"""Selaraskan lirik asli milik user ke waktu hasil transkripsi.

Ide dasarnya: AI bagus untuk menemukan *kapan* sesuatu dinyanyikan, tapi sering
salah menuliskan *apa* yang dinyanyikan (typo, kata tertukar, bahasa salah).
Kalau user menempelkan lirik resminya, kita pakai teks user sebagai kebenaran
dan pakai hasil AI hanya untuk menentukan waktunya.

Caranya: token lirik user dan token hasil AI disejajarkan secara monoton
(Needleman-Wunsch sederhana). Setelah sejajar, waktu mulai tiap baris lirik
diambil dari waktu token AI yang berpasangan dengannya.
"""

import re
import unicodedata
from difflib import SequenceMatcher

# baris penanda seperti [Chorus], (x2), [Interlude]
MARKER_RE = re.compile(r"^[\[\(].{0,40}[\]\)][\.\?\!]?$")

MATCH_SCORE = 2.0
FUZZY_SCORE = 1.0
MISMATCH_SCORE = -1.0
GAP_REF = -1.0     # token lirik user yang tidak ditemukan di audio
GAP_HYP = -0.4     # token AI yang tidak ada padanannya di lirik user
FUZZY_RATIO = 0.8


def norm_tokens(text: str) -> list:
    text = unicodedata.normalize("NFKC", text or "").lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return [t for t in text.split() if t]


def clean_reference_lines(text: str) -> list:
    """Buang baris kosong dan baris penanda; sisakan baris lirik yang punya kata."""
    lines = []
    for raw in (text or "").replace("\r", "\n").split("\n"):
        line = re.sub(r"\s+", " ", raw).strip()
        if not line or MARKER_RE.match(line):
            continue
        if not norm_tokens(line):
            continue
        lines.append(line)
    return lines


def _fuzzy_pairs(ref: list, hyp: list) -> set:
    """
    Pasangan token yang mirip tapi tidak identik (bedanya ejaan atau salah dengar).

    Hanya pasangan yang berbagi awalan/akhiran sama yang diperiksa, supaya
    tidak perlu membandingkan semua pasangan satu per satu.
    """
    buckets = {}
    for j, token in enumerate(hyp):
        if len(token) >= 2:
            buckets.setdefault(token[:2], []).append(j)
        if len(token) >= 3:
            buckets.setdefault(token[-3:], []).append(j)

    pairs = set()
    for i, token in enumerate(ref):
        if len(token) < 3:
            continue
        candidates = set(buckets.get(token[:2], ()))
        candidates.update(buckets.get(token[-3:], ()))
        for j in candidates:
            other = hyp[j]
            if other == token:
                continue
            if abs(len(other) - len(token)) > 2:
                continue
            if SequenceMatcher(None, token, other).ratio() >= FUZZY_RATIO:
                pairs.add((i, j))
    return pairs


def _align_tokens(ref: list, hyp: list, fuzzy: set) -> dict:
    """Return {indeks token ref: indeks token hyp} hasil penyejajaran."""
    n, m = len(ref), len(hyp)
    if not n or not m:
        return {}

    prev = [j * GAP_HYP for j in range(m + 1)]
    trace = []

    for i in range(1, n + 1):
        cur = [i * GAP_REF]
        row = [0] * (m + 1)
        for j in range(1, m + 1):
            if ref[i - 1] == hyp[j - 1]:
                score = MATCH_SCORE
            elif (i - 1, j - 1) in fuzzy:
                score = FUZZY_SCORE
            else:
                score = MISMATCH_SCORE

            diag = prev[j - 1] + score
            up = prev[j] + GAP_REF
            left = cur[j - 1] + GAP_HYP

            if diag >= up and diag >= left:
                cur.append(diag)
                row[j] = 0
            elif up >= left:
                cur.append(up)
                row[j] = 1
            else:
                cur.append(left)
                row[j] = 2
        trace.append(row)
        prev = cur

    matched = {}
    i, j = n, m
    while i > 0 and j > 0:
        direction = trace[i - 1][j]
        if direction == 0:
            if ref[i - 1] == hyp[j - 1] or (i - 1, j - 1) in fuzzy:
                matched[i - 1] = j - 1
            i -= 1
            j -= 1
        elif direction == 1:
            i -= 1
        else:
            j -= 1
    return matched


def _fill_gaps(lines: list, starts: dict, asr_end: float | None) -> tuple:
    """
    Lengkapi waktu untuk baris yang tidak ketemu padanannya di hasil ASR.

    Lirik user tidak boleh hilang, jadi baris seperti itu tetap dipakai dan
    waktunya dibagi rata di sela baris terdekat yang berhasil terdeteksi.
    """
    n = len(lines)
    result = dict(starts)
    matched = sorted(starts)

    if not matched:
        # tidak ada satu pun acuan: sebar rata di sepanjang audio
        length = asr_end or 0.0
        return {i: round(length * (i + 1) / (n + 1), 2) for i in range(n)}, list(lines)

    def spread(indexes, begin, finish):
        if not indexes:
            return
        finish = max(finish, begin)
        step = (finish - begin) / (len(indexes) + 1)
        for order, index in enumerate(indexes, start=1):
            result[index] = round(begin + step * order, 2)

    first = matched[0]
    spread([i for i in range(0, first)], 0.0, starts[first])

    for previous, current in zip(matched, matched[1:]):
        spread([i for i in range(previous + 1, current)],
               starts[previous], starts[current])

    last = matched[-1]
    tail_end = max(asr_end or 0.0, starts[last] + 1.0)
    spread([i for i in range(last + 1, n)], starts[last], tail_end)

    estimated = [lines[i] for i in range(n) if i not in starts]
    return result, estimated


def build_from_reference(lines: list, asr_segments: list, asr_end: float | None = None):
    """
    Bangun segmen lirik dari teks user + waktu dari hasil AI.

    Return (segments, estimated):
      segments  — teks 100% dari user, waktu dari AI, urut menaik
      estimated — baris yang waktunya diperkirakan karena tidak terdeteksi jelas
    """
    asr_tokens = []
    for segment in asr_segments:
        for word in segment.get("words") or []:
            tokens = norm_tokens(word.get("word"))
            if not tokens:
                continue
            asr_tokens.append({
                "norm": tokens[0],
                "start": word.get("start"),
                "end": word.get("end"),
            })

    if asr_end is None:
        asr_end = max((s.get("end") or 0 for s in asr_segments), default=0)

    ref_tokens = []
    spans = []
    for line in lines:
        tokens = norm_tokens(line)
        spans.append((len(ref_tokens), len(ref_tokens) + len(tokens)))
        ref_tokens.extend(tokens)

    matched = _align_tokens(
        ref_tokens,
        [t["norm"] for t in asr_tokens],
        _fuzzy_pairs(ref_tokens, [t["norm"] for t in asr_tokens]),
    )

    starts = {}
    for index, (begin, end) in enumerate(spans):
        for k in range(begin, end):
            # pakai token pertama yang ketemu: penyejajaran itu monoton,
            # jadi token pertama = awal baris ini dinyanyikan
            if k in matched:
                starts[index] = asr_tokens[matched[k]]["start"]
                break

    times, estimated = _fill_gaps(lines, starts, asr_end)

    ordered = sorted(times)
    segments = []
    for order, index in enumerate(ordered):
        start = times[index]
        if order + 1 < len(ordered):
            end = times[ordered[order + 1]]
        else:
            end = max(asr_end or 0.0, start + 0.5)
        if end is None or end <= start:
            end = start + 0.5
        segments.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "text": lines[index],
            "words": [],
        })

    return segments, estimated
