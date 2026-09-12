#!/usr/bin/env bash
# loc-stats.sh — Calcule les stats LOC par section
# Usage: bash tools/loc-stats.sh [--format text|json]

set -uo pipefail

FORMAT="text"
[ "${1:-}" = "--format" ] && FORMAT="${2:-text}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

declare -A stats

# Limit mode : --quick pour limiter à 100 fichiers par ext
QUICK_MODE=false
for arg in "$@"; do
    [ "$arg" = "--quick" ] && QUICK_MODE=true
done
MAX_FILES=100

# Count LOC by extension
for ext in ts tsx js jsx mjs cjs jsonc json yml yaml md mdx sh bash py rs; do
    if [ "$QUICK_MODE" = true ]; then
        # Quick : juste top 5 fichiers par ext
        count=$(find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./.unifia-brand-backup -prune -o -name "*.${ext}" -type f -print 2>/dev/null | head -5 | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    else
        # Full : tous les fichiers
        count=$(find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./.unifia-brand-backup -prune -o -name "*.${ext}" -type f -print 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    fi
    stats[$ext]=${count:-0}
done

# Count by directory
for dir in docs packages scripts tests tools capability-packs; do
    if [ -d "$dir" ]; then
        if [ "$QUICK_MODE" = true ]; then
            count=$(find "$dir" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -10 | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
        else
            count=$(find "$dir" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
        fi
        stats["dir:$dir"]=${count:-0}
    fi
done

total=0
for key in "${!stats[@]}"; do
    total=$((total + ${stats[$key]}))
done

if [ "$FORMAT" = "json" ]; then
    # Limite le comptage à 5 fichiers par ext pour la perf (sample)
    # Le comptage complet est disponible en mode text
    echo "{"
    printf '  "_sample_note": "Limited sample of 5 files per extension for speed",\n'
    printf '  "_see_text_mode": "Run without --format json for full counts",\n'
    first=false
    for key in $(echo "${!stats[@]}" | tr ' ' '\n' | sort -u); do
        if [ -n "$key" ]; then
            printf ',\n  "%s": %d' "$key" "${stats[$key]}"
        fi
    done
    printf ',\n  "total": %d\n}' "$total"
    echo ""
else
    echo "================================================="
    echo "  Unifia LOC Stats"
    echo "================================================="
    echo
    echo "By extension:"
    for ext in ts tsx js jsx mjs cjs jsonc json yml yaml md mdx sh bash py rs; do
        if [ -n "${stats[$ext]:-}" ] && [ "${stats[$ext]}" -gt 0 ]; then
            printf "  %-8s %d\n" ".$ext" "${stats[$ext]}"
        fi
    done
    echo
    echo "By directory:"
    for dir in docs packages scripts tests tools capability-packs; do
        if [ -n "${stats[dir:$dir]:-}" ] && [ "${stats[dir:$dir]}" -gt 0 ]; then
            printf "  %-20s %d\n" "$dir/" "${stats[dir:$dir]}"
        fi
    done
    echo
    printf "  %-20s %d\n" "TOTAL" "$total"
fi
