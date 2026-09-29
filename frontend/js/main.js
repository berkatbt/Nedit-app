(() => {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';

  const bgInput = document.createElement('input');
  bgInput.type = 'file';
  bgInput.accept = 'image/*,video/*';

  const btnUpload = document.getElementById('btn-upload');
  const btnGenerate = document.getElementById('btn-generate');
  const btnExport = document.getElementById('btn-export');
  const previewEmpty = document.getElementById('preview-empty');
  const previewContent = document.getElementById('preview-content');
  const activeLyric = document.getElementById('active-lyric');
  const nextLyric = document.getElementById('next-lyric');
  const waveBars = document.getElementById('wave-bars');
  const toast = document.getElementById('toast');
  const propForm = document.getElementById('prop-form');
  const propEmpty = document.getElementById('prop-empty');
  const propCount = document.getElementById('prop-count');
  const stage = document.getElementById('preview-canvas');
  const refLyrics = document.getElementById('ref-lyrics');
  const refHint = document.getElementById('ref-hint');
  const refPanel = document.getElementById('ref-panel');
  const optVocals = document.getElementById('opt-vocals');

  let currentFile = null;

  // ─── Toast ───
  let toastTimer;
  function showToast(msg, type = '') {
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.className = 'toast', msg.length > 70 ? 6500 : 2500);
  }

  function isAudioFile(f) {
    return /^audio\//.test(f.type || '') || /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(f.name || '');
  }

  // ─── Audio ───
  function loadAudioFile(f) {
    if (!f) return;
    currentFile = f;
    Player.load(f);
    Timeline.setAudioFile(f);   // decode real peaks for the waveform

    previewEmpty.classList.add('hidden');
    previewContent.classList.remove('hidden');
    activeLyric.textContent = '♪ Siap diputar ♪';
    nextLyric.textContent = f.name;

    btnGenerate.disabled = false;
    showToast(`✅ Loaded: ${f.name}`);
    buildDummyWave();
  }

  function buildDummyWave() {
    waveBars.innerHTML = '';
    for (let i = 0; i < 80; i++) {
      const s = document.createElement('span');
      s.style.height = (15 + Math.random() * 85) + '%';
      waveBars.appendChild(s);
    }
  }

  btnUpload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    loadAudioFile(e.target.files[0]);
    fileInput.value = '';
  });

  // ─── Background image / video ───
  function setBackground(f) {
    if (!Background.setFromFile(f)) {
      showToast('❌ Latar harus berupa gambar atau video', 'error');
      return;
    }
    // Park the media on its own timeline track.
    Timeline.setMedia(Background.getMode() === 'video' ? 'video' : 'bg', f.name);
    showToast(`🖼 Latar dipasang: ${f.name}`);
  }

  bgInput.addEventListener('change', e => {
    setBackground(e.target.files[0]);
    bgInput.value = '';
  });

  document.getElementById('btn-bg-clear').addEventListener('click', () => {
    Background.clear();
    Timeline.clearMedia();
    showToast('🗑 Latar dihapus');
  });

  // ─── Left tool rail ───
  const rail = {
    media: document.getElementById('rail-media'),
    audio: document.getElementById('rail-audio'),
    text: document.getElementById('rail-text'),
    fx: document.getElementById('rail-fx'),
    bg: document.getElementById('rail-bg'),
  };

  document.querySelectorAll('.rail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (btn === rail.media || btn === rail.audio) fileInput.click();
      else if (btn === rail.bg) bgInput.click();
      else if (btn === rail.text) {
        refPanel.classList.remove('closed');
        showToast('Teks di timeline = baris lirik. Generate dulu dari panel kanan.');
      } else if (btn === rail.fx) {
        showToast('⚠ Efek visual belum tersedia di versi ini');
      }
    });
  });

  // ─── Drag & drop onto the preview stage ───
  let dragDepth = 0;
  stage.addEventListener('dragenter', e => {
    e.preventDefault();
    dragDepth++;
    stage.classList.add('drag-over');
  });
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) stage.classList.remove('drag-over');
  });
  stage.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    stage.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;

    let handled = false;
    files.forEach(f => {
      if (isAudioFile(f)) { loadAudioFile(f); handled = true; }
      else if (Background.isSupported(f)) { setBackground(f); handled = true; }
    });
    if (!handled) showToast('❌ Format tidak didukung (audio / gambar / video)', 'error');
  });

  // ─── Panel lirik asli ───
  function parseRefLines() {
    return refLyrics.value
      .split('\n')
      .map(s => s.trim())
      .filter(s => s && !/^[\[\(].{0,40}[\]\)]$/.test(s));
  }

  function updateRefHint() {
    const n = parseRefLines().length;
    refHint.classList.toggle('ok', n > 0);
    refHint.textContent = n > 0
      ? `✓ ${n} baris lirik asli siap dipakai — teksnya akan sama persis.`
      : 'Belum diisi — lirik akan dibuat AI sepenuhnya.';
  }

  refLyrics.addEventListener('input', updateRefHint);
  updateRefHint();

  document.getElementById('ref-toggle').addEventListener('click', () => {
    refPanel.classList.toggle('closed');
    document.getElementById('ref-toggle')
      .setAttribute('aria-expanded', String(!refPanel.classList.contains('closed')));
  });

  // ─── Generate ───
  btnGenerate.addEventListener('click', async () => {
    if (!currentFile) return;

    btnGenerate.disabled = true;
    btnGenerate.textContent = '⏳ Memproses...';
    showToast('⏳ Transkripsi berjalan...');

    try {
      const fd = new FormData();
      fd.append('file', currentFile);
      if (parseRefLines().length) fd.append('lyrics', refLyrics.value);
      fd.append('separate_vocals', optVocals.checked ? 'true' : 'false');

      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // Tampilkan pesan asli dari server supaya penyebabnya kelihatan
        const detail = (data && data.detail) || ('HTTP ' + res.status + ' ' + res.statusText);
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      }
      if (!data || !data.segments) {
        throw new Error('Respons server tidak berisi lirik');
      }

      Lyrics.load(data.lrc);
      Timeline.refresh();
      btnExport.disabled = false;

      const total = data.segments.length;
      const parts = [
        data.mode === 'reference'
          ? `✅ ${total} baris diselaraskan dari lirik asli`
          : `✅ ${total} baris lirik dibuat`
      ];
      if (data.estimated && data.estimated.length) {
        parts.push(`${data.estimated.length} baris waktunya diperkirakan (kurang jelas di audio)`);
      }
      if (optVocals.checked && data.vocals === false) {
        parts.push('pisah vokal gagal — memakai audio asli');
      }
      showToast(parts.join(' · '));
      updatePropCount();
    } catch (err) {
      console.error(err);
      const msg = String((err && err.message) || err);
      const short = msg.length > 180 ? msg.slice(0, 177) + '…' : msg;
      showToast('❌ Gagal transkripsi: ' + short, 'error');
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = '✨ Generate Lirik';
    }
  });

  // ─── Player → Lyric sync ───
  Player.on({
    ready: (dur) => Timeline.setDuration(dur),
    tick: (t) => {
      Lyrics.sync(t);
      Timeline.updatePlayhead(t);
      // The background only shows while its timeline clip covers the playhead.
      Background.setActive(Timeline.isBackgroundVisible(t));
    }
  });

  // ═══════════ TIMELINE WIRING ═══════════
  Timeline.onEditStart(saveSnapshot);
  Timeline.onEmptyTrack(() => bgInput.click());
  Timeline.onMediaChange(() => {
    Background.setActive(Timeline.isBackgroundVisible(Player.el.currentTime));
  });

  // ─── Lyric events ───
  Lyrics.on((event, payload) => {
    if (event === 'active') {
      const seg = Lyrics.getActive();
      if (seg) {
        activeLyric.textContent = seg.text || '♪';
        const next = Lyrics.get()[payload + 1];
        nextLyric.textContent = next ? next.text : '';
        loadIntoPanel(payload);
      } else {
        activeLyric.textContent = '♪';
        nextLyric.textContent = '';
      }
    }
    if (event === 'load' || event === 'update' || event === 'remove') {
      Timeline.refresh();
      updatePropCount();
    }
  });

  function updatePropCount() {
    propCount.textContent = Lyrics.get().length + ' baris';
  }

  // ─── Properties panel ───
  const editText = document.getElementById('edit-text');
  const editStart = document.getElementById('edit-start');
  const editEnd = document.getElementById('edit-end');

  function loadIntoPanel(idx) {
    const seg = Lyrics.get()[idx];
    if (!seg) {
      propForm.classList.add('hidden');
      propEmpty.classList.remove('hidden');
      return;
    }
    propForm.classList.remove('hidden');
    propEmpty.classList.add('hidden');
    editText.value = seg.text;
    editStart.value = seg.start.toFixed(2);
    editEnd.value = seg.end.toFixed(2);
  }

  document.getElementById('btn-apply').addEventListener('click', () => {
    const idx = Lyrics.getActiveIdx();
    if (idx < 0) return;
    Lyrics.update(idx, {
      text: editText.value,
      start: parseFloat(editStart.value),
      end: parseFloat(editEnd.value)
    });
    showToast('✓ Baris diperbarui');
  });

  document.getElementById('btn-prev-seg').addEventListener('click', () => {
    const idx = Lyrics.getActiveIdx();
    if (idx > 0) { Player.seek(Lyrics.get()[idx - 1].start); }
  });
  document.getElementById('btn-next-seg').addEventListener('click', () => {
    const idx = Lyrics.getActiveIdx();
    const all = Lyrics.get();
    if (idx < all.length - 1) { Player.seek(all[idx + 1].start); }
  });
  document.getElementById('btn-delete-seg').addEventListener('click', () => {
    const idx = Lyrics.getActiveIdx();
    if (idx < 0) return;
    Lyrics.remove(idx);
    showToast('🗑 Baris dihapus');
  });

  // ═══════════ TIMELINE TOOLBAR BUTTONS ═══════════

  // ─── Undo / Redo stack ───
  let undoStack = [];
  let redoStack = [];

  function saveSnapshot() {
    undoStack.push(JSON.stringify(Lyrics.get()));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
  }

  // Hook into Lyrics events to auto-snapshot
  Lyrics.on((event) => {
    if (event === 'update' || event === 'remove' || event === 'load') {
      // We save BEFORE the event's result for undo, but "load" replaces everything,
      // so just push a snapshot of the current state after load.
      // (For update/remove, snapshot is pushed by the calling button handler.)
    }
  });

  // ─── Split — split the active lyric segment at the current playhead position ───
  document.getElementById('tl-split').addEventListener('click', () => {
    const idx = Lyrics.getActiveIdx();
    if (idx < 0) {
      showToast('⚠ Pilih segmen lirik dulu', 'error');
      return;
    }
    const t = Player.el.currentTime;
    const seg = Lyrics.get()[idx];
    if (t <= seg.start + 0.1 || t >= seg.end - 0.1) {
      showToast('⚠ Playhead harus berada di tengah segmen', 'error');
      return;
    }

    saveSnapshot();
    const text1 = seg.text;
    // Split text roughly in half by words
    const words = text1.split(/\s+/);
    let leftText, rightText;
    if (words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      leftText = words.slice(0, mid).join(' ');
      rightText = words.slice(mid).join(' ');
    } else {
      leftText = text1;
      rightText = '…';
    }

    Lyrics.update(idx, { end: t, text: leftText });
    // Insert new segment after the current one
    Lyrics.get().splice(idx + 1, 0, { start: t, end: seg.end, text: rightText });
    Timeline.refresh();
    showToast('✂ Segmen dipisah');
  });

  // ─── Delete — remove the active segment ───
  document.getElementById('tl-delete').addEventListener('click', () => {
    const idx = Lyrics.getActiveIdx();
    if (idx < 0) {
      showToast('⚠ Pilih segmen lirik dulu', 'error');
      return;
    }
    saveSnapshot();
    Lyrics.remove(idx);
    showToast('🗑 Segmen dihapus');
  });

  // ─── Undo ───
  document.getElementById('tl-undo').addEventListener('click', () => {
    if (!undoStack.length) {
      showToast('⚠ Tidak ada yang bisa di-undo');
      return;
    }
    // Save current state for redo
    redoStack.push(JSON.stringify(Lyrics.get()));
    const prev = JSON.parse(undoStack.pop());
    // Restore segments
    const segs = Lyrics.get();
    segs.length = 0;
    prev.forEach(s => segs.push(s));
    Timeline.refresh();
    showToast('↶ Undo');
  });

  // ─── Redo ───
  document.getElementById('tl-redo').addEventListener('click', () => {
    if (!redoStack.length) {
      showToast('⚠ Tidak ada yang bisa di-redo');
      return;
    }
    undoStack.push(JSON.stringify(Lyrics.get()));
    const next = JSON.parse(redoStack.pop());
    const segs = Lyrics.get();
    segs.length = 0;
    next.forEach(s => segs.push(s));
    Timeline.refresh();
    showToast('↷ Redo');
  });

  // ─── Timeline keyboard shortcuts ───
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      document.getElementById('tl-delete').click();
    } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      document.getElementById('tl-split').click();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      document.getElementById(e.shiftKey ? 'tl-redo' : 'tl-undo').click();
    }
  });

  // ═══════════ EXPORT — RENDER AS VIDEO (MP4) ═══════════
  btnExport.addEventListener('click', async () => {
    const segments = Lyrics.get();
    if (!segments.length) {
      showToast('❌ Belum ada lirik untuk diexport', 'error');
      return;
    }
    if (!currentFile) {
      showToast('❌ Belum ada audio', 'error');
      return;
    }

    // Disable button during export
    btnExport.disabled = true;
    btnExport.textContent = '⏳ Rendering...';
    showToast('⏳ Merender video... mohon tunggu');

    try {
      await renderVideo(segments);
    } catch (err) {
      console.error('Export error:', err);
      showToast('❌ Export gagal: ' + (err.message || err), 'error');
    } finally {
      btnExport.disabled = false;
      btnExport.textContent = '🎬 Export Video';
    }
  });

  async function renderVideo(segments) {
    const W = 1920;
    const H = 1080;
    const FPS = 30;

    // Create offscreen canvas
    const offCanvas = document.createElement('canvas');
    offCanvas.width = W;
    offCanvas.height = H;
    const ctx = offCanvas.getContext('2d');

    // Load background image if present
    let bgImg = null;
    const bgImageEl = document.getElementById('bg-image');
    if (bgImageEl && bgImageEl.src && !bgImageEl.classList.contains('hidden')) {
      bgImg = new Image();
      bgImg.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        bgImg.onload = resolve;
        bgImg.onerror = reject;
        bgImg.src = bgImageEl.src;
      });
    }

    // Prepare audio — decode to get exact duration
    const audioArrayBuffer = await currentFile.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer.slice(0));
    const totalDuration = audioBuffer.duration;
    const totalFrames = Math.ceil(totalDuration * FPS);

    // Setup MediaRecorder on the offscreen canvas stream
    const stream = offCanvas.captureStream(FPS);

    // Encode audio into the stream — create a MediaStreamAudioDestinationNode
    const audioDest = audioCtx.createMediaStreamDestination();
    const bufferSource = audioCtx.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(audioDest);

    // Combine video stream + audio stream
    const audioTrack = audioDest.stream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);

    // Determine best supported codec
    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5000000,
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const done = new Promise((resolve) => {
      recorder.onstop = () => resolve();
    });

    // Start recording + audio playback
    recorder.start(100); // collect data every 100ms
    bufferSource.start(0);

    // Render frames
    const startTime = performance.now();
    let frame = 0;

    function findActiveSeg(time) {
      let idx = -1;
      for (let i = 0; i < segments.length; i++) {
        if (time >= segments[i].start) idx = i;
        else break;
      }
      return idx;
    }

    function drawFrame(time) {
      // Background
      if (bgImg) {
        // Cover fill
        const imgRatio = bgImg.naturalWidth / bgImg.naturalHeight;
        const canvasRatio = W / H;
        let drawW, drawH, drawX, drawY;
        if (imgRatio > canvasRatio) {
          drawH = H;
          drawW = H * imgRatio;
          drawX = (W - drawW) / 2;
          drawY = 0;
        } else {
          drawW = W;
          drawH = W / imgRatio;
          drawX = 0;
          drawY = (H - drawH) / 2;
        }
        ctx.drawImage(bgImg, drawX, drawY, drawW, drawH);
        // Scrim overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, W, H);
      } else {
        // Gradient background
        const grad = ctx.createRadialGradient(W/2, H*0.4, 100, W/2, H/2, W*0.8);
        grad.addColorStop(0, '#1a1a2e');
        grad.addColorStop(0.5, '#16213e');
        grad.addColorStop(1, '#0f0f1a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Subtle animated circles
        ctx.globalAlpha = 0.07;
        for (let i = 0; i < 3; i++) {
          const cx = W * (0.2 + 0.3 * i) + Math.sin(time * 0.5 + i) * 80;
          const cy = H * 0.5 + Math.cos(time * 0.3 + i * 2) * 60;
          const r = 200 + 100 * Math.sin(time * 0.2 + i);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, '#3d9bff');
          g.addColorStop(1, 'transparent');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.globalAlpha = 1;
      }

      // Find active lyric
      const activeIdx = findActiveSeg(time);
      const activeSeg = activeIdx >= 0 ? segments[activeIdx] : null;
      const nextSeg = activeIdx >= 0 && activeIdx < segments.length - 1
        ? segments[activeIdx + 1] : null;

      // Draw active lyric with glow
      if (activeSeg && time >= activeSeg.start && time <= activeSeg.end) {
        const lyricText = activeSeg.text || '♪';

        // Text glow
        ctx.save();
        ctx.shadowColor = 'rgba(61, 155, 255, 0.6)';
        ctx.shadowBlur = 30;

        ctx.font = 'bold 64px "Inter", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';

        // Word wrap if text is long
        const maxWidth = W * 0.85;
        const lines = wrapText(ctx, lyricText, maxWidth);
        const lineHeight = 80;
        const startY = H * 0.48 - ((lines.length - 1) * lineHeight) / 2;

        lines.forEach((line, i) => {
          ctx.fillText(line, W / 2, startY + i * lineHeight);
        });

        ctx.restore();
      } else if (!activeSeg || time < segments[0]?.start) {
        // Show "♪" when no active lyric
        ctx.font = 'bold 64px "Inter", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillText('♪', W / 2, H * 0.48);
      }

      // Draw next lyric (smaller, dimmed)
      if (nextSeg) {
        ctx.font = '32px "Inter", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillText(nextSeg.text || '', W / 2, H * 0.62);
      }

      // Progress bar at bottom
      const barY = H - 40;
      const barW = W * 0.7;
      const barX = (W - barW) / 2;
      const barH = 4;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 2);
      ctx.fill();
      const progress = Math.min(time / totalDuration, 1);
      ctx.fillStyle = '#3d9bff';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW * progress, barH, 2);
      ctx.fill();

      // Time display
      ctx.font = '24px "SF Mono", "Menlo", "Consolas", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      ctx.fillText(`${m}:${String(s).padStart(2, '0')}`, W / 2, barY - 16);
    }

    function wrapText(ctx, text, maxWidth) {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines;
    }

    // Use requestAnimationFrame-based render loop synchronized to real-time audio
    return new Promise((resolve, reject) => {
      let stopped = false;

      function tick() {
        if (stopped) return;

        // Time from audio context (synced with the recorded audio)
        const elapsed = audioCtx.currentTime;
        if (elapsed >= totalDuration) {
          // Done
          stopped = true;
          bufferSource.stop();
          recorder.stop();
          done.then(() => {
            audioCtx.close();
            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (document.querySelector('.project-name').value || 'lyrics') + '.webm';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            showToast('✅ Video berhasil diexport!');
            resolve();
          });
          return;
        }

        drawFrame(elapsed);

        // Update progress toast
        const pct = Math.round((elapsed / totalDuration) * 100);
        btnExport.textContent = `⏳ ${pct}%`;

        requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    });
  }

})();
