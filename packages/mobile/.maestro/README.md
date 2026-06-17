# Maestro E2E flows (Android)

Device/emulator end-to-end flows for OpenCode mobile (`appId: ai.opencode.mobile`).
These complement the host suite (`cargo test`, `bun test`) and the manual
[device smoke test](../../../docs/DEVICE-SMOKE-TEST.md) by automating the
device-only paths that no host/CI can reach (seccomp, SELinux, `nativeLibraryDir`,
the JNI server).

## Run

```bash
# install Maestro: curl -Ls "https://get.maestro.mobile.dev" | bash
adb devices                      # a real device or arm64-capable host
maestro test packages/mobile/.maestro/
```

ARM64 emulators do **not** run on x86 CI (no QEMU arm translation), so these are
for a connected device, a self-hosted device runner, or Firebase Test Lab.

## Prerequisite for deeper flows: stable selectors

The SolidJS WebView currently exposes **no `data-testid`** (0 across
`packages/app/src`). Maestro matches by visible text or accessibility id, so
robust assertions need stable hooks first. To enable the planned flows, add
`data-testid` to the key surfaces (Maestro reads them via the WebView
accessibility tree):

- composer/prompt input, send button
- session/chat container, a streamed assistant message
- terminal tab + its input/output region
- model selector, settings entry

Then replace the commented placeholders below with `assertVisible`/`tapOn` on
those ids.

## Flows

| File | Status | Validates (smoke-test §) |
|------|--------|--------------------------|
| `cold-start.yaml` | ✅ runnable (launch/crash smoke) | server spawn on launch (§1) |
| `server-health.yaml` | ⏳ needs testIDs | session loads + local reply (§1) |
| `terminal-shell.yaml` | ⏳ needs testIDs | shell/exec chain `uname`/`git`/`cargo` (§2, D-16) |
| `applet-seccomp.yaml` | ⏳ needs testIDs | `vi`/`top`/`less` no SIGSYS (§3, D-19) |

`cold-start.yaml` is the one flow that works without selectors (a failed
`launchApp` fails the run). The rest are listed as the target set once testIDs
land — authoring them blind (guessing visible text) would produce fragile flows.
