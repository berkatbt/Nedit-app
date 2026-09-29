const Player = (() => {
  const audio = document.getElementById('audio');
  const btnPlay = document.getElementById('btn-play');
  const btnBack = document.getElementById('btn-skip-back');
  const btnFwd = document.getElementById('btn-skip-fwd');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');
  const volSlider = document.getElementById('vol');
  const btnVol = document.getElementById('btn-vol');

  let listeners = [];
  let rafId = null;

  function fmt(t) {
    if (!isFinite(t)) t = 0;
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${String(m).padStart(2,'0')}:${s.toFixed(2).padStart(5,'0')}`;
  }

  function load(file) {
    audio.src = URL.createObjectURL(file);
    audio.load();
  }

  function play() { audio.play(); }
  function pause() { audio.pause(); }
  function toggle() { audio.paused ? play() : pause(); }
  function seek(t) { audio.currentTime = Math.max(0, Math.min(t, audio.duration || 0)); }

  /* ── High-frequency tick loop using requestAnimationFrame ──
     Runs at ~60 fps while audio is playing for buttery smooth playhead.
     Falls back to the native timeupdate event when paused (to still catch
     programmatic seeks). */
  function rafLoop() {
    timeCurrent.textContent = fmt(audio.currentTime);
    listeners.forEach(cb => cb.tick && cb.tick(audio.currentTime));
    rafId = requestAnimationFrame(rafLoop);
  }

  function startRaf() {
    if (rafId !== null) return;
    rafLoop();
  }

  function stopRaf() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  btnPlay.addEventListener('click', toggle);
  btnBack.addEventListener('click', () => seek(audio.currentTime - 5));
  btnFwd.addEventListener('click', () => seek(audio.currentTime + 5));

  audio.addEventListener('play', () => {
    btnPlay.textContent = '⏸';
    startRaf();
  });
  audio.addEventListener('pause', () => {
    btnPlay.textContent = '▶';
    stopRaf();
    // One final tick so the display is accurate at the pause point
    timeCurrent.textContent = fmt(audio.currentTime);
    listeners.forEach(cb => cb.tick && cb.tick(audio.currentTime));
  });
  audio.addEventListener('ended', () => {
    stopRaf();
    btnPlay.textContent = '▶';
  });
  audio.addEventListener('loadedmetadata', () => {
    timeTotal.textContent = fmt(audio.duration);
    listeners.forEach(cb => cb.ready && cb.ready(audio.duration));
  });

  // Fallback: still listen to timeupdate for programmatic seeks while paused
  audio.addEventListener('timeupdate', () => {
    if (audio.paused) {
      timeCurrent.textContent = fmt(audio.currentTime);
      listeners.forEach(cb => cb.tick && cb.tick(audio.currentTime));
    }
  });

  volSlider.addEventListener('input', e => { audio.volume = parseFloat(e.target.value); });
  btnVol.addEventListener('click', () => {
    audio.muted = !audio.muted;
    btnVol.textContent = audio.muted ? '🔇' : '🔊';
  });

  // Spacebar play/pause
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
  });

  function on(handlers) { listeners.push(handlers); }

  return { load, play, pause, toggle, seek, on, el: audio, fmt };
})();