#!/usr/bin/env bash
# wf-list.sh — Liste les GitHub Actions workflows
# Usage: bash tools/wf-list.sh [--verbose]

set -uo pipefail

VERBOSE=false
[ "${1:-}" = "--verbose" ] && VERBOSE=true

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d .github/workflows ]; then
    echo "No .github/workflows directory"
    exit 1
fi

VENV=$(mktemp -d)
uv venv "$VENV" --python 3.13 >/dev/null 2>&1
source "$VENV/bin/activate"
uv pip install --quiet pyyaml >/dev/null 2>&1

echo "================================================="
echo "  GitHub Actions workflows"
echo "================================================="
echo

for yml in .github/workflows/*.yml; do
    name=$(basename "$yml")
    info=$(python3 -c "
import yaml
try:
    with open('$yml') as f:
        d = yaml.safe_load(f)
    name = d.get('name', '<unnamed>')
    on = d.get('on') or d.get(True)
    if isinstance(on, dict):
        triggers = ', '.join(on.keys())
    elif isinstance(on, str):
        triggers = on
    else:
        triggers = 'complex'
    jobs = list(d.get('jobs', {}).keys())
    print(f'name={name}|triggers={triggers}|jobs={','.join(jobs)}')
except Exception as e:
    print(f'name=error|triggers=|jobs=')
" 2>/dev/null)
    
    NAME=$(echo "$info" | cut -d'|' -f1 | sed 's/name=//')
    TRIGGERS=$(echo "$info" | cut -d'|' -f2 | sed 's/triggers=//')
    JOBS=$(echo "$info" | cut -d'|' -f3 | sed 's/jobs=//')
    
    printf "  %-40s %s\n" "$name" "on: $TRIGGERS"
    if [ "$VERBOSE" = true ]; then
        printf "    jobs: %s\n" "$JOBS"
    fi
done

deactivate
rm -rf "$VENV"

[ "$VERBOSE" = false ] && echo "Use --verbose for job details"
