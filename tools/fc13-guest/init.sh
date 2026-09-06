#!/bin/sh
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors

bin/sh
# FC-13 guest init: mount the tested disk, run the writer, keep the VM alive.
# The harness passes the scenario via kernel cmdline: fc13_scenario=ctrl|native|dbos
/bin/busybox mkdir -p /proc /sys /dev /tmp /mnt/store /mnt/payload /etc
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
/bin/busybox mount -t devtmpfs devtmpfs /dev 2>/dev/null

# Parse scenario from cmdline
SCENARIO="ctrl"
# shellcheck disable=SC2013
for param in $(cat /proc/cmdline); do # word-splitting is the intent (cmdline params)
  case "$param" in
    fc13_scenario=*) SCENARIO="${param#fc13_scenario=}" ;;
  esac
done
echo "FC13 guest scenario=$SCENARIO"

# Extract payload
/bin/busybox tar -xzf /payload.tgz -C /mnt/payload 2>/dev/null || echo "PAYLOAD-EXTRACT-FAILED"

# Mount the tested virtual disk (virtio, ext4, NO special flush hints -
# the guest page cache is on; the power cut comes from the host).
/bin/busybox mkdir -p /mnt/store
mount /dev/vda /mnt/store 2>/dev/null || { mkfs.ext4 -F /dev/vda && mount /dev/vda /mnt/store; }
echo "FC13 store mounted"

export FC13_STORE_PATH=/mnt/store/store.db
export FC13_READY_URL=http://10.0.2.2:8099/ready
export FC13_ITERATION="${fc13_iteration:-0}"

case "$SCENARIO" in
  ctrl)   /mnt/payload/bun /mnt/payload/ctrl-writer.js & ;;
  native) /mnt/payload/bun /mnt/payload/native-writer.js & ;;
  dbos)   sh /mnt/payload/dbos-writer.sh & ;;
  *) echo "UNKNOWN-SCENARIO $SCENARIO" ;;
esac

# Keep PID 1 alive; the VM is hard-killed from the host.
while true; do sleep 3600; done
