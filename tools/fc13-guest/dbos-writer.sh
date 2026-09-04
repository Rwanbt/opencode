#!/bin/sh
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors

bin/sh
STORE=/mnt/store
ITER="${FC13_ITERATION:-0}"
READY_URL="${FC13_READY_URL:-http://10.0.2.2:8099/ready}"
PAYLOAD=/mnt/payload
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
if [ -z "$BASE" ]; then
  echo "DBOS-DID-NOT-BIND"
  kill $DBOS_PID 2>/dev/null
  exit 1
fi
BODY='{"workflowVersionId":"wf-fc13","organizationId":"o1","workspaceId":"ws-fc13","logicalInvocationId":"li-fc13-'"$ITER"'","effectKey":"ek-fc13-'"$ITER"'","canonicalInputJson":"","seedCanonicalJson":""}'
RUNS=$(wget -q -O- --post-data="$BODY" --header="Content-Type: application/json" "http://$BASE/runs" 2>/dev/null)
echo "DBOS-RUN $RUNS"
RUNID=$(echo "$RUNS" | grep -o "run-[a-z0-9-]*" | head -1)
if [ -z "$RUNID" ]; then
  echo "DBOS-START-FAILED"
  kill $DBOS_PID 2>/dev/null
  exit 1
fi
wget -q -O /dev/null "$READY_URL?iter=$ITER&who=dbos&run=$RUNID" 2>/dev/null
sleep 600
