#!/bin/bash
# CS2 Demo Viewer — Double-click to launch
# This script activates the virtualenv and starts the native desktop app.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtualenv
source venv/bin/activate 2>/dev/null || {
    echo "Virtual environment not found. Please run setup first."
    echo "Press Enter to close this window."
    read
    exit 1
}

# Install deps if needed
python -c "import pywebview" 2>/dev/null || {
    echo "Installing pywebview..."
    pip install pywebview --quiet
}

echo "Starting CS2 Demo Viewer..."
echo ""

# If a .dem file was dropped onto this script, auto-load it
if [ $# -ge 1 ]; then
    python launcher.py "$1"
else
    python launcher.py
fi
