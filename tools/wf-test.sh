#!/usr/bin/env bash
# wf-test.sh — Dry-run a workflow locally (act-style)
# Usage: bash tools/wf-test.sh <workflow.yml>

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "${1:-}" ]; then
    echo "Usage: $0 <workflow.yml>"
    echo "  Ex: $0 .github/workflows/test.yml"
    exit 1
fi

WF="$1"
if [ ! -f "$WF" ]; then
    echo "Workflow not found: $WF"
    exit 1
fi

# Check if 'act' is available
if command -v act >/dev/null 2>&1; then
    echo "Using 'act' for local workflow test..."
    act -W "$WF" --dryrun
else
    echo "'act' not installed. Parsing workflow manually..."
    
    VENV=$(mktemp -d)
    uv venv "$VENV" --python 3.13 >/dev/null 2>&1
    source "$VENV/bin/activate"
    uv pip install --quiet pyyaml >/dev/null 2>&1
    
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    python3 "$SCRIPT_DIR/wf-parse.py" "$WF"
    deactivate
    rm -rf "$VENV"
fi
