/**
 * CS2 Demo Viewer — Playback Controls
 *
 * Manages play/pause, speed, step forward/back, round navigation.
 * Communicates with the main App module via callbacks.
 */

const Controls = (() => {
  // ── State ──────────────────────────────────────────────────────
  let isPlaying = false;
  let speed = 1.0;   // default real-time speed
  let animationId = null;
  let lastFrameTime = 0;
  let tickInterval = 16;  // ms between ticks at 1x (128 tick / 8 updates per tick ≈ 16ms)
  let onTickCallback = null;

  // ── Init ───────────────────────────────────────────────────────

  function init() {
    document.getElementById("btn-play").addEventListener("click", togglePlay);
    // 64 ticks/sec → 1s=64, 5s=320, 10s=640
    document.getElementById("btn-step-back-10").addEventListener("click", () => step(-640));
    document.getElementById("btn-step-back-5").addEventListener("click",  () => step(-320));
    document.getElementById("btn-step-back").addEventListener("click",    () => step(-64));
    document.getElementById("btn-step-fwd").addEventListener("click",     () => step(64));
    document.getElementById("btn-step-fwd-5").addEventListener("click",   () => step(320));
    document.getElementById("btn-step-fwd-10").addEventListener("click",  () => step(640));
    document.getElementById("btn-prev-round").addEventListener("click", () => prevRound());
    document.getElementById("btn-next-round").addEventListener("click", () => nextRound());
    document.getElementById("speed-select").addEventListener("change", onSpeedChange);

    // Keyboard shortcuts
    document.addEventListener("keydown", onKeyDown);
  }

  // ── Playback ───────────────────────────────────────────────────

  function togglePlay() {
    isPlaying ? pause() : play();
  }

  function play() {
    if (isPlaying) return;
    isPlaying = true;
    const btn = document.getElementById("btn-play");
    if (btn) { btn.textContent = "⏸"; btn.classList.add("active"); }
    lastFrameTime = performance.now();
    _tickAccum = 0;
    _lastAdvanceTime = performance.now();
    _tick();
  }

  function pause() {
    isPlaying = false;
    const btn = document.getElementById("btn-play");
    if (btn) { btn.textContent = "▶"; btn.classList.remove("active"); }
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  // Fractional tick accumulator for smooth playback
  let _tickAccum = 0;
  let _lastAdvanceTime = 0;

  function _tick() {
    if (!isPlaying) return;

    const now = performance.now();
    const elapsed = Math.min(now - lastFrameTime, 100);
    lastFrameTime = now;

    // CS2 demos are 64 ticks/sec → 15.625 ms per tick at 1x
    _tickAccum += (elapsed / 15.625) * speed;

    // Failsafe: force at least 1 tick every 250ms to prevent freeze
    const forceTick = _tickAccum > 0 && _tickAccum < 1 && (now - _lastAdvanceTime) > 250;
    const wholeTicks = forceTick ? 1 : Math.floor(_tickAccum);
    _tickAccum -= wholeTicks;

    if (wholeTicks > 0 && onTickCallback) {
      _lastAdvanceTime = now;
      onTickCallback(wholeTicks);
    }

    animationId = requestAnimationFrame(_tick);
  }

  function step(ticks) {
    if (onTickCallback) onTickCallback(ticks);
  }

  function prevRound() {
    _emitAction("prev-round");
  }

  function nextRound() {
    _emitAction("next-round");
  }

  // ── Speed ──────────────────────────────────────────────────────

  function onSpeedChange(e) {
    speed = parseFloat(e.target.value);
  }

  // ── Keyboard ───────────────────────────────────────────────────

  function onKeyDown(e) {
    // Don't intercept when typing in inputs
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        e.preventDefault();
        step(e.shiftKey ? -320 : e.ctrlKey || e.metaKey ? -640 : -64);
        break;
      case "ArrowRight":
        e.preventDefault();
        step(e.shiftKey ? 320 : e.ctrlKey || e.metaKey ? 640 : 64);
        break;
      case "ArrowUp":
        e.preventDefault();
        nextRound();
        break;
      case "ArrowDown":
        e.preventDefault();
        prevRound();
        break;
    }
  }

  // ── Action Dispatch ────────────────────────────────────────────

  const _actionCallbacks = {};

  function onAction(action, callback) {
    _actionCallbacks[action] = callback;
  }

  function _emitAction(action) {
    if (_actionCallbacks[action]) _actionCallbacks[action]();
  }

  // ── Callbacks ──────────────────────────────────────────────────

  function onTick(callback) {
    onTickCallback = callback;
  }

  // ── Public API ──────────────────────────────────────────────────

  return {
    init,
    play,
    pause,
    togglePlay,
    step,
    prevRound,
    nextRound,
    onTick,
    onAction,
    get isPlaying() { return isPlaying; },
    get speed() { return speed; },
  };
})();
