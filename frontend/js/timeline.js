/* ══════════════════════════════════════════════════════════════════
   Timeline — CapCut-style multi-track timeline.

   Tracks (top → bottom):  Video · Latar · Audio · Teks
   • waveform drawn from real peaks decoded out of the audio file
   • clips: click to select, drag to move, drag an edge to resize
   • snapping to clip edges, the playhead and the project bounds
   • wheel = zoom anchored under the cursor, ⇧+wheel = scroll, Fit button
   • only the visible slice of the ruler and the waveform is rendered, so
     zooming far in stays smooth instead of allocating a giant canvas
   ══════════════════════════════════════════════════════════════════ */
const Timeline = (() => {
  'use strict';

  /* ── DOM ── */
  const scroll  = document.getElementById('tl-scroll');
  const inner   = document.getElementById('tl-inner');
  const ruler   = document.getElementById('ruler');
  const labels  = document.getElementById('tl-labels');
  const tracks  = document.getElementById('tl-tracks');
  const playhead = document.getElementById('playhead');
  const snapGuide = document.getElementById('snap-guide');
  const zoomEl   = document.getElementById('zoom');
  const zoomVal  = document.getElementById('zoom-value');
  const hint     = document.getElementById('tl-hint');
  const durValue = document.getElementById('tl-duration-value');

  /* ── tracks: single source of truth for order, height and colour ── */
  const TRACKS = [
    { id: 'video', name: 'Video', icon: '🎬', h: 56, empty: 'Tambah video latar' },
    { id: 'bg',    name: 'Latar', icon: '🖼', h: 48, empty: 'Tambah gambar latar' },
    { id: 'audio', name: 'Audio', icon: '🎵', h: 68, empty: 'Import audio untuk memuat track' },
    { id: 'text',  name: 'Teks',  icon: '📝', h: 46, empty: 'Baris lirik akan muncul di sini' },
  ];

  /* ── tuning ── */
  const MIN_ZOOM = 5;          // px per second
  const MAX_ZOOM = 400;
  const DEFAULT_ZOOM = 80;
  const SLIDER_MAX = 1000;
  const SNAP_PX = 8;           // snap radius in screen px
  const MIN_CLIP = 0.2;        // shortest clip, seconds
  const CLICK_SLOP = 3;        // px before a press counts as a drag
  const BAR_W = 3;             // waveform column: 2px bar + 1px gap
  const PEAK_RATE = 200;       // peak buckets per second
  const RULER_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

  /* ── state ── */
  let duration = 0;
  let pxPerSec = DEFAULT_ZOOM;
  let currentTime = 0;
  let peaks = null;            // Float32Array, 0..1 per bucket
  let peakRate = 0;            // buckets per second
  let audioName = '';
  const media = { video: null, bg: null };   // { start, end, name, auto }
  const trackEls = {};         // id -> { el, host, def }
  let textClipEls = [];
  let audioClip = null;        // { el, base, prog, start, end }
  let selected = null;         // { track, seg }
  let drag = null;
  let smoothUntil = 0;
  let autoScrollPausedUntil = 0;
  let internalScrollUntil = 0;
  let lastProgCut = -1;
  let rafDraw = 0;
  let wheelZoom = 0, wheelAnchorX = 0, wheelRaf = 0;
  let editCb = null, mediaChangeCb = null, emptyTrackCb = null;

  /* ═══════════ helpers ═══════════ */
  const pad = (n, w = 2) => String(n).padStart(w, '0');

  /** 01:05 — ruler labels. */
  function fmtClock(t) {
    t = Math.max(0, t || 0);
    return pad(Math.floor(t / 60)) + ':' + pad(Math.floor(t % 60));
  }

  /** 01:05.42 — precise readouts. */
  function fmtClockMs(t) {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return pad(m) + ':' + pad(Math.floor(s)) + '.' + pad(Math.round((s - Math.floor(s)) * 100));
  }

  /** 01:05.4 — sub-second ruler labels. */
  function fmtClockShort(t) {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return pad(m) + ':' + pad(Math.floor(s)) + '.' + Math.floor((s - Math.floor(s)) * 10 + 1e-6);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function trackH(id) {
    const t = TRACKS.find(x => x.id === id);
    return t ? t.h : 48;
  }

  function viewportWidth() {
    return Math.max(scroll.clientWidth, 320);
  }

  function contentWidth() {
    return Math.max(duration * pxPerSec, viewportWidth());
  }

  /** Smallest ruler step whose label still has room to breathe. */
  function pickStep(minPx) {
    for (let i = 0; i < RULER_STEPS.length; i++) {
      if (RULER_STEPS[i] * pxPerSec >= minPx) return RULER_STEPS[i];
    }
    return RULER_STEPS[RULER_STEPS.length - 1];
  }

  function setScrollLeft(v) {
    internalScrollUntil = performance.now() + 120;
    scroll.scrollLeft = Math.max(0, v);
  }

  function isPlaying() {
    return typeof Player !== 'undefined' && Player.el && !Player.el.paused;
  }

  /* ═══════════ build track skeleton (once) ═══════════ */
  function buildTracks() {
    labels.innerHTML = '';
    tracks.innerHTML = '';

    const corner = document.createElement('div');
    corner.className = 'tl-corner';
    corner.textContent = 'Track';
    labels.appendChild(corner);

    TRACKS.forEach(def => {
      const lab = document.createElement('div');
      lab.className = 'track-label track-' + def.id;
      lab.style.height = def.h + 'px';
      lab.innerHTML = `<span class="tl-ico">${def.icon}</span><span>${def.name}</span>`;
      labels.appendChild(lab);

      const el = document.createElement('div');
      el.className = 'track track-' + def.id;
      el.style.height = def.h + 'px';
      el.dataset.track = def.id;

      const host = document.createElement('div');
      host.className = 'track-clips';
      el.appendChild(host);
      tracks.appendChild(el);

      trackEls[def.id] = { el, host, def };
    });
  }

  /* ═══════════ layout ═══════════ */
  function layout() {
    inner.style.width = contentWidth() + 'px';
    zoomVal.textContent = Math.round(pxPerSec);
    renderRuler();
    renderClips();
    drawWave();
    updatePlayhead(currentTime, false);
    updateHint();
  }

  /* Ruler: minor ticks live in a repeating background, majors are real
     elements — but only for the window we can actually see. */
  function renderRuler() {
    const viewW = viewportWidth();
    const step = pickStep(58);
    // Drop the minor ticks when they would smear into a solid band.
    const minor = (step / 5) * pxPerSec >= 4 ? step / 5 : step;
    ruler.style.setProperty('--ruler-minor', (minor * pxPerSec).toFixed(2) + 'px');
    inner.style.setProperty('--grid-w', (step * pxPerSec).toFixed(2) + 'px');

    const from = Math.max(0, Math.floor((scroll.scrollLeft - viewW * 0.5) / pxPerSec / step));
    const to = Math.ceil((scroll.scrollLeft + viewW * 1.5) / pxPerSec / step);

    const frag = document.createDocumentFragment();
    for (let i = from; i <= to; i++) {
      const t = i * step;
      const tick = document.createElement('div');
      tick.className = 'ruler-tick';
      tick.style.left = (t * pxPerSec) + 'px';
      tick.textContent = step < 1 ? fmtClockShort(t) : fmtClock(t);
      frag.appendChild(tick);
    }
    ruler.textContent = '';
    ruler.appendChild(frag);
  }

  /* ═══════════ clips ═══════════ */
  function isElSelected(el) {
    if (!selected) return false;
    if (el.dataset.track !== selected.track) return false;
    if (selected.track !== 'text') return true;
    return el.__seg && el.__seg === selected.seg;
  }

  function applySelection() {
    tracks.querySelectorAll('.clip').forEach(el => {
      el.classList.toggle('selected', isElSelected(el));
    });
  }

  function placeholder(id) {
    const def = TRACKS.find(x => x.id === id);
    const el = document.createElement('div');
    const cta = id === 'video' || id === 'bg';
    el.className = 'track-empty' + (cta ? ' track-empty--cta' : '');
    el.style.width = viewportWidth() + 'px';
    el.innerHTML = (cta ? '<span class="te-plus">＋</span>' : '') + esc(def.empty);
    if (cta) {
      el.addEventListener('click', () => { if (emptyTrackCb) emptyTrackCb(id); });
    }
    return el;
  }

  function makeClip(track, start, end, bodyHTML, opts) {
    const o = opts || {};
    const el = document.createElement('div');
    el.className = 'clip clip--' + track + (o.locked ? ' locked' : '');
    el.dataset.track = track;
    if (o.seg) el.__seg = o.seg;
    el.style.left = (start * pxPerSec) + 'px';
    el.style.width = Math.max((end - start) * pxPerSec, 12) + 'px';
    el.innerHTML =
      (o.locked ? '' : '<span class="clip-handle clip-handle-l"></span>')
      + bodyHTML
      + (o.locked ? '' : '<span class="clip-handle clip-handle-r"></span>');
    el.title = o.title || '';
    if (isElSelected(el)) el.classList.add('selected');
    return el;
  }

  function renderTextClips() {
    const host = trackEls.text.host;
    textClipEls = [];
    const segs = Lyrics.get();

    if (!segs.length) {
      host.appendChild(placeholder('text'));
      return;
    }

    segs.forEach((seg, i) => {
      const label = esc(seg.text || '…');
      const el = makeClip('text', seg.start, seg.end,
        `<div class="clip-body"><span class="clip-name">${label}</span></div>`,
        {
          seg,
          title: `${fmtClockMs(seg.start)} → ${fmtClockMs(seg.end)}\n${seg.text || ''}`
        });
      el.dataset.idx = i;
      el.addEventListener('pointerdown', e => startDrag(e, { track: 'text', seg }, el));
      host.appendChild(el);
      textClipEls.push(el);
    });
  }

  function renderAudioClip() {
    const host = trackEls.audio.host;
    audioClip = null;
    if (!duration) {
      host.appendChild(placeholder('audio'));
      return;
    }

    const el = document.createElement('div');
    el.className = 'clip clip--audio locked';
    el.dataset.track = 'audio';
    el.style.left = '0px';
    el.style.width = (duration * pxPerSec) + 'px';
    el.title = `${audioName || 'Audio'}\nTrack master — durasi project`;
    if (isElSelected(el)) el.classList.add('selected');

    const base = document.createElement('canvas');
    base.className = 'wave wave-base';
    const prog = document.createElement('canvas');
    prog.className = 'wave wave-prog';
    const meta = document.createElement('div');
    meta.className = 'clip-meta';
    meta.innerHTML = `<span class="clip-ico">🎵</span><span class="clip-name">${esc(audioName || 'Audio')}</span><span>🔒</span>`;

    el.append(base, prog, meta);
    el.addEventListener('pointerdown', e => startDrag(e, { track: 'audio', seg: null }, el));
    host.appendChild(el);

    audioClip = { el, base, prog, start: 0, end: duration };
    lastProgCut = -1;
  }

  function renderMediaClips() {
    ['video', 'bg'].forEach(id => {
      const host = trackEls[id].host;
      const m = media[id];
      if (!m) {
        host.appendChild(placeholder(id));
        return;
      }
      const icon = id === 'video' ? '🎬' : '🖼';
      const el = makeClip(id, m.start, m.end,
        `<div class="clip-body"><span class="clip-ico">${icon}</span><span class="clip-name">${esc(m.name)}</span></div>`,
        { title: `${m.name}\n${fmtClockMs(m.start)} → ${fmtClockMs(m.end)}` });
      el.addEventListener('pointerdown', e => startDrag(e, { track: id, seg: null }, el));
      host.appendChild(el);
    });
  }

  function renderClips() {
    TRACKS.forEach(t => { trackEls[t.id].host.innerHTML = ''; });
    textClipEls = [];
    renderTextClips();
    renderAudioClip();
    renderMediaClips();
  }

  function updateHint() {
    const n = Lyrics.get().length;
    const base = duration ? `${n} baris lirik` : 'Import audio untuk memuat track';
    hint.textContent = base + ' · scroll = zoom, shift+scroll = geser';
  }

  /* ═══════════ waveform ═══════════ */
  /** Decode the audio once and keep a compact per-bucket peak envelope. */
  async function setAudioFile(file) {
    audioName = file ? file.name : '';
    peaks = null;
    peakRate = 0;

    if (file) {
      try {
        const buf = await file.arrayBuffer();
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        computePeaks(decoded);
        if (ctx.close) ctx.close();
      } catch (err) {
        console.warn('Timeline: gagal membaca waveform', err);
        peaks = null;
      }
    }

    renderClips();
    applySelection();
    drawWave();
  }

  function computePeaks(audioBuffer) {
    const dur = audioBuffer.duration || 1;
    const count = Math.max(512, Math.min(240000, Math.round(dur * PEAK_RATE)));
    const out = new Float32Array(count);
    const per = audioBuffer.length / count;
    let top = 0;

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < count; i++) {
        const s = Math.floor(i * per);
        const e = Math.min(audioBuffer.length, Math.floor((i + 1) * per));
        let m = 0;
        for (let j = s; j < e; j++) {
          const v = data[j] < 0 ? -data[j] : data[j];
          if (v > m) m = v;
        }
        if (m > out[i]) out[i] = m;
      }
    }

    for (let i = 0; i < count; i++) if (out[i] > top) top = out[i];
    const k = top > 0 ? 1 / top : 1;
    // Soft curve: quiet songs still read as a waveform, loud ones don't clip flat.
    for (let i = 0; i < count; i++) out[i] = Math.pow(Math.min(1, out[i] * k), 0.8);

    peaks = out;
    peakRate = count / dur;
  }

  function sizeWaveCanvas(canvas, viewW, h, offset) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = h + 'px';
    canvas.style.transform = `translateX(${offset}px)`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /** Draws the visible slice of the envelope into a viewport-sized canvas. */
  function drawBars(ctx, viewW, h, scrolled, hot) {
    const mid = h / 2;
    const maxAmp = h - 14;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (hot) {
      grad.addColorStop(0, '#9bdcff');
      grad.addColorStop(0.5, '#4fb0ff');
      grad.addColorStop(1, '#9bdcff');
    } else {
      grad.addColorStop(0, 'rgba(122, 172, 220, 0.52)');
      grad.addColorStop(1, 'rgba(122, 172, 220, 0.4)');
    }
    ctx.fillStyle = grad;

    const t0 = scrolled / pxPerSec;
    const cols = Math.ceil(viewW / BAR_W);
    for (let i = 0; i < cols; i++) {
      const x = i * BAR_W;
      let m = 0;
      if (peaks) {
        const tc = t0 + x / pxPerSec;
        const bs = Math.floor(tc * peakRate);
        const be = Math.max(bs + 1, Math.ceil((tc + BAR_W / pxPerSec) * peakRate));
        for (let b = bs; b < be; b++) {
          const v = peaks[b];
          if (v !== undefined && v > m) m = v;
        }
      } else {
        m = 0.06;
      }
      const amp = Math.max(2, m * maxAmp);
      ctx.fillRect(x, mid - amp / 2, BAR_W - 1, amp);
    }
  }

  function drawWave() {
    if (!audioClip) return;
    const h = trackH('audio');
    const viewW = viewportWidth();
    const scrolled = scroll.scrollLeft;
    // Offset of the canvas inside the clip, so it always covers the viewport.
    const off = scrolled - audioClip.start * pxPerSec;

    const ctx = sizeWaveCanvas(audioClip.base, viewW, h, off);
    ctx.clearRect(0, 0, viewW, h);
    drawBars(ctx, viewW, h, scrolled, false);

    const pctx = sizeWaveCanvas(audioClip.prog, viewW, h, off);
    pctx.clearRect(0, 0, viewW, h);
    drawBars(pctx, viewW, h, scrolled, true);

    updateWaveProgress(true);
  }

  /** Clips the bright waveform to the part that has already been played. */
  function updateWaveProgress(force) {
    if (!audioClip) return;
    const viewW = viewportWidth();
    const cut = Math.max(0, Math.min(viewW, currentTime * pxPerSec - scroll.scrollLeft));
    const round = Math.round(cut);
    if (!force && round === lastProgCut) return;
    lastProgCut = round;
    audioClip.prog.style.clipPath = `inset(0 ${(viewW - round).toFixed(1)}px 0 0)`;
  }

  /* ═══════════ playhead ═══════════ */
  function updatePlayhead(time, smooth) {
    currentTime = Math.max(0, time || 0);
    const x = currentTime * pxPerSec;

    const easing = smooth === undefined ? performance.now() < smoothUntil : smooth;
    playhead.classList.toggle('smooth', easing);
    playhead.style.transform = `translateX(${(x - 0.5).toFixed(2)}px)`;

    // Follow the playhead while playing, unless the user just scrolled away.
    if (isPlaying() && performance.now() > autoScrollPausedUntil) {
      const viewW = scroll.clientWidth;
      const left = scroll.scrollLeft;
      if (x < left + 40 || x > left + viewW - 100) {
        setScrollLeft(Math.max(0, x - viewW / 2));
      }
    }

    applyPlaying(Lyrics.getActiveIdx());
    updateWaveProgress(false);
  }

  function applyPlaying(idx) {
    for (let i = 0; i < textClipEls.length; i++) {
      const el = textClipEls[i];
      el.classList.toggle('playing', Number(el.dataset.idx) === idx);
    }
  }

  function seekTo(t) {
    if (!duration) return;
    t = Math.max(0, Math.min(t, duration));
    smoothUntil = performance.now() + 220;
    Player.seek(t);
    Lyrics.sync(t);
    updatePlayhead(t);
  }

  /* ═══════════ drag / resize ═══════════ */
  function nearest(list, t, tol) {
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(list[i] - t);
      if (d < bd && d <= tol) { bd = d; best = list[i]; }
    }
    return best;
  }

  function snapTargets(d) {
    const out = [0, duration, currentTime];
    Lyrics.get().forEach(s => { if (s !== d.seg) out.push(s.start, s.end); });
    ['video', 'bg'].forEach(id => {
      const m = media[id];
      if (m && m !== media[d.track]) out.push(m.start, m.end);
    });
    return out.filter(t => t >= 0 && t <= duration + 0.001);
  }

  function showSnap(t) {
    if (t === null || t === undefined) {
      snapGuide.classList.remove('show');
      return;
    }
    snapGuide.style.transform = `translateX(${(t * pxPerSec - 0.5).toFixed(2)}px)`;
    snapGuide.classList.add('show');
  }

  function startDrag(e, ctx, el) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    select(ctx.track, ctx.seg);

    // Audio is the master track: selectable and seekable, but never moved.
    if (ctx.track === 'audio') {
      const rect = inner.getBoundingClientRect();
      seekTo((e.clientX - rect.left) / pxPerSec);
      return;
    }
    if (ctx.track === 'text' && editCb) editCb();   // undo snapshot before mutating

    const handle = e.target.closest ? e.target.closest('.clip-handle') : null;
    const mode = handle
      ? (handle.classList.contains('clip-handle-l') ? 'trim-l' : 'trim-r')
      : 'move';

    const start = ctx.seg ? ctx.seg.start : media[ctx.track].start;
    const end = ctx.seg ? ctx.seg.end : media[ctx.track].end;

    drag = {
      mode, el, ctx, seg: ctx.seg, track: ctx.track,
      downX: e.clientX, moved: false,
      start, end, origStart: start, origEnd: end,
    };
    el.classList.add('dragging');

    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragUp);
  }

  function onDragMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.downX;
    if (!drag.moved && Math.abs(dx) > CLICK_SLOP) drag.moved = true;
    if (!drag.moved) return;

    const dt = dx / pxPerSec;
    let start = drag.origStart;
    let end = drag.origEnd;

    if (drag.mode === 'move') { start += dt; end += dt; }
    else if (drag.mode === 'trim-l') start = Math.min(start + dt, end - MIN_CLIP);
    else end = Math.max(end + dt, start + MIN_CLIP);

    // Keep clips inside the project. Moving shifts both edges, so the clip
    // keeps its length when it runs into t = 0.
    if (drag.mode === 'move') {
      const span = end - start;
      start = Math.max(0, start);
      end = start + span;
    } else {
      start = Math.max(0, start);
      end = Math.max(start + MIN_CLIP, end);
    }

    // Snapping: the grabbed edge wins, otherwise the opposite edge is tried.
    const tol = SNAP_PX / pxPerSec;
    const targets = snapTargets(drag);
    let snapped = null;
    if (drag.mode === 'move') {
      const a = nearest(targets, start, tol);
      if (a !== null) { const d = a - start; start = a; end += d; snapped = a; }
      else {
        const b = nearest(targets, end, tol);
        if (b !== null) { const d = b - end; start += d; end = b; snapped = b; }
      }
    } else if (drag.mode === 'trim-l') {
      const a = nearest(targets, start, tol);
      if (a !== null && a <= end - MIN_CLIP) { start = a; snapped = a; }
    } else {
      const b = nearest(targets, end, tol);
      if (b !== null && b >= start + MIN_CLIP) { end = b; snapped = b; }
    }

    start = Math.max(0, start);
    end = Math.max(start + MIN_CLIP, end);

    drag.start = start;
    drag.end = end;
    drag.el.style.left = (start * pxPerSec) + 'px';
    drag.el.style.width = ((end - start) * pxPerSec) + 'px';
    showSnap(snapped);

    // Live model update so the inspector numbers track the drag.
    if (drag.seg) { drag.seg.start = start; drag.seg.end = end; }
    else if (media[drag.track]) { media[drag.track].start = start; media[drag.track].end = end; }
  }

  function onDragUp() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragUp);

    const d = drag;
    drag = null;
    if (!d) return;
    d.el.classList.remove('dragging');
    showSnap(null);

    if (!d.moved) {
      const rect = inner.getBoundingClientRect();
      seekTo(d.seg ? d.seg.start : (d.downX - rect.left) / pxPerSec);
      return;
    }

    if (d.track === 'text') {
      const idx = Lyrics.get().indexOf(d.seg);
      if (idx >= 0) Lyrics.update(idx, { start: d.start, end: d.end });
      Lyrics.sort();
      selected = { track: 'text', seg: d.seg };
      updateHint();
    } else if (media[d.track]) {
      media[d.track].auto = false;
      selected = { track: d.track, seg: null };
      renderClips();
      applySelection();
      if (mediaChangeCb) mediaChangeCb();
    }
  }

  function select(track, seg) {
    selected = { track, seg: seg || null };
    applySelection();
  }

  /* ═══════════ zoom & scroll ═══════════ */
  function ppsFromSlider(v) {
    return MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, v / SLIDER_MAX);
  }
  function sliderFromPps(p) {
    return SLIDER_MAX * Math.log(p / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);
  }

  function zoomTo(pps) {
    pps = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pps));
    if (Math.abs(pps - pxPerSec) < 0.001) return;
    pxPerSec = pps;
    zoomEl.value = sliderFromPps(pps);
    layout();
  }

  /** Zoom keeping the time under `clientX` pinned in place. */
  function zoomAt(clientX, pps) {
    const rect = scroll.getBoundingClientRect();
    const viewX = clientX - rect.left;
    const anchorT = (scroll.scrollLeft + viewX) / pxPerSec;
    zoomTo(pps);
    setScrollLeft(anchorT * pxPerSec - viewX);
  }

  function fit() {
    if (!duration) {
      zoomTo(DEFAULT_ZOOM);
      setScrollLeft(0);
      return;
    }
    zoomTo(Math.max(scroll.clientWidth - 24, 120) / duration);
    setScrollLeft(0);
  }

  function onWheel(e) {
    // Trackpad horizontal swipe / shift+wheel: let the browser scroll.
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (!wheelZoom) wheelZoom = pxPerSec;
    wheelZoom *= Math.exp(-e.deltaY * 0.0015);
    wheelAnchorX = e.clientX;
    if (wheelRaf) return;
    wheelRaf = requestAnimationFrame(() => {
      wheelRaf = 0;
      zoomAt(wheelAnchorX, wheelZoom);
      wheelZoom = 0;
    });
  }

  function scheduleDraw() {
    if (rafDraw) return;
    rafDraw = requestAnimationFrame(() => {
      rafDraw = 0;
      renderRuler();
      drawWave();
      // Placeholders are viewport wide so they stay readable on screen.
      tracks.querySelectorAll('.track-empty').forEach(el => {
        el.style.width = viewportWidth() + 'px';
      });
    });
  }

  /* ═══════════ events ═══════════ */
  scroll.addEventListener('scroll', () => {
    if (performance.now() > internalScrollUntil) {
      autoScrollPausedUntil = performance.now() + 1500;
    }
    scheduleDraw();
  }, { passive: true });

  scroll.addEventListener('wheel', onWheel, { passive: false });

  zoomEl.addEventListener('input', e => {
    const rect = scroll.getBoundingClientRect();
    zoomAt(rect.left + scroll.clientWidth / 2, ppsFromSlider(parseFloat(e.target.value)));
  });
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    const rect = scroll.getBoundingClientRect();
    zoomAt(rect.left + scroll.clientWidth / 2, pxPerSec * 1.3);
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    const rect = scroll.getBoundingClientRect();
    zoomAt(rect.left + scroll.clientWidth / 2, pxPerSec / 1.3);
  });
  document.getElementById('tl-fit').addEventListener('click', fit);

  /* Drag the ruler to scrub, like CapCut. */
  function scrubTo(clientX) {
    if (!duration) return;
    const rect = inner.getBoundingClientRect();
    const t = Math.max(0, Math.min((clientX - rect.left) / pxPerSec, duration));
    smoothUntil = 0;
    Player.seek(t);
    Lyrics.sync(t);
    updatePlayhead(t, false);
  }

  ruler.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !duration) return;
    e.preventDefault();
    scrubTo(e.clientX);
    const move = ev => scrubTo(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /* Clicking empty track space seeks too. */
  tracks.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !duration) return;
    if (e.target.closest && e.target.closest('.clip')) return;
    const rect = inner.getBoundingClientRect();
    seekTo((e.clientX - rect.left) / pxPerSec);
  });

  window.addEventListener('resize', () => {
    lastProgCut = -1;
    layout();
  });

  /* ═══════════ public API ═══════════ */
  function setDuration(d) {
    duration = Math.max(0, d || 0);
    ['video', 'bg'].forEach(id => {
      const m = media[id];
      if (m && m.auto) { m.start = 0; m.end = duration; }
    });
    if (durValue) durValue.textContent = fmtClockMs(duration);
    layout();
  }

  /** Places (or moves) the loaded background media onto its track. */
  function setMedia(trackId, name) {
    const id = trackId === 'video' ? 'video' : 'bg';
    Object.keys(media).forEach(k => { if (k !== id) media[k] = null; });
    media[id] = { start: 0, end: duration, name: name || 'Media', auto: true };
    renderClips();
    applySelection();
    if (mediaChangeCb) mediaChangeCb();
  }

  function clearMedia() {
    media.video = null;
    media.bg = null;
    renderClips();
    applySelection();
    if (mediaChangeCb) mediaChangeCb();
  }

  /** True while the media clip at `t` is on screen. */
  function isBackgroundVisible(t) {
    const clips = ['video', 'bg'].map(id => media[id]).filter(Boolean);
    if (!clips.length) return true;
    return clips.some(m => t >= m.start - 1e-3 && t <= m.end + 1e-3);
  }

  function refresh() {
    renderClips();
    applySelection();
    drawWave();
    updateHint();
    if (durValue) durValue.textContent = fmtClockMs(duration);
  }

  /* ═══════════ init ═══════════ */
  buildTracks();
  zoomEl.value = sliderFromPps(pxPerSec);
  if (durValue) durValue.textContent = fmtClockMs(0);
  layout();

  return {
    setDuration,
    setAudioFile,
    setMedia,
    clearMedia,
    isBackgroundVisible,
    updatePlayhead,
    refresh,
    layout,
    fit,
    select,
    onEditStart: cb => { editCb = cb; },
    onMediaChange: cb => { mediaChangeCb = cb; },
    onEmptyTrack: cb => { emptyTrackCb = cb; },
  };
})();
