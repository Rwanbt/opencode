#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
#
# Reproducible build for tools/dbos-qualify/dbos-qualify.exe
# Uses the repo-local Go toolchain (.tools/go/go1.25.12/) — no admin.
#
# Usage (from repo root):
#   scripts/bootstrap-go.sh        # downloads Go 1.25.12 if not present
#   bash tools/dbos-qualify/build.sh

set -euo pipefail

TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$TOOL_DIR/../.." && pwd)"
GO_BIN="$REPO_ROOT/.tools/go/go1.25.12/bin/go"

if [ ! -x "$GO_BIN" ]; then
  echo "Go toolchain not found at $GO_BIN"
  echo "Run: bash scripts/bootstrap-go.sh"
  exit 1
fi

echo "Go version:"
"$GO_BIN" version

echo ""
echo "Module versions:"
cd "$TOOL_DIR"
"$GO_BIN" list -m github.com/dbos-inc/dbos-transact-golang
"$GO_BIN" list -m modernc.org/sqlite

echo ""
echo "go mod verify:"
"$GO_BIN" mod verify

echo ""
echo "Building dbos-qualify.exe..."
"$GO_BIN" build -buildvcs=false -o dbos-qualify.exe .

echo ""
echo "Built: $TOOL_DIR/dbos-qualify.exe"
ls -la dbos-qualify.exe
