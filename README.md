<div align="center">

<img src="src-tauri/icons/icon.png" alt="Fluxa" width="96" />

# Fluxa Desktop

A fast, native media client for Windows, macOS, and Linux.<br/>
Browse catalogs, track what you watch, and play anything the Stremio addon ecosystem exposes.

[![Stars](https://img.shields.io/github/stars/KhooLy/fluxa-desktop?style=flat-square&color=fff&labelColor=111)](https://github.com/KhooLy/fluxa-desktop/stargazers)
[![Releases](https://img.shields.io/github/v/release/KhooLy/fluxa-desktop?style=flat-square&color=fff&labelColor=111)](https://github.com/KhooLy/fluxa-desktop/releases/latest)
[![License](https://img.shields.io/github/license/KhooLy/fluxa-desktop?style=flat-square&color=fff&labelColor=111)](LICENSE)

[Download](#download) · [Features](#features) · [Building from source](#building-from-source)

</div>

---

## What it does

Fluxa connects to any Stremio-compatible addon and turns it into a proper desktop app: a home feed with genre and category browsing, a calendar of upcoming episodes, a library with continue-watching and resume positions, and two-way watch tracking with Trakt, MyAnimeList, and Simkl. Playback runs through `libmpv` with platform-native rendering, including direct torrent/magnet support — no separate addon server, no browser round-trip for OAuth, no telemetry.

## Features

- **Catalogs & discovery** — home feed, genre/category grids, search across every installed addon, and a calendar of upcoming episodes for what you're following
- **Library** — watchlist, continue watching with resume position, and custom collections, with import support for existing lists
- **Watch tracking** — two-way sync with Trakt, MyAnimeList, and Simkl; OAuth is handled locally via deep link (`fluxa://oauth/...`), no hosted redirect server
- **Playback** — native `libmpv` rendering with a custom render surface per platform (X11 on Linux, native views on macOS/Windows), subtitle and audio track selection, intro/outro skip, and direct torrent/magnet playback
- **Profiles** — multiple local profiles on one install, each with its own library, addons, and sync accounts
- **Addons** — install and manage Stremio-compatible addons directly from the app
- **Auto-update** — in-app update checks and installation via Tauri's updater

## Download

Grab the latest build from [Releases](https://github.com/KhooLy/fluxa-desktop/releases/latest).

| Platform | Package |
| --- | --- |
| Windows 10+ | `.exe` — NSIS installer |
| macOS 11+ | `.dmg` — Universal (Intel + Apple Silicon) |
| Linux (Debian / Ubuntu) | `.deb` |
| Linux (Fedora / RHEL) | `.rpm` |
| Linux (portable) | `.AppImage` |

## Building from source

```bash
git clone https://github.com/KhooLy/fluxa-desktop.git
cd fluxa-desktop
npm install
npm run tauri dev
```

**Prerequisites**

- Node.js 22+
- Rust stable
- `libmpv` — either install it system-wide, or run `./src-tauri/fetch-libmpv.sh` to pull the prebuilt gpu-next fork used for release builds
  - Linux: `sudo apt install libmpv-dev` or `sudo pacman -S mpv`
  - macOS: `brew install mpv`
  - Windows: handled by the fetch script

```bash
npm run build   # production frontend build
npm run check   # typecheck + cargo check
```

## Stack

[Tauri 2](https://tauri.app/) · [React 18](https://react.dev/) · [TypeScript](https://www.typescriptlang.org/) · [Vite](https://vitejs.dev/) · [Rust](https://www.rust-lang.org/) · [mpv](https://mpv.io/) · [librqbit](https://github.com/ikatson/rqbit)

---

**Legal** — Fluxa Desktop is a client-side interface for user-installed Stremio addons. It does not host, serve, or distribute any media content. All streams come from third-party addons chosen by the user. Fluxa is not affiliated with any addon developer, repository, or content provider. Users are responsible for ensuring they have the right to access what they stream.

## Related projects

- [Fluxa for Android](https://github.com/KhooLy/Fluxa) — the Android counterpart to this app
- [fluxa-core](https://github.com/KhooLy/fluxa-core) — the shared Rust library powering both
