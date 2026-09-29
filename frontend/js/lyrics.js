const Lyrics = (() => {
  let segments = [];   // {start, end, text}
  let activeIdx = -1;
  let listeners = [];

  function parseLRC(lrc) {
    const raw = lrc.split('\n').map(l => {
      const m = l.match(/\[(\d+):(\d+\.\d+)\](.*)/);
      if (!m) return null;
      return {
        start: parseInt(m[1]) * 60 + parseFloat(m[2]),
        end: 0,
        text: m[3].trim()
      };
    }).filter(Boolean);

    // Fill end times
    for (let i = 0; i < raw.length; i++) {
      raw[i].end = i < raw.length - 1 ? raw[i + 1].start : raw[i].start + 3;
    }
    return raw;
  }

  function load(lrc) {
    segments = parseLRC(lrc);
    activeIdx = -1;
    notify('load');
    notify('active', -1);
  }

  function sync(time) {
    let idx = -1;
    for (let i = 0; i < segments.length; i++) {
      if (time >= segments[i].start) idx = i;
      else break;
    }
    if (idx !== activeIdx) {
      activeIdx = idx;
      notify('active', idx);
    }
  }

  function get() { return segments; }
  function getActive() { return activeIdx >= 0 ? segments[activeIdx] : null; }
  function getActiveIdx() { return activeIdx; }

  function update(idx, patch) {
    if (!segments[idx]) return;
    Object.assign(segments[idx], patch);
    notify('update', idx);
  }

  function remove(idx) {
    if (!segments[idx]) return;
    segments.splice(idx, 1);
    if (activeIdx >= segments.length) activeIdx = segments.length - 1;
    notify('remove', idx);
  }

  /** Re-order by start time — dragging clips on the timeline can shuffle them. */
  function sort() {
    const active = activeIdx >= 0 ? segments[activeIdx] : null;
    segments.sort((a, b) => a.start - b.start);
    activeIdx = active ? segments.indexOf(active) : -1;
    notify('update', activeIdx);
  }

  function toLRC() {
    const fmt = t => {
      const m = Math.floor(t / 60);
      const s = t % 60;
      return `[${String(m).padStart(2,'0')}:${s.toFixed(2).padStart(5,'0')}]`;
    };
    return segments.map(s => `${fmt(s.start)}${s.text}`).join('\n');
  }

  function on(cb) { listeners.push(cb); }
  function notify(event, payload) {
    listeners.forEach(cb => cb(event, payload));
  }

  return { load, sync, get, getActive, getActiveIdx, update, remove, sort, toLRC, on };
})();