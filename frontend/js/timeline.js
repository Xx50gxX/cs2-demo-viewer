/**
 * CS2 Demo Viewer — Timeline Module
 *
 * Manages the timeline slider and mini event-mark canvas above it.
 * Emits events via callbacks when the user scrubs the timeline.
 */

const Timeline = (() => {
  // ── State ──────────────────────────────────────────────────────
  let slider, canvas, ctx;
  let tickStart = 0, tickEnd = 1, currentTick = 0;
  let events = [];          // [{tick, type: 'kill'|'grenade'|'smoke'|'bomb'}, ...]
  let onSeekCallback = null;
  let canvasW = 800, canvasH = 20;

  // ── Init ───────────────────────────────────────────────────────

  function init() {
    slider = document.getElementById("timeline-slider");
    canvas = document.getElementById("timeline-canvas");
    if (canvas) {
      ctx = canvas.getContext("2d");
    }
    slider.addEventListener("input", onSliderInput);
    window.addEventListener("resize", resizeTimeline);
    resizeTimeline();
  }

  function resizeTimeline() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvasW = rect.width;
    canvasH = 20;
    canvas.width = canvasW;
    canvas.height = canvasH;
    canvas.style.width = canvasW + "px";
    canvas.style.height = canvasH + "px";
    drawEventMarks();
  }

  // ── Set Range ──────────────────────────────────────────────────

  function setRange(start, end) {
    tickStart = start;
    tickEnd = end;
    slider.min = start;
    slider.max = end;
    slider.step = Math.max(1, Math.floor((end - start) / 2000));
    drawEventMarks();
  }

  function setEvents(evtList) {
    events = evtList;
    drawEventMarks();
  }

  function setTick(tick) {
    currentTick = Math.max(tickStart, Math.min(tickEnd, tick));
    slider.value = currentTick;
    updateLabel();
  }

  function updateLabel() {
    const label = document.getElementById("tick-label");
    if (label) {
      label.textContent = `Tick ${currentTick}`;
    }
  }

  // ── Event Markers ──────────────────────────────────────────────

  function drawEventMarks() {
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvasW, canvasH);

    const range = tickEnd - tickStart;
    if (range <= 0) return;

    // Group events into buckets to avoid overcrowding
    const bucketSize = Math.max(1, Math.floor(range / canvasW));
    const buckets = {};

    for (const evt of events) {
      const t = evt.tick || 0;
      if (t < tickStart || t > tickEnd) continue;
      const bucketIdx = Math.floor((t - tickStart) / bucketSize);
      if (!buckets[bucketIdx]) buckets[bucketIdx] = [];
      buckets[bucketIdx].push(evt);
    }

    const barH = canvasH;
    for (const [bi, evts] of Object.entries(buckets)) {
      const x = (Number(bi) / (canvasW / bucketSize)) * canvasW;
      let hasKill = false, hasGrenade = false;

      for (const e of evts) {
        if (e.type === "kill") hasKill = true;
        else hasGrenade = true;
      }

      if (hasKill) {
        ctx.fillStyle = "#f44";
        ctx.fillRect(x, barH - 6, 2, 6);
      }
      if (hasGrenade) {
        ctx.fillStyle = "#fa0";
        ctx.fillRect(x + (hasKill ? 3 : 0), barH - 3, 2, 3);
      }
    }

    // Current position line
    if (currentTick >= tickStart) {
      const cx = ((currentTick - tickStart) / range) * canvasW;
      ctx.strokeStyle = "rgba(233,69,96,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, barH);
      ctx.stroke();
    }
  }

  // ── Events ─────────────────────────────────────────────────────

  function onSliderInput() {
    currentTick = parseInt(slider.value);
    updateLabel();
    drawEventMarks();
    if (onSeekCallback) onSeekCallback(currentTick);
  }

  function onSeek(callback) {
    onSeekCallback = callback;
  }

  // ── Public API ──────────────────────────────────────────────────

  return {
    init,
    setRange,
    setTick,
    setEvents,
    onSeek,
    drawEventMarks,
    resizeTimeline,
    getCurrentTick: () => currentTick,
    getRange: () => ({ start: tickStart, end: tickEnd }),
  };
})();
