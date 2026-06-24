/**
 * CS2 Demo Viewer — Minimap Renderer
 *
 * Canvas-based 2D minimap: radar background, player positions,
 * movement trails, grenade trajectories, smoke coverage, kill markers.
 */

const Minimap = (() => {
  // ── State ──────────────────────────────────────────────────────
  let canvas, ctx;
  let mapImage = null;
  let mapConfig = null;
  let canvasW = 800, canvasH = 600;   // fallback defaults

  let currentTickData = null;          // { tick, players: [...] }
  let roundEvents = null;              // { kills, grenades }
  let trailData = [];
  let trailLength = 256;
  let zoom = 1.0;
  let panX = 0, panY = 0;
  let hoveredPlayer = null;

  // ── Init ──────────────────────────────────────────────────────

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", () => { hoveredPlayer = null; });
    canvas.addEventListener("wheel", onWheel);
    canvas.addEventListener("click", onClick);
    _draw();  // initial blank render
  }

  // Callback for grenade marker clicks
  let _onGrenadeClick = null;
  function onGrenadeClick(cb) { _onGrenadeClick = cb; }

  function resize() {
    const parent = canvas.parentElement;
    let w = parent ? parent.clientWidth : 0;
    let h = parent ? parent.clientHeight : 0;

    // Fallback if parent has no size yet
    if (w < 50) w = window.innerWidth * 0.7;
    if (h < 50) h = window.innerHeight * 0.7;
    if (w < 100) w = 800;
    if (h < 100) h = 600;

    const dpr = window.devicePixelRatio || 1;
    canvas.style.width  = w + "px";
    canvas.style.height = h + "px";
    canvas.width  = w * dpr;
    canvas.height = h * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    canvasW = w;
    canvasH = h;
    _draw();
  }

  // ── Config ────────────────────────────────────────────────────

  function setMapConfig(config) {
    mapConfig = config;
    console.log("[Minimap] mapConfig set:", config ? config.name : "null");

    if (config && config.radar_file) {
      const img = new Image();
      img.onload = () => {
        mapImage = img;
        console.log("[Minimap] radar image loaded:", config.radar_file);
        _draw();
      };
      img.onerror = () => {
        console.warn("[Minimap] radar image FAILED to load:", config.radar_file);
      };
      img.src = `/maps/${config.radar_file}`;
    }
  }

  // ── Coordinate Conversion ─────────────────────────────────────

  function worldToImage(worldX, worldY) {
    // CS2 overview convention:
    // pos_x,pos_y = world coords at TOP-LEFT of radar image
    // Image Y increases downward, world Y increases northward
    if (!mapConfig) return [0.5, 0.5];
    const { pos_x, pos_y, scale, radar_size } = mapConfig;
    const px = (worldX - pos_x) / scale;
    const py = (pos_y - worldY) / scale;
    return [px / radar_size, py / radar_size];
  }

  function imageToCanvas(nx, ny) {
    const size = Math.min(canvasW, canvasH) * zoom;
    const ox = (canvasW - size) / 2 + panX;
    const oy = (canvasH - size) / 2 + panY;
    return [ox + nx * size, oy + ny * size];
  }

  function worldToCanvas(worldX, worldY) {
    const [nx, ny] = worldToImage(worldX, worldY);
    return imageToCanvas(nx, ny);
  }

  // ── Data Setters ──────────────────────────────────────────────

  function setTickData(data) {
    currentTickData = data;
    if (data && data.players && data.players.length > 0) {
      trailData.push(data);
      while (trailData.length > trailLength) trailData.shift();
    }
  }

  function setRoundEvents(events) {
    roundEvents = events;
  }

  function setTrailLength(len) { trailLength = len; }
  function clearTrails() { trailData = []; }

  // ── Render ────────────────────────────────────────────────────

  function render() {
    _draw();
  }

  function _draw() {
    if (!ctx || !canvas) return;

    const w = canvasW, h = canvasH;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    // Radar image (slightly darkened for IEM-broadcast-like contrast)
    if (mapImage && mapConfig) {
      const size = Math.min(w, h) * zoom;
      const ox = (w - size) / 2 + panX;
      const oy = (h - size) / 2 + panY;
      ctx.globalAlpha = 0.75;
      ctx.drawImage(mapImage, ox, oy, size, size);
      ctx.globalAlpha = 1.0;
    }

    // "No data" overlay
    if (!currentTickData || !currentTickData.players || currentTickData.players.length === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#8899aa";
      ctx.font = `${Math.max(16, w/40)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("加载 Demo 后开始回放", w/2, h/2);
      return;
    }

    // ── Layer 1: Grenades/Smokes ───────────────────────────
    _drawRoundEvents();

    // ── Layer 3: Kills ─────────────────────────────────────
    _drawKillMarkers();

    // ── Layer 4: Players ───────────────────────────────────
    _drawPlayers();

    // ── Layer 5: Kill Feed ─────────────────────────────────
    _drawKillFeed();

    // ── Layer 6: Team Panels ───────────────────────────────
    _drawTeamPanels();
  }

  // ── Event Drawing ───────────────────────────────────────────────

  function _drawRoundEvents() {
    if (!roundEvents || !currentTickData) return;
    const currentTick = currentTickData.tick || 0;

    const GRENADE_EXPIRY = { smoke: 1152, he: 128, flash: 96, molotov: 448 };

    // ── Smoke extinguishes molotov ──────────────────────────
    const smokeDets = (roundEvents.grenades || []).filter(e => e.is_detonation && e.category === "smoke");
    const moloDets  = (roundEvents.grenades || []).filter(e => e.is_detonation && e.category === "molotov");
    const extinguishTick = {}; // molotov entity_id → smoke tick that killed it
    for (const s of smokeDets) {
      for (const m of moloDets) {
        if (m.tick >= s.tick) continue;
        const dx = (s.X||0) - (m.X||0), dy = (s.Y||0) - (m.Y||0);
        if (Math.sqrt(dx*dx+dy*dy) < 260) extinguishTick[m.entity_id] = s.tick;
      }
    }

    const detTicks = {};
    for (const g of (roundEvents.grenades || [])) {
      if (g.is_detonation && g.entity_id) detTicks[g.entity_id] = g.tick;
    }

    const allGrenades = (roundEvents.grenades || [])
      .filter(e => {
        if ((e.tick || 0) > currentTick) return false;
        if (e.is_detonation) {
          const endTick = extinguishTick[e.entity_id];
          if (endTick && currentTick > endTick) return false;
          return (currentTick - e.tick) < (GRENADE_EXPIRY[e.category] || 200);
        }
        if (e.is_trajectory || e.is_throw_origin) {
          const dt = detTicks[e.entity_id];
          if (dt && currentTick >= dt) return false;
        }
        return true;
      });

    // ── Group by entity_id, sorted by tick ──────────────────
    const entityPaths = {};
    for (const g of allGrenades) {
      const eid = g.entity_id;
      if (!eid) continue;
      if (!entityPaths[eid]) entityPaths[eid] = [];
      entityPaths[eid].push(g);
    }

    // ── Draw trajectories: connect points in tick order ────
    for (const [eid, points] of Object.entries(entityPaths)) {
      if (points.length < 2) continue;
      // Sort by tick
      points.sort((a, b) => (a.tick || 0) - (b.tick || 0));

      const cat = points[0].category || "";
      const colors = { smoke: "#999", he: "#e55", flash: "#ee5", molotov: "#e95" };
      const color = colors[cat] || "#bbb";

      // Draw segment by segment (grows over time as points accumulate)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * zoom;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([5 * zoom, 4 * zoom]);
      ctx.lineCap = "round";

      ctx.beginPath();
      const [sx, sy] = worldToCanvas(points[0].X, points[0].Y);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < points.length; i++) {
        const [px, py] = worldToCanvas(points[i].X, points[i].Y);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
    }

    // ── Draw markers on top (only detonations and latest trajectory point) ──
    for (const g of allGrenades) {
      if (g.is_trajectory) continue;
      _drawGrenade(g);
    }

    // ── Draw weapon fire tracers ─────────────────────────
    _drawTracers();
  }

  // ── Tracer Drawing ──────────────────────────────────────────────

  function _drawTracers() {
    if (!roundEvents?.weapon_fires || !currentTickData) return;
    const currentTick = currentTickData.tick || 0;
    const TRACER_DURATION = 40; // ticks (625ms at 64tick)

    const recentShots = roundEvents.weapon_fires.filter(
      w => w.tick <= currentTick && w.tick > currentTick - TRACER_DURATION
    );

    // Build a map of steamid → (latest pitch, yaw, X, Y) from current tick data
    const playerAim = {};
    if (currentTickData.players) {
      for (const p of currentTickData.players) {
        playerAim[p.steamid] = {
          pitch: p.pitch || 0, yaw: p.yaw || 0,
          X: p.X, Y: p.Y,
          side: p.side || '',
        };
      }
    }

    for (const w of recentShots) {
      const wx = w.X, wy = w.Y;
      if (wx == null || wy == null) continue;

      const aim = playerAim[w.steamid];
      if (!aim) continue;

      const [px, py] = worldToCanvas(wx, wy);
      const age = currentTick - w.tick;
      const alpha = Math.max(0.15, 0.7 * (1 - age / TRACER_DURATION));

      // Draw tracer in canvas space (same direction as player arrow)
      const yawRad = (-aim.yaw) * (Math.PI / 180);
      const tracerLen = 300; // canvas pixels at zoom=1
      const ex = px + Math.cos(yawRad) * tracerLen * zoom;
      const ey = py + Math.sin(yawRad) * tracerLen * zoom;

      const color = aim.side === 'ct' || aim.side === 'CT'
        ? `rgba(140,200,255,${alpha})`
        : `rgba(255,220,100,${alpha})`;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.0 * zoom;
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // Small muzzle flash at origin
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 2 * zoom * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function _drawGrenade(g) {
    const category = g.category || "";
    const gx = g.X, gy = g.Y;
    if (gx == null || gy == null) return;

    const [px, py] = worldToCanvas(gx, gy);

    // ── SMOKE: irregular blob (Source 2 style) ─────────────
    if (category === "smoke" && g.is_detonation) {
      const smokeRadUnits = 144;
      const [cx2] = worldToCanvas(gx + smokeRadUnits, gy);
      const sr = Math.max(Math.abs(cx2 - px), 18 * zoom);

      // Draw irregular blob using multiple offset circles
      const offsets = [
        [0, 0, 0.95], [0.25, 0.1, 0.7], [-0.2, -0.15, 0.65],
        [0.15, -0.25, 0.55], [-0.3, 0.2, 0.5], [0.05, 0.3, 0.45],
        [-0.15, 0.05, 0.75], [0.2, -0.05, 0.6],
      ];
      ctx.fillStyle = "rgba(100,105,115,0.3)";
      for (const [ox, oy, s] of offsets) {
        ctx.beginPath();
        ctx.arc(px + ox * sr, py + oy * sr, sr * s, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    // ── HE: simple red explosion dot ───────────────────────
    if (category === "he") {
      if (g.is_throw_origin) return;
      ctx.fillStyle = "rgba(230,50,50,0.6)";
      ctx.beginPath(); ctx.arc(px, py, 6 * zoom, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,80,80,0.8)";
      ctx.lineWidth = 1.5 * zoom;
      ctx.beginPath(); ctx.arc(px, py, 6 * zoom, 0, Math.PI * 2); ctx.stroke();
      return;
    }

    // ── FLASH: white starburst ─────────────────────────────
    if (category === "flash") {
      const r = 4 * zoom;
      const spikes = 6;
      const outerR = r * 3;
      const innerR = r * 1.2;

      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const radius = i % 2 === 0 ? outerR : innerR;
        const sx = px + Math.cos(angle) * radius;
        const sy = py + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();

      // Bright center
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(px, py, r * 0.8, 0, Math.PI * 2); ctx.fill();
      return;
    }

    // ── MOLOTOV: orange area (skip throw origin) ───────────
    if (category === "molotov") {
      if (g.is_throw_origin) return;
      const r = 12 * zoom;
      ctx.fillStyle = "rgba(220,110,30,0.3)";
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(240,140,50,0.6)";
      ctx.lineWidth = 1.5 * zoom;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
      return;
    }
  }

  function _drawKillMarkers() {
    if (!roundEvents?.kills || !currentTickData) return;
    const currentTick = currentTickData.tick || 0;

    const recentKills = roundEvents.kills.filter(k => {
      const kt = k.tick || 0;
      return kt <= currentTick && kt > currentTick - 256;
    });

    for (const k of recentKills) {
      if (k.X == null || k.Y == null) continue;
      const [px, py] = worldToCanvas(k.X, k.Y);
      const age = currentTick - (k.tick || 0);
      const alpha = Math.max(0.2, 1 - age / 256);

      ctx.strokeStyle = `rgba(255,50,50,${alpha})`;
      ctx.lineWidth = 2 * zoom;
      const s = 5 * zoom;
      ctx.beginPath();
      ctx.moveTo(px - s, py - s);
      ctx.lineTo(px + s, py + s);
      ctx.moveTo(px + s, py - s);
      ctx.lineTo(px - s, py + s);
      ctx.stroke();
    }
  }

  // ── Kill Feed ────────────────────────────────────────────────────

  // ── Team Panels ─────────────────────────────────────────────────

  function _drawTeamPanels() {
    if (!currentTickData?.players) return;
    const pz = zoom;
    const rowH = 22 * pz;
    const fs = 12 * pz;

    const ct = currentTickData.tick || 0;
    const pickups = roundEvents?.item_pickups || [];
    const wf = roundEvents?.weapon_fires || [];
    const grenades = roundEvents?.grenades || [];

    const inv = {};
    for (const p of currentTickData.players) {
      inv[p.steamid] = { weapon: "", armor: 0, defuser: false, he: 0, flash: 0, smoke: 0, molotov: 0 };
    }
    for (const ip of pickups) {
      if (ip.tick > ct) continue;
      const sid = ip.steamid;
      if (!inv[sid]) continue;
      const item = ip.item || "";
      if (item === "vest") inv[sid].armor = 1;
      if (item === "vesthelm") inv[sid].armor = 2;
      if (item === "defuser") inv[sid].defuser = true;
    }
    for (const w of wf) {
      if (w.tick > ct) continue;
      if (inv[w.steamid]) inv[w.steamid].weapon = (w.weapon || "").replace("weapon_", "");
    }
    for (const g of grenades) {
      if (g.tick > ct || !g.is_detonation) continue;
      const sid = g.thrower_steamid;
      if (!inv[sid]) continue;
      if (g.category === "he") inv[sid].he++;
      if (g.category === "flash") inv[sid].flash++;
      if (g.category === "smoke") inv[sid].smoke++;
      if (g.category === "molotov") inv[sid].molotov++;
    }

    const ctPlayers = currentTickData.players.filter(p => (p.side||"").toUpperCase() === "CT");
    const tPlayers  = currentTickData.players.filter(p => (p.side||"").toUpperCase() === "T");

    const panelW = Math.min(280 * pz, canvasW * 0.28);
    const panelH = 6 * rowH + 6 * pz;
    const bottomY = canvasH - panelH - 4;

    _drawOneTeam(ctPlayers, inv, 4, bottomY, panelW, rowH, fs, "#3b8eff", "CT", pz);
    _drawOneTeam(tPlayers, inv, canvasW - panelW - 4, bottomY, panelW, rowH, fs, "#e6c830", "T", pz);
  }

  function _drawOneTeam(players, inv, px, py, panelW, rowH, fs, color, label, pz) {
    if (players.length === 0) return;
    const totalH = players.length * rowH + 8 * pz;

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(px, py, panelW, totalH);

    ctx.fillStyle = color;
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(label, px + 6, py + fs + 4);

    players.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const sid = p.steamid;
      const info = inv[sid] || {};
      const y = py + (i + 1) * rowH + fs + 2;
      const dead = p.health != null && p.health <= 0;

      // HP bar (bigger)
      const hpW = 40 * pz, hpH = 5 * pz;
      const hpX = px + 6, hpY = y - hpH;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(hpX, hpY, hpW, hpH);
      const hpRatio = Math.min(1, Math.max(0, (p.health || 0) / 100));
      ctx.fillStyle = dead ? "#333" : (hpRatio > 0.5 ? "#4f4" : hpRatio > 0.2 ? "#fa0" : "#f44");
      ctx.fillRect(hpX, hpY, hpW * hpRatio, hpH);

      // HP number
      ctx.fillStyle = dead ? "rgba(255,255,255,0.25)" : "#fff";
      ctx.font = `bold ${fs * 0.7}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(dead ? "✕" : String(p.health || 0), hpX + hpW/2, hpY - 2);

      // Name
      const nameX = hpX + hpW + 6;
      ctx.fillStyle = dead ? "rgba(255,255,255,0.25)" : "#fff";
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = "left";
      const shortName = (p.name || "?").slice(0, 10);
      ctx.fillText(shortName, nameX, y + 1);

      // Weapon
      const wepName = (info.weapon || "").slice(0, 10);
      ctx.fillStyle = dead ? "rgba(200,200,200,0.25)" : "rgba(200,200,200,0.8)";
      ctx.font = `${fs * 0.8}px sans-serif`;
      ctx.fillText(wepName, nameX, y + 1 + fs * 0.9);

      // Armor / Defuser
      ctx.font = `${fs * 0.7}px sans-serif`;
      const iconX = px + panelW - 8;
      ctx.textAlign = "right";
      let extras = [];
      if (info.armor >= 2) extras.push("🛡");
      else if (info.armor === 1) extras.push("🛡");
      if (info.defuser) extras.push("🔧");
      ctx.fillText(extras.join(" "), iconX, y + 1);
    }
    ctx.textAlign = "left";
  }

  function _drawKillFeed() {
    if (!roundEvents?.kills || !currentTickData) return;
    const currentTick = currentTickData.tick || 0;
    const KILL_FEED_DURATION = 640; // ticks (~10s at 64tick)
    const MAX_ITEMS = 4;

    const recentKills = roundEvents.kills
      .filter(k => k.tick <= currentTick && k.tick > currentTick - KILL_FEED_DURATION)
      .slice(-MAX_ITEMS);

    if (recentKills.length === 0) return;

    const lineH = 30 * zoom;
    const fontSize = 14 * zoom;
    const panelW = 280 * zoom;
    const panelH = recentKills.length * lineH + 12 * zoom;
    const padX = canvasW - panelW - 10;
    const padY = 10;

    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(padX, padY, panelW, panelH);

    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = "left";

    for (let i = 0; i < recentKills.length; i++) {
      const k = recentKills[i];
      const age = currentTick - k.tick;
      const alpha = Math.max(0.3, 1 - age / KILL_FEED_DURATION);
      const y = padY + (i + 1) * lineH;

      const killer = (k.attacker_name || "?").slice(0, 12);
      const victim = (k.victim_name || "?").slice(0, 12);
      const weapon = (k.weapon || "").replace("weapon_", "");
      const hs = k.headshot ? " 💀" : "";

      const killerSide = k.attacker_side || "";
      const kColor = killerSide === "ct" || killerSide === "CT"
        ? `rgba(130,180,255,${alpha})`
        : `rgba(255,210,80,${alpha})`;

      const x = padX + 6;
      ctx.fillStyle = kColor;
      ctx.fillText(killer, x, y);
      const kw = ctx.measureText(killer).width;

      ctx.fillStyle = `rgba(200,200,200,${alpha})`;
      ctx.fillText("  " + weapon.toUpperCase() + "  ", x + kw, y);
      const ww = ctx.measureText("  " + weapon.toUpperCase() + "  ").width;

      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillText(victim, x + kw + ww, y);

      if (hs) {
        ctx.fillStyle = `rgba(255,60,60,${alpha})`;
        ctx.fillText(hs, x + kw + ww + ctx.measureText(victim).width + 4, y);
      }
    }
  }

  function _drawWeaponIcon(ctx, x, y, weaponName, alpha) {
    const key = (weaponName || "").replace("weapon_", "");
    const w = 7 * zoom;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ddd";

    if (/ak47|galil|famas|aug|sg556/.test(key)) {
      // Rifle silhouette
      ctx.fillRect(x - w * 1.3, y - w * 0.5, w * 2.6, w);
      ctx.fillRect(x - w * 0.3, y + w * 0.5, w * 0.5, w * 0.7);
    } else if (/m4a1|m4a4/.test(key) || /^mp[579]|mac10|ump|bizon|p90/.test(key)) {
      ctx.fillRect(x - w * 1.2, y - w * 0.45, w * 2.4, w * 0.9);
      ctx.fillRect(x - w * 0.1, y + w * 0.45, w * 0.5, w * 0.6);
    } else if (/awp|ssg|scout|scar|g3sg1/.test(key)) {
      ctx.fillRect(x - w * 1.8, y - w * 0.25, w * 3.6, w * 0.5);
    } else if (/deagle|elite|p250|fiveseven|tec9|usp|hkp|glock|cZ75/.test(key)) {
      ctx.fillRect(x - w * 0.8, y - w * 0.4, w * 1.6, w * 0.8);
    } else if (/nova|xm1014|mag7|sawed|m249|negev/.test(key)) {
      ctx.fillRect(x - w * 1, y - w * 0.5, w * 2, w);
    } else if (/knife|bayonet/.test(key)) {
      ctx.beginPath();
      ctx.moveTo(x, y - w * 1.2);
      ctx.lineTo(x + w * 0.5, y + w);
      ctx.lineTo(x - w * 0.5, y + w);
      ctx.closePath(); ctx.fill();
    } else if (/hegrenade|frag/.test(key)) {
      ctx.fillStyle = "#e44";
      ctx.beginPath(); ctx.arc(x, y, w * 0.8, 0, Math.PI * 2); ctx.fill();
    } else if (/flash/.test(key)) {
      ctx.fillStyle = "#ee4";
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 === 0 ? w : w * 0.5;
        const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      }
      ctx.closePath(); ctx.fill();
    } else if (/smoke/.test(key)) {
      ctx.fillStyle = "#999";
      ctx.beginPath(); ctx.arc(x, y, w * 0.9, 0, Math.PI * 2); ctx.fill();
    } else if (/molotov|incendiary|inferno/.test(key)) {
      ctx.fillStyle = "#e84";
      ctx.beginPath(); ctx.arc(x, y, w * 0.8, 0, Math.PI * 2); ctx.fill();
    } else if (/decoy/.test(key)) {
      ctx.fillStyle = "#8a8";
      ctx.beginPath(); ctx.arc(x, y, w * 0.7, 0, Math.PI * 2); ctx.fill();
    } else if (/taser|zeus/.test(key)) {
      ctx.strokeStyle = "#ddd"; ctx.lineWidth = zoom;
      ctx.beginPath(); ctx.moveTo(x, y - w); ctx.lineTo(x, y + w); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - w * 0.5, y - w * 0.5); ctx.lineTo(x + w * 0.5, y - w * 0.5); ctx.stroke();
    } else {
      ctx.fillRect(x - w, y - w * 0.5, w * 2, w);
    }
    ctx.globalAlpha = 1;
  }

  // ── Player Drawing ──────────────────────────────────────────────

  function _drawPlayers() {
    if (!currentTickData?.players) return;

    for (const p of currentTickData.players) {
      if (p.X == null || p.Y == null) continue;

      const [px, py] = worldToCanvas(p.X, p.Y);
      const side = p.side || "";
      const isHovered = hoveredPlayer?.steamid === p.steamid;
      const dotR = isHovered ? 11 * zoom : 8 * zoom;
      const color = side.toUpperCase() === "CT" ? "#3b8eff" : "#e6c830";
      const dead = (p.health != null && p.health <= 0);

      if (dead) {
        // ── Dead player: X cross ──────────────────────────
        const s = dotR * 1.2;
        ctx.strokeStyle = side.toUpperCase() === "CT" ? "rgba(59,142,255,0.7)" : "rgba(230,200,48,0.7)";
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath();
        ctx.moveTo(px - s, py - s); ctx.lineTo(px + s, py + s);
        ctx.moveTo(px + s, py - s); ctx.lineTo(px - s, py + s);
        ctx.stroke();
        if (isHovered) {
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${10*zoom}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(p.name, px, py - dotR - 8 * zoom);
        }
        // skip alive-drawing below, continue to next player
      } else {

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.arc(px + 1, py + 1, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Dot fill
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fill();

      // White border
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = isHovered ? 2.5 * zoom : 1.8 * zoom;
      ctx.stroke();

      // Abbreviated name inside dot
      const num = (p.name || "?").slice(0, 4).toUpperCase();
      ctx.fillStyle = dead ? "rgba(255,255,255,0.5)" : "#fff";
      ctx.font = `bold ${isHovered ? 9 : 7}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(num, px, py);

      // Direction arrow (triangle)
      if (p.yaw != null) {
        const yawRad = (-p.yaw) * (Math.PI / 180);
        const dx = Math.cos(yawRad);
        const dy = Math.sin(yawRad);
        const px2 = Math.cos(yawRad + Math.PI / 2);  // perpendicular
        const py2 = Math.sin(yawRad + Math.PI / 2);

        const tip   = dotR + 12 * zoom;
        const base  = dotR + 3 * zoom;
        const wing  = 4.5 * zoom;

        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(px + dx * tip,  py + dy * tip);
        ctx.lineTo(px + dx * base + px2 * wing, py + dy * base + py2 * wing);
        ctx.lineTo(px + dx * base - px2 * wing, py + dy * base - py2 * wing);
        ctx.closePath();
        ctx.fill();
      }

      // HP bar below
      if (p.health != null) {
        const hpW = 16 * zoom, hpH = 2.5 * zoom;
        const hpX = px - hpW / 2, hpY = py + dotR + 3 * zoom;
        const hpRatio = Math.min(1, Math.max(0, p.health / 100));
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(hpX - 1, hpY - 1, hpW + 2, hpH + 2);
        ctx.fillStyle = hpRatio > 0.5 ? "#44cc44" : hpRatio > 0.2 ? "#eebb33" : "#ee3333";
        ctx.fillRect(hpX, hpY, hpW * hpRatio, hpH);
      }

      // Name on hover
      if (isHovered) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${10*zoom}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.name, px, py - dotR - 8 * zoom);
      }
      } // end else (alive)
    }
  }

  // ── Mouse Interaction ──────────────────────────────────────────

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    hoveredPlayer = null;
    let nearGrenade = false;

    // Check grenade markers first (so we can show pointer cursor)
    const currentTick = currentTickData?.tick || 0;
    const visibleGrenades = (roundEvents?.grenades || [])
      .filter(g => (g.tick || 0) <= currentTick && g.is_detonation);
    for (const g of visibleGrenades) {
      if (g.X == null || g.Y == null) continue;
      const [px, py] = worldToCanvas(g.X, g.Y);
      if (Math.hypot(mx - px, my - py) < 14) { nearGrenade = true; break; }
    }

    if (currentTickData?.players) {
      for (const p of currentTickData.players) {
        if (p.X == null || p.Y == null) continue;
        const [px, py] = worldToCanvas(p.X, p.Y);
        if (Math.hypot(mx - px, my - py) < 12) {
          hoveredPlayer = p;
          break;
        }
      }
    }

    const tooltip = document.getElementById("tooltip");
    if (hoveredPlayer && tooltip) {
      tooltip.classList.remove("hidden");
      tooltip.style.left = (e.clientX - canvas.getBoundingClientRect().left + 15) + "px";
      tooltip.style.top  = (e.clientY - canvas.getBoundingClientRect().top - 60) + "px";

      // Look up weapon and utility from global player metadata
      const sid = hoveredPlayer.steamid;
      const meta = window._PLAYER_META?.[sid] || {};
      const weapon = meta.weapon || "";
      const util = meta.utility || {};

      const sideLabel = hoveredPlayer.side?.toUpperCase() === "CT" ? "🔵 CT" : "🟡 T";
      const weaponClean = weapon.replace("weapon_", "").replace("_", " ");

      tooltip.innerHTML = [
        `<strong>${hoveredPlayer.name}</strong> <small>${sideLabel}</small>`,
        `❤️ HP: ${hoveredPlayer.health ?? "?"} | 🔫 ${weaponClean || "?"}`,
        `💣 HE:${util.he||0} 💡 闪:${util.flash||0} 💨 烟:${util.smoke||0} 🔥 火:${util.molotov||0}`,
      ].join("<br>");
    } else if (tooltip) {
      tooltip.classList.add("hidden");
    }

    canvas.style.cursor = nearGrenade ? "pointer" : (hoveredPlayer ? "default" : "default");
    _draw();
  }

  function onWheel(e) {
    e.preventDefault();
    zoom = Math.max(0.5, Math.min(3.0, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    _draw();
  }

  function onClick(e) {
    if (!currentTickData) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const HIT_RADIUS = 14;

    // Check grenade markers AND trajectory points
    const currentTick = currentTickData.tick || 0;
    const visibleGrenades = (roundEvents?.grenades || [])
      .filter(g => (g.tick || 0) <= currentTick)
      .filter(g => g.is_detonation || g.is_throw_origin || g.is_trajectory);

    for (const g of visibleGrenades) {
      if (g.X == null || g.Y == null) continue;
      const [px, py] = worldToCanvas(g.X, g.Y);
      if (Math.hypot(mx - px, my - py) < HIT_RADIUS) {
        if (_onGrenadeClick) _onGrenadeClick(g);
        return;
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  return {
    init,
    onGrenadeClick,
    resize,
    setMapConfig,
    setTickData,
    setRoundEvents,
    setTrailLength,
    clearTrails,
    render,
    worldToCanvas,
    get canvasW() { return canvasW; },
    get canvasH() { return canvasH; },
  };
})();
