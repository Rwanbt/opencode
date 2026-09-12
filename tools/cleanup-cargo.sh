#!/usr/bin/env bash
# cleanup-cargo.sh — Nettoie les artifacts Rust/Cargo
# Usage: bash tools/cleanup-cargo.sh [--dry-run]

set -uo pipefail

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

mapfile -t cargo_paths < <(find . -name "Cargo.toml" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null)

if [ ${#cargo_paths[@]} -eq 0 ]; then
    echo "No Cargo.toml found"
    exit 0
fi

echo "Found ${#cargo_paths[@]} Cargo.toml"

for path in "${cargo_paths[@]}"; do
    dir=$(dirname "$path")
    if [ -d "$dir/target" ]; then
        SIZE=$(du -sh "$dir/target" 2>/dev/null | cut -f1)
        echo "  $dir/target: $SIZE"
        if [ "$DRY_RUN" = false ]; then
            rm -rf "$dir/target"
        fi
    fi
    if [ -f "$dir/Cargo.lock" ]; then
        echo "  $dir/Cargo.lock: present"
        if [ "$DRY_RUN" = false ]; then
            rm -f "$dir/Cargo.lock"
        fi
    fi
done

[ "$DRY_RUN" = true ] && echo "Dry-run (no changes)" || echo "Cleanup complete"
