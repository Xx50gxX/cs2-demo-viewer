#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtualenv
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3.12 -m venv venv
fi

source venv/bin/activate

# Install deps if needed
if ! python -c "import awpy" 2>/dev/null; then
    echo "Installing dependencies..."
    pip install -r backend/requirements.txt
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║        CS2 Demo Viewer — Starting...         ║"
echo "║                                              ║"
echo "║  Open http://127.0.0.1:8765 in your browser  ║"
echo "║                                              ║"
echo "║  Press Ctrl+C to stop the server             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

cd backend
exec uvicorn main:app --host 127.0.0.1 --port 8765
