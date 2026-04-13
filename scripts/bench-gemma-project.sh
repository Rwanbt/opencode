#!/bin/bash
# bench-gemma-project.sh — Benchmark local LLM on a real Rust project (7 prompts, scored /35)
# Usage: bash scripts/bench-gemma-project.sh [--web]
# Env: BENCH_MODEL (default: local-llm/gemma-4-E4B-it)
#      BENCH_TIMEOUT (per-prompt seconds, default: 240)
#      BENCH_WORKDIR (default: D:/tmp/bench-prism-eq)
set -uo pipefail

cd "$(dirname "$0")/.."

MODEL="${BENCH_MODEL:-local-llm/gemma-4-E4B-it}"
TIMEOUT="${BENCH_TIMEOUT:-240}"
WORKDIR="${BENCH_WORKDIR:-D:/tmp/bench-prism-eq}"
WEB_FLAG=""
[[ "${1:-}" == "--web" ]] && WEB_FLAG="--web"

OC="bun run --cwd packages/opencode --conditions=browser src/index.ts"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESDIR="$WORKDIR/results-$TIMESTAMP"
mkdir -p "$RESDIR"

# Kill any orphaned llama-server to avoid VRAM split
echo "  Pre-flight: checking for duplicate llama-servers..."
LLAMA_COUNT=$(tasklist //FI "IMAGENAME eq llama-server.exe" //NH 2>&1 | grep -c "llama-server" || true)
if [ "$LLAMA_COUNT" -gt 1 ]; then
  echo "  WARNING: $LLAMA_COUNT llama-servers running! Killing all and restarting..."
  taskkill //F //IM llama-server.exe 2>/dev/null || true
  sleep 2
fi

# VRAM check — warn if GPU memory already heavily used
VRAM_USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1 || echo 0)
if [ "${VRAM_USED:-0}" -gt 1000 ] && [ "$LLAMA_COUNT" -eq 0 ]; then
  echo "  WARNING: ${VRAM_USED} MiB VRAM already in use (no llama-server). Other GPU apps may slow inference."
fi

# Clean workdir (keep results dirs)
rm -rf "$WORKDIR/src" "$WORKDIR/tests" "$WORKDIR/Cargo.toml" "$WORKDIR/Cargo.lock" \
       "$WORKDIR/target" "$WORKDIR/.git" "$WORKDIR/.gitignore" "$WORKDIR/PrismEq" \
       "$WORKDIR"/p*.json 2>/dev/null

echo "========================================"
echo "  Gemma Project Benchmark"
echo "  Model: $MODEL"
echo "  Web: ${WEB_FLAG:-off}"
echo "  Timeout: ${TIMEOUT}s/prompt"
echo "  Workdir: $WORKDIR"
echo "  $(date)"
echo "========================================"

PROMPTS=(
  "Create a new Rust library project in the current directory. It should be a CLAP audio plugin using nih-plug. Set up Cargo.toml with nih_plug from git (https://github.com/robbert-vdh/nih-plug.git). Create a minimal compiling plugin struct PrismEq that passes audio through unchanged. Run cargo check and fix any errors."
  "Implement a 7-band parametric equalizer in src/dsp.rs. Each band has: frequency (20-20000 Hz), gain (-24 to +24 dB), Q factor (0.1 to 10), filter type (peak/lowshelf/highshelf/lowpass/highpass). Use biquad filters with Robert Bristow-Johnson Audio EQ Cookbook formulas. Each band should be a BiquadFilter struct with process_sample(input: f32) -> f32."
  "Connect the DSP to the plugin in lib.rs. Add 7 bands as parameters using nih_plug FloatParam for freq/gain/Q and EnumParam for filter type. In process(), apply all 7 bands in series. Recalculate biquad coefficients only when parameters change. Support stereo. Run cargo check and fix errors."
  "Read src/dsp.rs and src/lib.rs. Check for issues with: 1) Denormal float protection 2) Coefficient recalculation thread safety 3) Filter state reset on parameter change causing clicks. Fix any issues you find. Run cargo check."
  "Add an output gain parameter (-12 to +12 dB) and a global bypass toggle. When bypassed, pass audio through with zero CPU. Add a dry/wet mix parameter (0-100%). Run cargo check."
  "Read all source files. Refactor: extract a common calculate_coefficients(filter_type, freq, gain, q, sample_rate) function. Remove any duplication. Make sure it's called correctly. Run cargo check."
  "Create tests/dsp_test.rs. Write tests for: 1) Unity gain: silence in = silence out 2) DC offset: lowpass at 1000Hz should pass DC, highpass should block it 3) Coefficient stability: no NaN or infinity for extreme values (Q=0.1, freq=20, gain=24) 4) Stereo: left and right processed independently. Run cargo test."
)

# Pattern checks per prompt (pipe-separated regexes to grep in src/**/*.rs + tests/**/*.rs)
PATTERNS_1="struct PrismEq|impl Plugin|nih_plug"
PATTERNS_2="struct BiquadFilter|process_sample|cos\(|alpha|Peak|LowShelf|HighShelf|LowPass|HighPass"
PATTERNS_3="FloatParam|EnumParam|fn process|channel|stereo|left|right"
PATTERNS_4="denormal|TINY|MIN_POSITIVE|1e-|EPSILON|reset"
PATTERNS_5="bypass|dry_wet|dry.wet|mix|output_gain|output.gain"
PATTERNS_6="calculate_coefficients"
PATTERNS_7="#\[test\]|assert|silence|unity"
PATTERNS=("$PATTERNS_1" "$PATTERNS_2" "$PATTERNS_3" "$PATTERNS_4" "$PATTERNS_5" "$PATTERNS_6" "$PATTERNS_7")

# Count matching patterns
count_patterns() {
  local dir="$1" patterns="$2"
  local found=0 total=0
  IFS='|' read -ra PATS <<< "$patterns"
  for pat in "${PATS[@]}"; do
    total=$((total + 1))
    if grep -rqE "$pat" "$dir"/src/*.rs "$dir"/tests/*.rs 2>/dev/null; then
      found=$((found + 1))
    fi
  done
  echo "$found/$total"
}

SCORES=()
TOTAL=0

for i in {0..6}; do
  N=$((i + 1))
  echo ""
  echo "--- Prompt $N/7 ---"
  OUTFILE="$WORKDIR/p${N}.json"
  CONT_FLAG=""

  START_SEC=$SECONDS

  # Run with hard timeout
  timeout "${TIMEOUT}s" $OC run --log-level ERROR -m "$MODEL" --format json \
    $WEB_FLAG --dir "$WORKDIR" $CONT_FLAG "${PROMPTS[$i]}" > "$OUTFILE" 2>&1
  RC=$?

  ELAPSED=$((SECONDS - START_SEC))
  STEPS=$(grep -o '"type":"tool_use"' "$OUTFILE" 2>/dev/null | wc -l)

  if [ $RC -eq 124 ]; then
    echo "  TIMEOUT after ${TIMEOUT}s ($STEPS steps)"
  else
    echo "  Completed in ${ELAPSED}s ($STEPS steps)"
  fi

  # Check compilation (subshell to avoid cd side effects)
  COMPILE_PTS=0
  if (cd "$WORKDIR" && cargo check 2>&1 | tail -1 | grep -q "could not compile\|error"); then
    echo "  Compile: FAIL"
  else
    if [ -f "$WORKDIR/Cargo.toml" ] && [ -d "$WORKDIR/src" ]; then
      # Reject trivial template (cargo init default without real plugin code)
      if grep -q "PrismEq\|BiquadFilter\|process_sample\|nih_plug" "$WORKDIR/src/lib.rs" 2>/dev/null || \
         [ -s "$WORKDIR/src/dsp.rs" ]; then
        COMPILE_PTS=3
        echo "  Compile: OK (+3)"
      else
        echo "  Compile: TRIVIAL (no plugin code in lib.rs)"
      fi
    else
      echo "  Compile: NO PROJECT"
    fi
  fi

  # Extra file existence checks per prompt
  case $N in
    2) [ ! -s "$WORKDIR/src/dsp.rs" ] && echo "  WARNING: src/dsp.rs missing or empty" ;;
    7) [ ! -s "$WORKDIR/tests/dsp_test.rs" ] && echo "  WARNING: tests/dsp_test.rs missing or empty" ;;
  esac

  # Check patterns
  PAT_RESULT=$(count_patterns "$WORKDIR" "${PATTERNS[$i]}")
  PAT_FOUND=${PAT_RESULT%%/*}
  PAT_TOTAL=${PAT_RESULT##*/}

  LOGIC_PTS=0
  if [ "$PAT_FOUND" -eq "$PAT_TOTAL" ]; then
    LOGIC_PTS=2
  elif [ "$PAT_FOUND" -gt $((PAT_TOTAL / 2)) ]; then
    LOGIC_PTS=1
  fi
  echo "  Patterns: $PAT_RESULT (logic +$LOGIC_PTS)"

  # Tool usage counts
  READS=$(grep -o '"tool":"read"' "$OUTFILE" 2>/dev/null | wc -l)
  WS=$(grep -o '"tool":"websearch"' "$OUTFILE" 2>/dev/null | wc -l)
  echo "  Reads: $READS calls"
  [ "$WS" -gt 0 ] && echo "  Websearch: $WS calls"

  SCORE=$((COMPILE_PTS + LOGIC_PTS))
  SCORES+=("$SCORE")
  TOTAL=$((TOTAL + SCORE))
  echo "  Score: $SCORE/5"

  # Save per-prompt result
  cat > "$RESDIR/p${N}.txt" <<PEOF
prompt: $N
time: ${ELAPSED}s
steps: $STEPS
timeout: $([ $RC -eq 124 ] && echo yes || echo no)
compile: $([ $COMPILE_PTS -gt 0 ] && echo yes || echo no)
patterns: $PAT_RESULT
logic_pts: $LOGIC_PTS
compile_pts: $COMPILE_PTS
score: $SCORE
reads: $READS
websearch: $WS
PEOF
done

echo ""
echo "========================================"
echo "  TOTAL: $TOTAL / 35"
echo "  Per-prompt: ${SCORES[*]}"
echo "  Results: $RESDIR/"
echo "========================================"

# Write summary
cat > "$RESDIR/summary.md" <<SEOF
# Bench Results — $TIMESTAMP

| Model | Web | Timeout |
|-------|-----|---------|
| $MODEL | ${WEB_FLAG:-off} | ${TIMEOUT}s |

| # | Score | Compile | Patterns | Steps | Time | Websearch |
|---|-------|---------|----------|-------|------|-----------|
SEOF

for i in {0..6}; do
  N=$((i + 1))
  source "$RESDIR/p${N}.txt" 2>/dev/null || true
  echo "| $N | ${SCORES[$i]}/5 | $([ "${compile:-no}" = yes ] && echo OK || echo FAIL) | ${patterns:-?} | ${steps:-?} | ${time:-?} | ${websearch:-0} |" >> "$RESDIR/summary.md"
done

echo "" >> "$RESDIR/summary.md"
echo "**Total: $TOTAL / 35**" >> "$RESDIR/summary.md"
