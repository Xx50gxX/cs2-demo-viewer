#!/usr/bin/env python3
"""
CS2 Demo Viewer — Native Desktop Launcher

Starts the FastAPI backend in a daemon thread, then opens a native
desktop window (pywebview) pointing at the local server.

Usage:
    python launcher.py                          # Start with empty view
    python launcher.py /path/to/demo.dem        # Start + auto-load demo
"""

import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "backend"))

PORT = 8765
BASE_URL = f"http://127.0.0.1:{PORT}"


# ══════════════════════════════════════════════════════════════════════
# Background FastAPI server
# ══════════════════════════════════════════════════════════════════════

def run_server():
    import uvicorn
    from main import app
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


def wait_for_server(timeout: float = 20.0) -> bool:
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(BASE_URL, timeout=0.5)
            return True
        except Exception:
            time.sleep(0.3)
    return False


# ══════════════════════════════════════════════════════════════════════
# Pre-load a demo via API (so it's ready when the window opens)
# ══════════════════════════════════════════════════════════════════════

def preload_demo(demo_path: str) -> bool:
    import urllib.request, json
    abs_path = str(Path(demo_path).resolve())
    try:
        req = urllib.request.Request(
            f"{BASE_URL}/api/load-path",
            data=json.dumps({"path": abs_path}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=60.0)
        print(f"[i] Pre-loaded: {Path(demo_path).name}")
        return True
    except Exception as e:
        print(f"[!] Pre-load failed: {e}")
        return False


# ══════════════════════════════════════════════════════════════════════
# Native Window (pywebview) or browser fallback
# ══════════════════════════════════════════════════════════════════════

def open_window(auto_demo_path: str | None = None):
    url = BASE_URL
    if auto_demo_path:
        from urllib.parse import quote
        url += f"#autoload={quote(str(Path(auto_demo_path).resolve()))}"

    # Try pywebview native window
    try:
        import webview

        class _Api:
            """JS↔Python bridge: expose native file dialog."""
            def open_file(self):
                result = webview.windows[0].create_file_dialog(
                    webview.OPEN_DIALOG,
                    file_types=("CS2 Demo Files (*.dem)",),
                )
                return result[0] if result else None

        window = webview.create_window(
            title="CS2 Demo Viewer",
            url=url,
            js_api=_Api(),
            width=1440,
            height=900,
            min_size=(1024, 640),
            resizable=True,
            text_select=True,
        )
        webview.start(debug=False, gui="cocoa")
        return
    except ImportError:
        pass

    # Fallback: browser
    print("[i] pywebview not installed — opening in browser.")
    print(f"[i] Visit: {url}")
    import webbrowser
    webbrowser.open(url)
    print("[i] Press Ctrl+C to stop the server.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[i] Shutting down.")


# ══════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════

def main():
    print(f"[i] Starting CS2 Demo Viewer on {BASE_URL}")

    # Start server in daemon thread
    threading.Thread(target=run_server, daemon=True).start()

    if not wait_for_server():
        print("[!] Server failed to start.")
        sys.exit(1)

    print("[i] Server ready.")

    # Auto-load demo from command line argument
    auto_demo = None
    if len(sys.argv) >= 2:
        demo = sys.argv[1]
        if Path(demo).exists():
            auto_demo = demo
            preload_demo(demo)

    open_window(auto_demo)


if __name__ == "__main__":
    main()
