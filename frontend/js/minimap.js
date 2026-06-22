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
    _draw();  // initial blank render
  }

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

    // ── Layer 1: Trails ────────────────────────────────────
    _drawTrails();

    // ── Layer 2: Grenades/Smokes ───────────────────────────
    _drawRoundEvents();

    // ── Layer 3: Kills ─────────────────────────────────────
    _drawKillMarkers();

    // ── Layer 4: Players ───────────────────────────────────
    _drawPlayers();
  }

  // ── Trail Drawing ──────────────────────────────────────────────

  function _drawTrails() {
    if (trailData.length < 2) return;

    const trails = {};
    for (const snap of trailData) {
      if (!snap.players) continue;
      for (const p of snap.players) {
        const sid = p.steamid;
        if (!trails[sid]) trails[sid] = [];
        trails[sid].push([p.X, p.Y]);
      }
    }

    ctx.lineWidth = 1.5 * zoom;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const [sid, points] of Object.entries(trails)) {
      if (points.length < 2) continue;
      const cp = currentTickData.players?.find(p => p.steamid === sid);
      const color = cp?.side === "CT" ? "rgba(74,158,255,0.5)" : "rgba(240,160,64,0.5)";

      ctx.strokeStyle = color;
      ctx.beginPath();
      const [sx, sy] = worldToCanvas(points[0][0], points[0][1]);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < points.length; i++) {
        const [px, py] = worldToCanvas(points[i][0], points[i][1]);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  // ── Event Drawing ───────────────────────────────────────────────

  function _drawRoundEvents() {
    if (!roundEvents || !currentTickData) return;
    const currentTick = currentTickData.tick || 0;

    const visible = (roundEvents.grenades || [])
      .filter(e => (e.tick || 0) <= currentTick);

    for (const g of visible) {
      _drawGrenade(g);
    }
  }

  function _drawGrenade(g) {
    const category = g.category || "";
    const gx = g.X, gy = g.Y;
    if (gx == null || gy == null) return;

    const [px, py] = worldToCanvas(gx, gy);

    if (category === "smoke" && g.is_detonation) {
      // ── SMOKE: cloudy gray blob (no text label) ──────────
      const smokeRadUnits = 144;
      const [cx2] = worldToCanvas(gx + smokeRadUnits, gy);
      const sr = Math.max(Math.abs(cx2 - px), 22 * zoom);

      // Multiple overlapping translucent circles for cloud effect
      const cloudParts = [
        [0, 0, 1.0],           // center
        [-0.3, -0.2, 0.7],     // upper-left
        [0.3, -0.15, 0.65],    // upper-right
        [-0.2, 0.25, 0.6],     // lower-left
        [0.25, 0.2, 0.55],     // lower-right
        [0, -0.35, 0.45],      // top
      ];

      // Soft outer glow
      ctx.fillStyle = "rgba(90,90,100,0.12)";
      ctx.beginPath(); ctx.arc(px, py, sr * 1.4, 0, Math.PI * 2); ctx.fill();

      // Cloud parts
      for (const [dx, dy, alpha] of cloudParts) {
        ctx.fillStyle = `rgba(110,110,120,${alpha * 0.55})`;
        ctx.beginPath();
        ctx.arc(px + dx * sr, py + dy * sr, sr * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }

      // Dashed border
      ctx.strokeStyle = "rgba(180,180,200,0.65)";
      ctx.lineWidth = 1.8 * zoom;
      ctx.setLineDash([6 * zoom, 4 * zoom]);
      ctx.beginPath(); ctx.arc(px, py, sr, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    if (category === "he") {
      // ── HE: red explosion burst ──────────────────────────────
      const r = 8 * zoom;
      // Outer ring
      ctx.strokeStyle = "rgba(255,60,60,0.7)";
      ctx.lineWidth = 2 * zoom;
      ctx.beginPath(); ctx.arc(px, py, r * 2, 0, Math.PI * 2); ctx.stroke();
      // Inner fill
      ctx.fillStyle = "rgba(255,40,40,0.5)";
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      // Cross burst
      ctx.strokeStyle = "#f22";
      ctx.lineWidth = 1.5 * zoom;
      const s = r * 1.3;
      ctx.beginPath(); ctx.moveTo(px - s, py); ctx.lineTo(px + s, py); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, py - s); ctx.lineTo(px, py + s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - s * 0.7, py - s * 0.7); ctx.lineTo(px + s * 0.7, py + s * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px + s * 0.7, py - s * 0.7); ctx.lineTo(px - s * 0.7, py + s * 0.7); ctx.stroke();
      return;
    }

    if (category === "flash") {
      // ── FLASH: yellow starburst ──────────────────────────────
      const r = 9 * zoom;
      ctx.fillStyle = "rgba(255,255,60,0.5)";
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      // Starburst rays
      ctx.strokeStyle = "#ff0";
      ctx.lineWidth = 2 * zoom;
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(angle) * r * 0.5, py + Math.sin(angle) * r * 0.5);
        ctx.lineTo(px + Math.cos(angle) * r * 1.8, py + Math.sin(angle) * r * 1.8);
        ctx.stroke();
      }
      // Center dot
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(px, py, 3 * zoom, 0, Math.PI * 2); ctx.fill();
      return;
    }

    if (category === "molotov") {
      // ── MOLOTOV: orange fire area ────────────────────────────
      const r = 14 * zoom;
      // Fire glow
      const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, "rgba(255,140,20,0.6)");
      grad.addColorStop(0.5, "rgba(255,100,0,0.3)");
      grad.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      // Border
      ctx.strokeStyle = "rgba(255,130,30,0.5)";
      ctx.lineWidth = 1.5 * zoom;
      ctx.setLineDash([3 * zoom, 3 * zoom]);
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    // Throw origin (small white dot)
    if (g.is_throw_origin) {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.arc(px, py, 2.5 * zoom, 0, Math.PI * 2);
      ctx.fill();
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

  // ── Player Drawing ──────────────────────────────────────────────

  function _drawPlayers() {
    if (!currentTickData?.players) return;

    for (const p of currentTickData.players) {
      if (p.X == null || p.Y == null) continue;

      const [px, py] = worldToCanvas(p.X, p.Y);
      const side = p.side || "";
      const isHovered = hoveredPlayer?.steamid === p.steamid;
      const dotR = isHovered ? 9 * zoom : 6 * zoom;
      const color = side === "CT" ? "#3b8eff" : "#e89630";

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

      // White border (thicker for hovered)
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = isHovered ? 2.5 * zoom : 1.8 * zoom;
      ctx.stroke();

      // Player number (abbreviated name, max 4 chars)
      const num = (p.name || "?").slice(0, 4).toUpperCase();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${isHovered ? 9 : 7}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(num, px, py);

      // HP bar below dot
      if (p.health != null) {
        const hpW = 16 * zoom, hpH = 2.5 * zoom;
        const hpX = px - hpW / 2, hpY = py + dotR + 3 * zoom;
        const hpRatio = Math.min(1, Math.max(0, p.health / 100));

        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(hpX - 1, hpY - 1, hpW + 2, hpH + 2);
        ctx.fillStyle = hpRatio > 0.5 ? "#44cc44" : hpRatio > 0.2 ? "#eebb33" : "#ee3333";
        ctx.fillRect(hpX, hpY, hpW * hpRatio, hpH);
      }

      // Name label (only on hover — reduces clutter)
      if (isHovered) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${10*zoom}px sans-serif`;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.name, px, py - dotR - 8 * zoom);
      }
    }
  }

  // ── Mouse Interaction ──────────────────────────────────────────

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    hoveredPlayer = null;
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

      const sideLabel = hoveredPlayer.side === "CT" ? "🔵 CT" : "🟠 T";
      const weaponClean = weapon.replace("weapon_", "").replace("_", " ");

      tooltip.innerHTML = [
        `<strong>${hoveredPlayer.name}</strong> <small>${sideLabel}</small>`,
        `❤️ HP: ${hoveredPlayer.health ?? "?"} | 🔫 ${weaponClean || "?"}`,
        `💣 HE:${util.he||0} 💡 闪:${util.flash||0} 💨 烟:${util.smoke||0} 🔥 火:${util.molotov||0}`,
      ].join("<br>");
    } else if (tooltip) {
      tooltip.classList.add("hidden");
    }

    _draw();
  }

  function onWheel(e) {
    e.preventDefault();
    zoom = Math.max(0.5, Math.min(3.0, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    _draw();
  }

  // ── Public API ──────────────────────────────────────────────────

  return {
    init,
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
