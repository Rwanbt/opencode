# OpenCode Mobile

Native mobile app for Android and iOS, powered by Tauri 2.0. Connects to a desktop OpenCode server for full agent capabilities.

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- [Rust](https://rustup.rs) (latest stable)
- [Tauri CLI](https://tauri.app/start/): `cargo install tauri-cli`

### Android
- Android SDK (API 24+)
- Android NDK
- `ANDROID_HOME` and `JAVA_HOME` environment variables set

### iOS
- macOS with Xcode 15+
- Apple Developer account
- CocoaPods: `sudo gem install cocoapods`

## Development

```bash
# From monorepo root:
bun run dev:mobile-android    # Android dev mode
bun run dev:mobile-ios        # iOS dev mode

# Or from this directory:
bun run dev                   # Vite dev server only (no native shell)
bun run tauri android dev     # Full Android dev
bun run tauri ios dev         # Full iOS dev
```

## Build

```bash
./scripts/build-android.sh    # Release APK
./scripts/build-ios.sh        # Release IPA
```

## Remote Connection

The mobile app operates as a **remote client** — it connects to a desktop OpenCode instance over the network.

### Setup
1. Start OpenCode server on your desktop: `opencode serve --hostname 0.0.0.0`
2. Note the server URL (e.g., `http://192.168.1.100:4096`)
3. Set `OPENCODE_SERVER_PASSWORD` for security
4. Open the mobile app → Connect → Enter server URL and password

### Secure Access
For access outside your LAN, use a secure tunnel:
- [Tailscale](https://tailscale.com) (recommended)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

## Architecture

```
packages/mobile/
├── src/
│   ├── entry.tsx          # App entry point
│   ├── platform.ts        # Mobile Platform implementation
│   └── notifications.ts   # SSE → push notification bridge
├── src-tauri/
│   ├── tauri.conf.json    # Tauri mobile config
│   ├── Cargo.toml         # Rust dependencies
│   └── src/lib.rs         # Tauri mobile entry
├── scripts/
│   ├── build-android.sh
│   └── build-ios.sh
└── index.html             # HTML shell with safe area insets
```

The mobile app reuses the shared `@opencode-ai/app` package for UI components, with mobile-specific additions:
- `packages/app/src/components/mobile/` — Nav drawer, message input
- `packages/app/src/components/diff/mobile-diff.tsx` — Touch-friendly diff viewer
- `packages/app/src/components/connect/remote-connect.tsx` — Server connection UI
- `packages/app/src/hooks/use-mobile-layout.ts` — Responsive layout detection
