/**
 * CS2 Demo Viewer — Application Controller
 */

const App = (() => {
  // ── Global State ───────────────────────────────────────────────
  let state = {
    demoId: null,
    filename: "",
    metadata: null,
    currentRound: 0,
    currentTick: 0,
    roundData: null,
    allEvents: null,
    roundList: [],
    isLoaded: false,
  };

  const API = "http://127.0.0.1:8765";

  async function apiCall(path, options = {}) {
    const url = API + path;
    console.log("[API]", options.method || "GET", url);
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      console.error("[API] ERROR", res.status, text);
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const json = await res.json();
    console.log("[API] OK", url, `(${JSON.stringify(json).length} chars)`);
    return json;
  }

  // ── Init ───────────────────────────────────────────────────────

  function init() {
    console.log("[App] Initializing...");

    const canvas = document.getElementById("minimap-canvas");
    Minimap.init(canvas);
    Timeline.init();
    Controls.init();

    Controls.onTick((delta) => advanceTick(delta));
    Controls.onAction("prev-round", prevRound);
    Controls.onAction("next-round", nextRound);
    Timeline.onSeek((tick) => seekToTick(tick));

    document.getElementById("file-input").addEventListener("change", onFileSelected);
    document.querySelectorAll(".evt-filter").forEach(cb =>
      cb.addEventListener("change", () => renderEventList())
    );
    document.getElementById("trail-select").addEventListener("change", (e) =>
      Minimap.setTrailLength(parseInt(e.target.value))
    );

    Minimap.render();
    handleAutoLoad();
    console.log("[App] Init complete. Waiting for demo load...");
  }

  // ── Auto-Load ──────────────────────────────────────────────────

  function handleAutoLoad() {
    const hash = window.location.hash;
    const match = hash.match(/autoload=(.+)/);
    if (match) {
      const demoPath = decodeURIComponent(match[1]);
      console.log("[App] Auto-loading:", demoPath);
      loadDemoByPath(demoPath);
    }
  }

  async function loadDemoByPath(demoPath) {
    showLoading(`正在加载 ${demoPath.split('/').pop()}...`);
    try {
      const result = await apiCall("/api/load-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: demoPath }),
      });
      console.log("[App] loadDemoByPath OK, demo_id:", result.demo_id);
      onDemoLoaded(result);
    } catch (err) {
      showError(`加载失败: ${err.message}`);
    } finally {
      hideLoading();
    }
  }

  // ── File Upload ────────────────────────────────────────────────

  async function onFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    showLoading(`正在解析 ${file.name}...`);
    console.log("[App] Uploading file:", file.name, `(${(file.size/1e6).toFixed(0)}MB)`);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiCall("/api/load", { method: "POST", body: formData });
      console.log("[App] Upload OK, demo_id:", result.demo_id);
      onDemoLoaded(result);
    } catch (err) {
      showError(`上传失败: ${err.message}`);
    } finally {
      hideLoading();
    }
  }

  function showError(msg) {
    console.error("[App] ERROR:", msg);
    document.getElementById("load-status").textContent = "❌ " + msg;
    alert(msg);
  }

  // ── After load ─────────────────────────────────────────────────

  function onDemoLoaded(result) {
    console.log("[App] onDemoLoaded, map:", result.metadata.map_name);
    state.demoId = result.demo_id;
    state.filename = result.filename;
    state.metadata = result.metadata;

    if (result.metadata.map_config) {
      console.log("[App] Setting map config:", result.metadata.map_config.name);
      Minimap.setMapConfig(result.metadata.map_config);
    }

    updateInfoBar();
    updatePlayerList();
    renderRoundList();

    // Load first round (this will trigger rendering)
    loadRound(1).then(() => {
      console.log("[App] Initial round loaded, rendering complete");
    });

    state.isLoaded = true;
    document.getElementById("load-status").textContent = "✅ 加载完成";
    loadAllEvents();
  }

  async function loadAllEvents() {
    try {
      const events = await apiCall(`/api/demo/${state.demoId}/events`);
      state.allEvents = events;
      const markers = [];
      for (const k of (events.kills || []))
        markers.push({ tick: k.tick, type: "kill" });
      for (const g of (events.grenades || []))
        markers.push({ tick: g.tick, type: "grenade" });
      Timeline.setEvents(markers);
    } catch (err) {
      console.warn("loadAllEvents failed:", err);
    }
  }

  // ── Round Navigation ───────────────────────────────────────────

  async function loadRound(roundNum) {
    console.log("[App] loadRound:", roundNum);
    if (!state.demoId) {
      console.warn("[App] loadRound: no demoId");
      return;
    }

    const rounds = state.metadata?.rounds || [];
    if (roundNum < 1 || roundNum > rounds.length) {
      console.warn("[App] loadRound: out of range", roundNum, "/", rounds.length);
      return;
    }

    state.currentRound = roundNum;
    state.roundData = null;
    state.currentTick = 0;
    Minimap.clearTrails();
    Minimap.setRoundEvents(null);

    showLoading(`加载第 ${roundNum} 回合...`);

    try {
      const url = `/api/demo/${state.demoId}/round/${roundNum}?tick_step=4`;
      const data = await apiCall(url);
      console.log("[App] Round data received:", data.round_num, "|", data.ticks.length, "tick snapshots |", data.tick_start, "-", data.tick_end);

      state.roundData = data;
      state.currentTick = data.tick_start || 0;

      Timeline.setRange(state.currentTick, data.tick_end || state.currentTick + 1);
      Minimap.setRoundEvents(data.events || {});

      // Seek to first tick → this triggers the render
      seekToTick(state.currentTick);

      updateInfoBar();
      highlightCurrentRound();
      renderEventList();

      console.log("[App] Round loaded. currentTickData:", Minimap.render ? "renderer ready" : "renderer MISSING");
    } catch (err) {
      console.error("[App] loadRound FAILED:", err);
      showError(`回合加载失败: ${err.message}`);
    } finally {
      hideLoading();
    }
  }

  function prevRound() {
    if (state.currentRound > 1) loadRound(state.currentRound - 1);
  }
  function nextRound() {
    const max = state.metadata?.total_rounds || 0;
    if (state.currentRound < max) loadRound(state.currentRound + 1);
  }

  // ── Tick Navigation ────────────────────────────────────────────

  function advanceTick(delta) {
    if (!state.roundData) return;
    // Advance by raw game ticks — seekToTick snaps to nearest data point
    const newTick = state.currentTick + delta;
    const maxTick = state.roundData.tick_end || 0;
    if (newTick > maxTick) { Controls.pause(); nextRound(); return; }
    if (newTick < (state.roundData.tick_start || 0)) { seekToTick(state.roundData.tick_start || 0); return; }
    seekToTick(newTick);
  }

  function seekToTick(tick) {
    if (!state.roundData?.ticks) return;

    state.currentTick = tick;
    const ticks = state.roundData.ticks;

    // Snap to nearest available tick (important for downsampled data)
    const step = state.roundData.tick_step || 1;
    const targetTick = Math.round(tick / step) * step;

    let best = ticks[0];
    let bestDist = Math.abs(ticks[0].tick - targetTick);
    for (const t of ticks) {
      const dist = Math.abs(t.tick - targetTick);
      if (dist < bestDist) { best = t; bestDist = dist; }
    }

    if (best) {
      Minimap.setTickData(best);
      Minimap.render();
      Timeline.setTick(best.tick);
      updateTimerDisplay();
      updatePlayerMeta(best.tick);  // weapon + utility for tooltip
    }
  }

  // Build per-player metadata (weapon, utility) at current tick
  function updatePlayerMeta(currentTick) {
    const meta = {};
    const weaponFires = state.allEvents?.weapon_fires || [];
    const grenades = state.allEvents?.grenades || [];
    const allPlayers = state.metadata?.players || [];

    // Initialize all players
    for (const p of allPlayers) {
      meta[p.steamid] = { weapon: "", utility: { he: 0, flash: 0, smoke: 0, molotov: 0 } };
    }

    // Find current weapon per player (last weapon_fire before currentTick)
    for (const wf of weaponFires) {
      if (wf.tick <= currentTick && meta[wf.steamid]) {
        meta[wf.steamid].weapon = wf.weapon;
      }
    }

    // Count grenades thrown up to currentTick (only this round)
    const rdStart = state.roundData?.round_info?.freeze_end || 0;
    for (const g of grenades) {
      if (g.tick > currentTick || g.tick < rdStart) continue;
      const sid = g.thrower_steamid;
      if (!sid || !meta[sid]) continue;
      const cat = g.category;
      if (cat === "smoke") meta[sid].utility.smoke++;
      else if (cat === "flash") meta[sid].utility.flash++;
      else if (cat === "he") meta[sid].utility.he++;
      else if (cat === "molotov") meta[sid].utility.molotov++;
    }

    window._PLAYER_META = meta;
  }

  // ── UI ─────────────────────────────────────────────────────────

  function updateInfoBar() {
    const meta = state.metadata;
    document.getElementById("info-filename").textContent = state.filename || "未加载";
    document.getElementById("info-map").textContent = meta?.map_name || "—";
    document.getElementById("info-round").textContent = `回合 ${state.currentRound}/${meta?.total_rounds || "—"}`;
    updateTimerDisplay();
  }

  function updateTimerDisplay() {
    const rd = state.roundData;
    if (!rd || !rd.round_info) {
      document.getElementById("info-tick").textContent = `Tick ${state.currentTick}`;
      return;
    }

    const ri = rd.round_info;
    const ct = state.currentTick;

    // CS2 = 64 ticks/sec
    const FREEZE_TIME = 12; // seconds
    const ROUND_TIME  = 115; // 1:55

    // 1. Freeze time phase (before freeze_end)
    if (ct < ri.freeze_end) {
      const remaining = Math.max(0, (ri.freeze_end - ct) / 64);
      document.getElementById("info-tick").innerHTML =
        `<span style="color:#f44">⏱ 冻结 ${remaining.toFixed(1)}s</span>`;
      return;
    }

    // 2. Bomb planted → bomb timer countdown
    const bombPlant = state.roundData.events?.grenades?.find(
      g => g.category === 'smoke' && g.tick <= ct
    );
    // Actually, check bomb events from global events
    const bombPlantedTick = _getBombPlantedTick(ct);

    const ROUND_END_TICK = ri.official_end || rd.tick_end;

    if (bombPlantedTick) {
      const bombElapsed = (ct - bombPlantedTick) / 64;
      const bombRemaining = Math.max(0, 40 - bombElapsed);
      if (bombRemaining > 0) {
        document.getElementById("info-tick").innerHTML =
          `<span style="color:#f80">💣 ${bombRemaining.toFixed(1)}s</span>`;
        return;
      }
    }

    // 3. Normal play — elapsed time
    const elapsed = (ct - ri.freeze_end) / 64;
    const remaining = Math.max(0, ROUND_TIME - elapsed);

    const mins = Math.floor(elapsed / 60);
    const secs = Math.floor(elapsed % 60);
    const color = remaining < 15 ? "#f44" : remaining < 30 ? "#fa0" : "#fff";

    document.getElementById("info-tick").innerHTML =
      `<span style="color:${color}">⏱ ${mins}:${String(secs).padStart(2,'0')} / ${Math.floor(remaining/60)}:${String(Math.floor(remaining%60)).padStart(2,'0')}</span>`;
  }

  function _getBombPlantedTick(currentTick) {
    if (!state.allEvents) return null;
    const plants = (state.allEvents.bomb_events || []).filter(
      e => e.event === 'bomb_planted' && e.tick <= currentTick
    );
    if (plants.length === 0) return null;
    // Return most recent plant in current round
    const plant = plants[plants.length - 1];
    if (plant.tick >= (state.roundData?.round_info?.freeze_end || 0)) {
      return plant.tick;
    }
    return null;
  }

  function renderRoundList() {
    const container = document.getElementById("round-list");
    const rounds = state.metadata?.rounds || [];
    container.innerHTML = "";
    for (const r of rounds) {
      const btn = document.createElement("button");
      btn.className = "round-btn";
      btn.textContent = `R${r.round_num}`;
      btn.title = `回合 ${r.round_num}`;
      btn.addEventListener("click", () => { Controls.pause(); loadRound(r.round_num); });
      container.appendChild(btn);
    }
    highlightCurrentRound();
  }

  function highlightCurrentRound() {
    document.querySelectorAll(".round-btn").forEach(btn => {
      btn.classList.toggle("active", btn.textContent === `R${state.currentRound}`);
    });
  }

  function updatePlayerList() {
    const container = document.getElementById("player-list");
    container.innerHTML = (state.metadata?.players || []).map(p =>
      `<div class="player-row"><span class="p-name">${p.name||"?"}</span><span class="p-side ${p.side||""}">${p.side||"?"}</span></div>`
    ).join("");
  }

  function renderEventList() {
    const container = document.getElementById("event-list");
    const showK = document.querySelector(".evt-filter[data-type='kill']")?.checked ?? true;
    const showG = document.querySelector(".evt-filter[data-type='grenade']")?.checked ?? true;
    const events = state.roundData?.events;
    if (!events) { container.innerHTML = '<div class="event-item">—</div>'; return; }

    let items = [];
    if (showK) for (const k of (events.kills||[])) {
      items.push({ type:"kill", tick:k.tick, icon:"💀", text:`${k.attacker_name||"?"} → ${k.victim_name||"?"} (${k.weapon||"?"})` });
    }
    if (showG) for (const g of (events.grenades||[])) {
      const t = g.grenade_type || g.category || "道具";
      items.push({ type:"grenade", tick:g.tick, icon:_grenIcon(t), text:`${g.thrower||"?"} → ${t}` });
    }

    items.sort((a,b) => (a.tick||0)-(b.tick||0));
    container.innerHTML = items.map(i =>
      `<div class="event-item ${i.type}" data-tick="${i.tick}"><span class="evt-icon">${i.icon}</span><span class="evt-tick">T${i.tick}</span><span>${i.text}</span></div>`
    ).join("");

    container.querySelectorAll(".event-item").forEach(el =>
      el.addEventListener("click", () => { Controls.pause(); seekToTick(parseInt(el.dataset.tick)); })
    );
  }

  function _grenIcon(t) {
    const g = (t||"").toLowerCase();
    if (g.includes("smoke")) return "💨";
    if (g.includes("flash")) return "💡";
    if (g.includes("he")||g.includes("frag")) return "💣";
    if (g.includes("molotov")||g.includes("incendiary")) return "🔥";
    return "🔸";
  }

  function showLoading(msg) {
    let o = document.getElementById("loading-overlay");
    if (!o) {
      o = document.createElement("div"); o.id = "loading-overlay";
      o.innerHTML = `<div id="loading-spinner"><div class="spinner"></div><div id="loading-msg"></div></div>`;
      document.body.appendChild(o);
    }
    o.classList.remove("hidden");
    o.querySelector("#loading-msg").textContent = msg;
  }
  function hideLoading() {
    const o = document.getElementById("loading-overlay");
    if (o) o.classList.add("hidden");
  }

  // ── Start ──────────────────────────────────────────────────────

  init();
  console.log("✅ CS2 Demo Viewer ready.");

  return { loadRound, prevRound, nextRound, seekToTick, getState: () => state };
})();
