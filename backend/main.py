"""
CS2 Demo Viewer — FastAPI Backend

Provides REST API for:
- Loading .dem files (via upload OR local file path)
- Retrieving demo metadata (map, players, rounds)
- Getting tick-level player positions per round
- Getting all in-game events (kills, grenades, etc.)
"""

import shutil
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from parser import load_demo, get_cached_parser
from map_config import get_map_config

app = FastAPI(title="CS2 Demo Viewer API", version="0.2.0")

# CORS — allow frontend from any origin (pywebview / local browser)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Paths ──────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent.parent
DEMOS_DIR = BASE_DIR / "demos"
MAPS_DIR = BASE_DIR / "maps"
FRONTEND_DIR = BASE_DIR / "frontend"

DEMOS_DIR.mkdir(exist_ok=True)


# ── Request Models ────────────────────────────────────────────────────

class LoadPathRequest(BaseModel):
    path: str


# ── Helper ────────────────────────────────────────────────────────────

def _parse_and_summarize(demo_path: str, filename: str) -> dict:
    """Parse a demo file and return the standard load response."""
    parser = load_demo(demo_path)
    metadata = parser.get_metadata()
    events = parser.get_events()

    map_config = get_map_config(metadata["map_name"])
    metadata["map_config"] = map_config

    # demo_id = the filename stem without extension (stable, human-readable)
    demo_id = Path(demo_path).stem

    return {
        "demo_id": demo_id,
        "filename": filename,
        "metadata": metadata,
        "event_summary": {
            "total_kills": len(events.get("kills", [])),
            "total_grenades": len(events.get("grenades", [])),
            "total_damages": len(events.get("damages", [])),
        },
    }


# ── Upload & Parse ────────────────────────────────────────────────────

@app.post("/api/load")
async def api_load(file: UploadFile = File(...)):
    """Upload a .dem file, parse it, and return demo metadata."""
    if not file.filename or not file.filename.endswith(".dem"):
        raise HTTPException(400, "Please upload a .dem file")

    # Save with original name — reuse if already exists
    safe_name = Path(file.filename).name  # strip any path components
    save_path = DEMOS_DIR / safe_name

    if not save_path.exists():
        try:
            with open(save_path, "wb") as f:
                shutil.copyfileobj(file.file, f)
        except Exception as e:
            raise HTTPException(500, f"Failed to save file: {e}")

    try:
        return _parse_and_summarize(str(save_path), file.filename)
    except Exception as e:
        if not any(DEMOS_DIR.glob(safe_name)):
            save_path.unlink(missing_ok=True)
        raise HTTPException(500, f"Failed to parse demo: {e}")


@app.post("/api/load-path")
def api_load_path(req: LoadPathRequest):
    """
    Load a demo from a local file path (no upload needed).

    The path must be an absolute path to a .dem file on disk.
    This is the preferred method for desktop/native usage.
    """
    demo_path = Path(req.path).resolve()
    if not demo_path.exists():
        raise HTTPException(404, f"File not found: {demo_path}")
    if not demo_path.suffix == ".dem":
        raise HTTPException(400, "Must be a .dem file")

    try:
        return _parse_and_summarize(str(demo_path), demo_path.name)
    except Exception as e:
        raise HTTPException(500, f"Failed to parse demo: {e}")


# ── Demo Data ──────────────────────────────────────────────────────────

def _get_parser(demo_id: str):
    """Resolve parser by demo_id (which is the filename stem)."""
    # Try exact match first
    path = DEMOS_DIR / f"{demo_id}.dem"
    if not path.exists():
        # Search in demos dir
        candidates = list(DEMOS_DIR.glob("*.dem"))
        for c in candidates:
            if c.stem == demo_id:
                path = c
                break
        else:
            # Also check parser cache for paths outside demos dir
            from parser import _parser_cache
            for cached_path in _parser_cache:
                if Path(cached_path).stem == demo_id:
                    parser = _parser_cache[cached_path]
                    return parser
            raise HTTPException(404, f"Demo '{demo_id}' not found. Load it via /api/load or /api/load-path first.")

    parser = get_cached_parser(str(path))
    if parser is None:
        raise HTTPException(400, "Demo not yet parsed. Load it first.")
    return parser


@app.get("/api/demo/{demo_id}/metadata")
def api_metadata(demo_id: str):
    parser = _get_parser(demo_id)
    meta = parser.get_metadata()
    meta["map_config"] = get_map_config(meta["map_name"])
    return {"demo_id": demo_id, "metadata": meta}


@app.get("/api/demo/{demo_id}/tick/{tick_num}")
def api_tick(demo_id: str, tick_num: int):
    parser = _get_parser(demo_id)
    return parser.get_tick_snapshot(tick_num)


@app.get("/api/demo/{demo_id}/round/{round_num}")
def api_round(demo_id: str, round_num: int, tick_step: int = 4):
    """Get tick-level data and events for a round. tick_step=4 = ~32 fps."""
    parser = _get_parser(demo_id)
    data = parser.get_round(round_num, tick_step=tick_step)
    meta = parser.get_metadata()
    data["map_config"] = get_map_config(meta["map_name"])
    return data


@app.get("/api/demo/{demo_id}/events")
def api_events(demo_id: str):
    parser = _get_parser(demo_id)
    return parser.get_events()


@app.get("/api/demo/{demo_id}/rounds")
def api_rounds(demo_id: str):
    parser = _get_parser(demo_id)
    meta = parser.get_metadata()
    return {"demo_id": demo_id, "rounds": meta.get("rounds", [])}


# ── List cached demos ─────────────────────────────────────────────────

@app.get("/api/demos")
def api_list_demos():
    """List all loaded demos (for quick-switch in the UI)."""
    from parser import _parser_cache
    demos = []
    for path_str, parser in _parser_cache.items():
        try:
            meta = parser.get_metadata()
            demos.append({
                "demo_id": Path(path_str).stem,
                "path": path_str,
                "map_name": meta.get("map_name", "?"),
                "total_rounds": meta.get("total_rounds", 0),
                "total_ticks": meta.get("total_ticks", 0),
            })
        except Exception:
            pass
    return {"demos": demos}


# ── Map Info ───────────────────────────────────────────────────────────

@app.get("/api/maps/{map_name}")
def api_map_config(map_name: str):
    config = get_map_config(map_name)
    if config is None:
        raise HTTPException(404, f"Map '{map_name}' not supported")
    return config


# ── Static Files (Frontend + Maps) ────────────────────────────────────
# IMPORTANT: Do NOT mount on "/" — it interferes with API POST routes.
# Instead, mount sub-paths and serve index.html via explicit routes.

if FRONTEND_DIR.exists():
    # Serve CSS and JS subdirectories
    css_dir = FRONTEND_DIR / "css"
    js_dir = FRONTEND_DIR / "js"
    if css_dir.exists():
        app.mount("/css", StaticFiles(directory=str(css_dir)), name="css")
    if js_dir.exists():
        app.mount("/js", StaticFiles(directory=str(js_dir)), name="js")

if MAPS_DIR.exists():
    app.mount("/maps", StaticFiles(directory=str(MAPS_DIR)), name="maps")


# ── Root / index.html serve ────────────────────────────────────────────

if FRONTEND_DIR.exists():
    from fastapi.responses import FileResponse, HTMLResponse

    @app.get("/", response_class=HTMLResponse)
    async def serve_index():
        content = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
        return HTMLResponse(content=content)


# ── Entry Point ────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8765, reload=True)
