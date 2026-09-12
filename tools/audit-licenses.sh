#!/usr/bin/env bash
# audit-licenses.sh — Re-scan des licenses du projet
# Usage: bash tools/audit-licenses.sh [--format text|json]

set -uo pipefail

FORMAT="text"
[ "${1:-}" = "--format" ] && FORMAT="${2:-text}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Tier licenses
ALLOWED_LICENSES=(
    "MIT" "Apache-2.0" "BSD-2-Clause" "BSD-3-Clause"
    "ISC" "MPL-2.0" "Unlicense" "CC0-1.0"
    "LGPL-2.1-or-later" "LGPL-3.0-or-later"
    "WTFPL" "0BSD"
)

REFUSED_LICENSES=(
    "GPL-1.0" "GPL-2.0" "GPL-3.0"
    "AGPL-1.0" "AGPL-3.0"
    "SSPL-1.0"
    "Commons-Clause"
    "BUSL-1.1"  # Sauf opt-in
    "Elastic-2.0"
    "SSPL"
)

if [ "$FORMAT" = "json" ]; then
    echo "{"
    echo "  "allowed": ["
    first=true
    for lic in "${ALLOWED_LICENSES[@]}"; do
        if [ "$first" = true ]; then first=false; else echo ","; fi
        echo -n "    \"$lic\""
    done
    echo ""
    echo "  ],"
    echo "  "refused": ["
    first=true
    for lic in "${REFUSED_LICENSES[@]}"; do
        if [ "$first" = true ]; then first=false; else echo ","; fi
        echo -n "    \"$lic\""
    done
    echo ""
    echo "  ]"
    echo "}"
else
    echo "================================================="
    echo "  License Audit — Tier Definitions"
    echo "================================================="
    echo
    echo "Tier 1 (ALLOWED, no review needed):"
    for lic in "${ALLOWED_LICENSES[@]}"; do
        echo "  - $lic"
    done
    echo
    echo "Tier 3 (REFUSED, no exceptions):"
    for lic in "${REFUSED_LICENSES[@]}"; do
        echo "  - $lic"
    done
    echo
    echo "Run 'bunx license-checker' or 'cargo deny' for current deps scan."
fi
