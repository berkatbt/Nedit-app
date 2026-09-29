/* Background — gambar / video latar di belakang lirik pada preview.
   Video mengikuti transport audio (play/pause) dan diputar berulang. */
const Background = (() => {
  const stage    = document.getElementById('preview-canvas');
  const video    = document.getElementById('bg-video');
  const image    = document.getElementById('bg-image');
  const clearBtn = document.getElementById('btn-bg-clear');

  let objectUrl = null;
  let mode = null;              // null | 'image' | 'video'
  let active = true;            // timeline clip range covers the playhead?

  function isSupported(file) {
    return !!file && /^(image|video)\//.test(file.type || '');
  }

  function playVideo() {
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  // Detach current media and free its object URL.
  function release() {
    if (video.getAttribute('src')) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    image.removeAttribute('src');
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    mode = null;
  }

  /** Mirrors the current mode + timeline range onto the stage. */
  function apply() {
    const showVideo = mode === 'video' && active;
    const showImage = mode === 'image' && active;

    video.classList.toggle('hidden', !showVideo);
    image.classList.toggle('hidden', !showImage);
    stage.classList.toggle('has-bg', !!mode && active);
    clearBtn.classList.toggle('hidden', !mode);

    if (mode === 'video') {
      if (showVideo && !Player.el.paused) playVideo();
      else if (!showVideo) video.pause();
    }
  }

  function setFromFile(file) {
    if (!isSupported(file)) return false;

    release();
    objectUrl = URL.createObjectURL(file);
    mode = file.type.startsWith('video/') ? 'video' : 'image';
    active = true;

    if (mode === 'video') {
      video.src = objectUrl;
      video.load();
    } else {
      image.src = objectUrl;
    }

    apply();
    return true;
  }

  function clear() {
    release();
    apply();
  }

  /** Called by the timeline: the media clip only spans part of the project. */
  function setActive(on) {
    on = !!on;
    if (on === active) return;
    active = on;
    apply();
  }

  function hasBackground() { return mode !== null; }
  function getMode() { return mode; }

  // Keep the background in sync with the audio transport.
  Player.el.addEventListener('play',  () => { if (mode === 'video') playVideo(); });
  Player.el.addEventListener('pause', () => { if (mode === 'video') video.pause(); });
  Player.el.addEventListener('ended', () => {
    if (mode !== 'video') return;
    video.pause();
    video.currentTime = 0;
  });

  return { setFromFile, clear, setActive, hasBackground, getMode, isSupported };
})();
