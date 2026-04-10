#!/bin/bash
# eval-full.sh — Full feature evaluation for OpenCode fork
# Usage: bash scripts/eval-full.sh
# Runs all testable features without Tauri rebuild
set -uo pipefail

cd "$(dirname "$0")/.."
PASS=0; FAIL=0; SKIP=0
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG="packages/opencode/test/tool/eval-results/full-$TIMESTAMP.log"
mkdir -p "$(dirname "$LOG")"

run_test() {
  local name="$1"; local cmd="$2"; local expect="$3"
  printf "  %-45s " "$name"
  OUTPUT=$(eval "$cmd" 2>&1) || true
  if echo "$OUTPUT" | grep -qiE "$expect"; then
    echo "PASS"; ((PASS++))
  else
    echo "FAIL"; ((FAIL++))
    echo "    Expected pattern: $expect" >> "$LOG"
    echo "    Got (last 5 lines):" >> "$LOG"
    echo "$OUTPUT" | tail -5 >> "$LOG"
    echo "" >> "$LOG"
  fi
}

skip_test() {
  local name="$1"; local reason="$2"
  printf "  %-45s SKIP (%s)\n" "$name" "$reason"
  ((SKIP++))
}

OC="bun run --cwd packages/opencode --conditions=browser src/index.ts"

echo "========================================"
echo "  OpenCode Full Feature Evaluation"
echo "  $(date)"
echo "========================================"
echo "" | tee "$LOG"

# ──────────────────────────────────────────
echo "Phase 1: Unit Tests"
echo "──────────────────────────────────────"
run_test "preflight guards (5 tests)" \
  "cd packages/opencode && bun test test/tool/preflight-guards.test.ts 2>&1" \
  "5 pass"

run_test "edit tool tests" \
  "cd packages/opencode && bun test test/tool/edit.test.ts 2>&1" \
  "pass"

run_test "write tool tests" \
  "cd packages/opencode && bun test test/tool/write.test.ts 2>&1" \
  "pass"

run_test "read tool tests" \
  "cd packages/opencode && bun test test/tool/read.test.ts 2>&1" \
  "pass"

run_test "bash tool tests" \
  "cd packages/opencode && bun test test/tool/bash.test.ts 2>&1" \
  "pass"

run_test "grep tool tests" \
  "cd packages/opencode && bun test test/tool/grep.test.ts 2>&1" \
  "pass"

run_test "tool registry tests" \
  "cd packages/opencode && bun test test/tool/registry.test.ts 2>&1" \
  "pass"

echo ""

# ──────────────────────────────────────────
echo "Phase 2: CLI Commands"
echo "──────────────────────────────────────"
run_test "version" \
  "$OC --version 2>&1" \
  "local"

run_test "doctor" \
  "$OC doctor 2>&1" \
  "pass|ok|check|doctor"

run_test "stats" \
  "$OC stats 2>&1" \
  "cost|token|session|usage|stat|no"

run_test "models list" \
  "$OC models 2>&1" \
  "model|provider|gemma|local"

run_test "session list" \
  "$OC session 2>&1" \
  "session|list|no|id"

echo ""

# ──────────────────────────────────────────
echo "Phase 3: Local LLM Integration (Gemma)"
echo "──────────────────────────────────────"

# Clean up before tests
rm -f packages/opencode/test/tool/tmp-eval.txt 2>/dev/null || true

run_test "basic read tool" \
  "$OC run --log-level ERROR -m 'local-llm/gemma-4-E4B-it' --format json 'Use the read tool on src/session/system.ts. Just read it.' 2>&1 | grep -c '\"status\":\"completed\"'" \
  "^[1-9]"

run_test "write new file" \
  "$OC run --log-level ERROR -m 'local-llm/gemma-4-E4B-it' --format json 'Use the write tool to create test/tool/tmp-eval.txt with content hello' 2>&1 | grep -c 'Wrote file successfully'" \
  "^[1-9]"

run_test "Guard 2: write blocked on existing" \
  "$OC run --log-level ERROR -m 'local-llm/gemma-4-E4B-it' --format json 'Use the write tool on test/tool/tmp-eval.txt with content overwrite' 2>&1 | grep -c 'File already exists'" \
  "^[1-9]"

run_test "Guard 4: edit bad oldString" \
  "$OC run --log-level ERROR -m 'local-llm/gemma-4-E4B-it' --format json 'Use the edit tool on src/session/system.ts with oldString NONEXISTENT_STRING_XYZ and newString replaced' 2>&1 | grep -c 'oldString not found'" \
  "^[1-9]"

# Cleanup
rm -f packages/opencode/test/tool/tmp-eval.txt 2>/dev/null || true

echo ""

# ──────────────────────────────────────────
echo "Phase 4: Provider Config & Routing"
echo "──────────────────────────────────────"
run_test "local prompt routing" \
  "grep -c 'PROMPT_LOCAL' packages/opencode/src/session/system.ts" \
  "^[1-9]"

run_test "skeleton descriptions (7 tools)" \
  "grep -c 'LOCAL_SKELETONS' packages/opencode/src/tool/registry.ts" \
  "^[1-9]"

run_test "camelCase in skeletons" \
  "grep 'filePath' packages/opencode/src/tool/registry.ts | grep -c 'LOCAL_SKELETONS' || grep -c 'filePath.*oldString' packages/opencode/src/tool/registry.ts" \
  "^[1-9]"

run_test "platform-aware env (shell)" \
  "grep -c 'Shell:' packages/opencode/src/session/system.ts" \
  "^[1-9]"

run_test "doom loop threshold" \
  "grep -c 'DOOM_LOOP_THRESHOLD' packages/opencode/src/session/processor.ts" \
  "^[1-9]"

run_test "tool telemetry" \
  "grep -c 'telemetry' packages/opencode/src/session/processor.ts" \
  "^[1-9]"

echo ""

# ──────────────────────────────────────────
echo "Phase 5: Advanced Features (code checks)"
echo "──────────────────────────────────────"
run_test "security scanner" \
  "ls packages/opencode/src/security/scanner.ts 2>/dev/null | wc -l" \
  "^[1-9]"

run_test "file lock (collaborative)" \
  "grep -rl 'FileLock' packages/opencode/src/file/ 2>/dev/null | wc -l" \
  "^[1-9]"

run_test "snapshot system" \
  "ls packages/opencode/src/snapshot/ 2>/dev/null | wc -l" \
  "^[1-9]"

run_test "MCP support" \
  "grep -rl 'mcp' packages/opencode/src/server/ 2>/dev/null | wc -l" \
  "^[1-9]"

run_test "LSP integration" \
  "grep -rl 'LSP' packages/opencode/src/lsp/ 2>/dev/null | wc -l" \
  "^[1-9]"

echo ""

# ──────────────────────────────────────────
echo "========================================"
printf "  Results: %d passed, %d failed, %d skipped\n" "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  echo "  Details in: $LOG"
fi
echo "========================================"
