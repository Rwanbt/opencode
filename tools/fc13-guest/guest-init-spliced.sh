#!/bin/busybox sh
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
# FC-13 spliced init: runs on top of the official Alpine initramfs rootfs.
# Kernel cmdline selects: fc13_mode=write|inspect  fc13_scenario=ctrl|native|dbos
#   fc13_iteration=N  fc13_runid=<id> (inspect mode for dbos only)
B=/bin/busybox
$B mount -t proc proc /proc 2>/dev/null || true
$B mount -t sysfs sysfs /sys 2>/dev/null || true
$B mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
$B mdev -s 2>/dev/null || true
for module in virtio virtio_ring virtio_pci virtio_blk ext4 jbd2 mbcache crc32c_generic fat vfat nls_cp437 nls_iso8859-1; do
  $B modprobe "$module" 2>/dev/null || true
done
$B sleep 1 2>/dev/null || true
FC13_MODE="write"
FC13_SCENARIO="ctrl"
FC13_ITERATION="0"
FC13_RUN_ID=""
for param in $($B cat /proc/cmdline); do
  case "$param" in
    fc13_mode=*) FC13_MODE="${param#fc13_mode=}" ;;
    fc13_scenario=*) FC13_SCENARIO="${param#fc13_scenario=}" ;;
    fc13_iteration=*) FC13_ITERATION="${param#fc13_iteration=}" ;;
    fc13_runid=*) FC13_RUN_ID="${param#fc13_runid=}" ;;
  esac
done
echo "FC13-GUEST mode=$FC13_MODE scenario=$FC13_SCENARIO iter=$FC13_ITERATION"
echo "FC13-BLKDEVS: $($B ls /dev/vd* /dev/sd* 2>/dev/null | $B tr "\n" " ")"
$B mkdir -p /mnt/store /mnt/payload
$B mount -t vfat /dev/vdb1 /mnt/payload 2>/dev/null || $B mount -t vfat /dev/vdb /mnt/payload 2>/dev/null || echo "FC13-PAYLOAD-MOUNT-FAILED"
if [ "$FC13_MODE" = "write" ]; then
  LD_LIBRARY_PATH=/mnt/payload/lib /mnt/payload/sbin/mke2fs -t ext4 -F /dev/vda >/dev/null 2>&1
fi
$B mount -t ext4 /dev/vda /mnt/store 2>/dev/null || echo "FC13-STORE-MOUNT-FAILED"
echo "FC13-STORE-LS: $($B ls /mnt/store 2>&1 | $B tr "\n" " ")"
export LD_LIBRARY_PATH="/mnt/payload/lib"
export FC13_ITERATION
export FC13_MODE
export FC13_RUN_ID
export FC13_STORE_PATH="/mnt/store"
if [ "$FC13_MODE" = "inspect" ]; then
  if [ "$FC13_SCENARIO" = "dbos" ]; then
    # shellcheck disable=SC2086
    sh /mnt/payload/dbos-writer.sh 2>&1 | $B grep -a FC13-RESULT
    # shellcheck disable=SC2086
    /mnt/payload/bun /mnt/payload/fc13-$FC13_SCENARIO.js 2>&1 | $B grep -a FC13-RESULT
  fi
  echo FC13-DONE
  $B poweroff -f 2>/dev/null || sleep 20
  exit 0
fi
if [ "$FC13_SCENARIO" = "dbos" ]; then
  # shellcheck disable=SC2086
  sh /mnt/payload/dbos-writer.sh &
  # shellcheck disable=SC2086
  /mnt/payload/bun /mnt/payload/fc13-$FC13_SCENARIO.js 2>&1 &
fi
while :; do $B sleep 3600 2>/dev/null || sleep 3600; done
