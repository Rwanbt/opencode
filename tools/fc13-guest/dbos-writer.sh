#!/bin/sh
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
# FC-13 DBOS writer + post-cut inspector. Runs the REAL DBOS Go binary
# with its system DB on the tested disk. WRITE mode posts /runs (the
# StartRunWorkflow durable step commit is the acknowledged transition)
# and signals READY on stdout. INSPECT mode reads back the run state.
PAYLOAD=/mnt/payload
STORE=/mnt/store
ITER="${FC13_ITERATION:-0}"
RUNID_IN="${FC13_RUN_ID:-}"

if [ "$FC13_MODE" = "inspect" ]; then
  export M0_STORE_DIR="$STORE/dbos"
  export M0_APP_NAME="unifia-fc13"
  "$PAYLOAD/fc13-dbos" > /tmp/dbos-inspect.log 2>&1 &
  DBOS_PID=$!
  BASE=""
  i=0
  while [ $i -lt 150 ]; do
    BASE=$(grep -o "127.0.0.1:[0-9]*" /tmp/dbos-inspect.log | head -1)
    [ -n "$BASE" ] && break
    sleep 0.2
    i=$((i + 1))
  done
  if [ -z "$BASE" ]; then echo "FC13-RESULT dbos iter=$ITER NO-BINARY"; exit 0; fi
  STATE=$(wget -q -O- "http://$BASE/runs/$RUNID_IN" 2>/dev/null)
  kill $DBOS_PID 2>/dev/null
  case "$STATE" in
    *COMPLETED*|*SUCCEEDED*) echo "FC13-RESULT dbos iter=$ITER PRESENT";;
    "") echo "FC13-RESULT dbos iter=$ITER ABSENT";;
    *) echo "FC13-RESULT dbos iter=$ITER OBSERVED";;
  esac
  exit 0
fi

export M0_STORE_DIR="$STORE/dbos"
export M0_APP_NAME="unifia-fc13"
mkdir -p "$STORE/dbos"
"$PAYLOAD/fc13-dbos" > /tmp/dbos.log 2>&1 &
DBOS_PID=$!
BASE=""
i=0
while [ $i -lt 150 ]; do
  BASE=$(grep -o "127.0.0.1:[0-9]*" /tmp/dbos.log | head -1)
  [ -n "$BASE" ] && break
  sleep 0.2
  i=$((i + 1))
done
if [ -z "$BASE" ]; then echo "DBOS-DID-NOT-BIND"; kill $DBOS_PID 2>/dev/null; exit 1; fi
BODY="{\"workflowVersionId\":\"wf-fc13\",\"organizationId\":\"o1\",\"workspaceId\":\"ws-fc13\",\"logicalInvocationId\":\"li-fc13-$ITER\",\"effectKey\":\"ek-fc13-$ITER\",\"canonicalInputJson\":\"\",\"seedCanonicalJson\":\"\"}"
RUNS=$(wget -q -O- --post-data="$BODY" --header="Content-Type: application/json" "http://$BASE/runs" 2>/dev/null)
RUNID=$(echo "$RUNS" | grep -o "run-[a-z0-9-]*" | head -1)
if [ -z "$RUNID" ]; then echo "DBOS-START-FAILED"; kill $DBOS_PID 2>/dev/null; exit 1; fi
echo "FC13-READY dbos iter=$ITER runId=$RUNID"
sleep 600
