#!/bin/sh
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
# FC-13 DBOS writer + post-cut inspector. Runs the REAL DBOS Go binary
# with its system DB on the tested disk. WRITE mode posts /runs (the
# StartRunWorkflow durable step commit is the acknowledged transition)
# and signals READY on stdout. INSPECT mode reads back the run state.
# All applets are invoked via /bin/busybox explicitly: the official
# Alpine initramfs ships a reduced /bin symlink subset. HTTP goes
# through the bun client bundle (fc13-dbos-post.js): busybox nc/wget
# proved unreliable in this initramfs (empty responses).
BB=/bin/busybox
PAYLOAD=/mnt/payload
STORE=/mnt/store
ITER="${FC13_ITERATION:-0}"
# shellcheck disable=SC2034
# RUNID_IN is consumed by fc13-dbos-post.js via exported FC13_RUN_ID

dbos_base() {
  LOG="$1"
  i=0
  while [ $i -lt 150 ]; do
    BASE=$($BB grep -o "dbos-real-qualify listening on http://127.0.0.1:[0-9]*" "$LOG" | $BB grep -o "127.0.0.1:[0-9]*" | $BB head -1)
    [ -n "$BASE" ] && { $BB echo "$BASE"; return 0; }
    $BB sleep 0.2
    i=$((i + 1))
  done
  return 1
}

if [ "$FC13_MODE" = "inspect" ]; then
  export M0_STORE_DIR="$STORE/dbos"
  export M0_APP_NAME="unifia-fc13"
  "$PAYLOAD/fc13-dbos" > /tmp/dbos-inspect.log 2>&1 &
  DBOS_PID=$!
  BASE=$(dbos_base /tmp/dbos-inspect.log) || { echo "FC13-RESULT dbos iter=$ITER NO-BINARY"; exit 0; }
  OUT=$("$PAYLOAD/bun" "$PAYLOAD/fc13-dbos-post.js" "$BASE" 2>&1)
  kill $DBOS_PID 2>/dev/null
  echo "$OUT" | $BB grep -a FC13-RESULT || echo "FC13-RESULT dbos iter=$ITER INVALID [$OUT]"
  exit 0
fi

export M0_STORE_DIR="$STORE/dbos"
export M0_APP_NAME="unifia-fc13"
$BB mkdir -p "$STORE/dbos"
"$PAYLOAD/fc13-dbos" > /tmp/dbos.log 2>&1 &
DBOS_PID=$!
BASE=$(dbos_base /tmp/dbos.log) || { echo "DBOS-DID-NOT-BIND"; kill $DBOS_PID 2>/dev/null; exit 1; }
OUT=$("$PAYLOAD/bun" "$PAYLOAD/fc13-dbos-post.js" "$BASE" 2>&1)
RUNID=$(echo "$OUT" | $BB grep -a DBOS-POST-OK | $BB grep -o "run-[a-z0-9-]*" | $BB head -1)
if [ -z "$RUNID" ]; then echo "DBOS-START-FAILED base=[$BASE] out=[$OUT] logtail=[$(/bin/busybox tail -3 /tmp/dbos.log)]"; kill $DBOS_PID 2>/dev/null; exit 1; fi
echo "FC13-READY dbos iter=$ITER runId=$RUNID"
sleep 600