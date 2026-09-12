#!/usr/bin/env bash
# db-migrate.sh — Migrate DB schema between Unifia versions
# Usage: bash tools/db-migrate.sh [from_version] [to_version]

set -uo pipefail

FROM_VERSION="${1:-0.1.0}"
TO_VERSION="${2:-0.2.0}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Detect DB path
case "$(uname -s)" in
    Darwin) DB_PATH="$HOME/Library/Application Support/unifia/unifia.db" ;;
    Linux) DB_PATH="${XDG_DATA_HOME:-$HOME/.local/share}/unifia/unifia.db" ;;
    *) echo "Unsupported OS"; exit 1 ;;
esac

if [ ! -f "$DB_PATH" ]; then
    echo "No DB found at $DB_PATH"
    exit 0
fi

echo "DB: $DB_PATH"
echo "Migrating: $FROM_VERSION -> $TO_VERSION"

# Backup
BACKUP="${DB_PATH}.bak.$(date +%Y%m%d_%H%M%S)"
cp "$DB_PATH" "$BACKUP"
echo "Backup: $BACKUP"

# Run migrations (placeholder)
echo "Migration $FROM_VERSION -> $TO_VERSION : OK"
echo "Migrations are no-op in v0.1.0 (initial schema)"
