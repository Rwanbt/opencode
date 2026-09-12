# Work/Design blockers and unlock path

This register separates missing implementation from evidence that requires a real desktop, device, or human decision. It is intentionally fail-closed: a static model or green unit suite does not close a runtime gate.

| Gate | Root cause verified in code | Minimal unlock | Owner/status |
|---|---|---|---|
| M1c / MV-01 | The versioned handshake, issuer boundary, server-side native-token consumption, shell `NativeTokenBridge`, opaque metadata handoff, `connectWorkbench` controller, app injection point, private sidecar RPC, desktop Tauri commands, desktop adapter, Android Keystore RPC and mobile adapter now exist. | Run the real desktop and Android apps and prove scope, expiry, rotation and close-time revocation without exposing signing material or the IPC token to the WebView. | Desktop/mobile implementation complete; MV-01 runtime proof open |
| MV-02 | Native issue/rotate/revoke now traverses the desktop Tauri command, private sidecar RPC, Workbench issuer and shell rotation hook; the real SSE rotation trace is not recorded. | Maintain an SSE stream in the desktop app, trigger rotation, verify grace-period acceptance and post-grace rejection. | Desktop implementation complete; runtime trace open |
| MV-03 | Android runtime health is proven on `b7163823`, but the full current Work → Design and lifecycle flow was not exercised; MIUI rejected `adb shell input`. | Build/sign/install the current APK, use an authorized interactive device path such as scrcpy UHID or human taps, capture one runtime PID before/after backgrounding and both mode screens. | Device interaction; blocked by input policy |
| MV-04 | Renderer and CSP are static-safe, but packaged Android WebView behavior and external-request absence are unproven. | Load a hostile SVG through the real `<img src="data:…">` path, inspect WebView/network logs, and archive a redacted capture. | Device/WebView interaction; open |
| MV-05 | `projectReadOnly()` is proven headless and the desktop Workbench client can now connect, but no live approval interaction has been recorded. | Attempt a write, verify default refusal, approve the exact request, then inspect the redacted audit event. | Desktop runtime proof open |
| MV-06 | Mode routes and persistence are implemented; no complete UI/deep-link/reopen matrix has been recorded. | Run desktop E2E/manual matrix across two directories and four modes, including reload and deep links. | Desktop interaction; open |
| MV-07 | Server shutdown closes file sessions and restart now exposes a fresh process `instanceId`, but cross-process workspace generations are not yet exercised through the actual desktop service. | Stop/restart the actual local service and compare workspace generations, then verify no old scoped token survives the new instance. | Automated identity check complete; desktop process proof open |
| MV-08 | Occupied-port behavior, concurrent automatic-port listeners, and independently spawned worker identities are now tested; the actual desktop service ownership lifecycle is not. | Run the real desktop service twice with configured/automatic ports and capture the owner/lock identity plus rejection of the stale generation. | Cross-process worker proof complete; desktop lifecycle proof open |
| MV-09 | Source/config CSP parsing now asserts loopback, data-image, object and frame directives; packaged-bundle extraction and allow/deny URL checks are still missing. | Extract CSP from desktop and Android bundles, assert exact directives, then test allowed loopback/IPC and forbidden external/frame/object cases. | Static config complete; package/runtime check open |
| MV-10 | This is an intentional human publication gate. | Human reviews diff, license/SPDX, rollback and confirms no merge/publication; no automation can sign this gate. | Human decision; open |

## Current safe order

1. Run MV-01/MV-02 against the desktop adapter and archive the redacted traces.
2. Complete the remaining package/device/manual gates.
3. Add the instance/single-writer proof required by the selected topology.
4. Build the current Android candidate and perform the authorized device checks.
5. Run the desktop E2E/deep-link/CSP matrix.
6. Perform MV-10 only after the preceding evidence is archived.

No gate in this register is marked complete by compilation alone.
