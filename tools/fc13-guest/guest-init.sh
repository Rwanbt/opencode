#!/bin/busybox sh
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
#
# FC-13 guest init (PID 1). Kernel cmdline selects the scenario:
#   fc13_mode=write|inspect  fc13_scenario=ctrl|native|dbos  fc13_iteration=N
#
# WRITE: mkfs.ext4 (fresh clean state, plan section 7) -> run the
# writer -> the writer emits FC13-READY on the console (plan section
# 9: serial/stdout channel) -> the host hard-kills the VM.
# INSPECT: mount read-only intent, emit FC13-RESULT, halt.

/bin/busybox --install -s /bin 2>/dev/null || true
mkdir -p /proc /sys /dev /tmp /mnt/store /run
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true

# shellcheck disable=SC2034
MODULES_DIR="/lib/modules/*"  # informational; modules loaded by explicit find below
# shellcheck disable=SC2013,SC2086
for mod in virtio virtio_ring virtio_pci virtio_blk ext4 crc32c_generic jbd2 mbcache; do
  found=$(find /lib/modules -name "$mod.ko*" 2>/dev/null | head -1)
  if [ -n "$found" ]; then insmod "$found" 2>/dev/null || true; fi
done

FC13_MODE="write"
FC13_SCENARIO="ctrl"
FC13_ITERATION="0"
# shellcheck disable=SC2013
for param in $(cat /proc/cmdline); do
  case "$param" in
    fc13_mode=*) FC13_MODE="${param#fc13_mode=}" ;;
    fc13_scenario=*) FC13_SCENARIO="${param#fc13_scenario=}" ;;
    fc13_iteration=*) FC13_ITERATION="${param#fc13_iteration=}" ;;
  esac
done
echo "FC13-GUEST mode=$FC13_MODE scenario=$FC13_SCENARIO iter=$FC13_ITERATION"

mkdir -p /mnt/store /mnt/payload
mount -t ext4 /dev/vdb /mnt/payload 2>/dev/null || { mke2fs -t ext4 -F /dev/vdb >/dev/null 2>&1 && mount -t ext4 /dev/vdb /mnt/payload; }
cp -r /payload/* /mnt/payload/ 2>/dev/null || true
umount /mnt/payload 2>/dev/null || true
mount -t ext4 /dev/vdb /mnt/payload 2>/dev/null || true
echo "FC13-PAYLOAD-READY rc=$?"
if [ "$FC13_MODE" = "write" ]; then
  mke2fs -t ext4 -F /dev/vda >/dev/null 2>&1
fi
mount -t ext4 /dev/vda /mnt/store 2>/dev/null
echo "FC13-STORE-MOUNTED rc=$?"

if [ "$FC13_MODE" = "inspect" ]; then
  # shellcheck disable=SC2086
  /payload/bun /payload/fc13-$FC13_SCENARIO.js 2>&1 | grep -a FC13-RESULT
  echo "FC13-DONE"
  poweroff -f 2>/dev/null || sleep 20
  exit 0
fi

export FC13_STORE_PATH="/mnt/store/store.db"
export FC13_ITERATION
# Payload is loaded from the tested virtual disk (the initramfs stays small).
while true; do sleep 3600; done
