<div align="center">

<img src="src-tauri/icons/icon.png" alt="Fluxa" width="96" />

# Fluxa Desktop

A native desktop media client built on a platform-agnostic Rust core.<br/>
Connects to the Stremio addon ecosystem. Runs on Windows, macOS, and Linux.

[![Stars](https://img.shields.io/github/stars/KhooLy/fluxa-desktop?style=flat-square&color=fff&labelColor=111)](https://github.com/KhooLy/fluxa-desktop/stargazers)
[![Releases](https://img.shields.io/github/v/release/KhooLy/fluxa-desktop?style=flat-square&color=fff&labelColor=111)](https://github.com/KhooLy/fluxa-desktop/releases/latest)

</div>

---

Fluxa Desktop is the desktop counterpart to [Fluxa for Android](https://github.com/KhooLy/Fluxa). It browses catalogs, tracks watch history across Trakt / MAL / Simkl, and plays anything the Stremio addon ecosystem exposes — including torrents.

The shell is Tauri 2 + React. All decisions — addon resolution, stream planning, library state, playback policy — live in **[fluxa-core](https://github.com/KhooLy/fluxa-core)**, a headless Rust library that compiles identically for Android and desktop. The platform layer fulfills effects; Rust never calls the network directly.

## Features

- **Catalogs & discovery** — browse, search, and filter across every installed Stremio addon, with a home feed, genre/category grids, and a calendar of upcoming episodes for what you're watching
- **Library** — watchlist, continue watching with resume position, and custom collections, with import support for existing lists
- **Watch tracking** — two-way sync with Trakt, MyAnimeList, and Simkl, with OAuth handled locally via a deep-link redirect (`fluxa://oauth/...`) — no browser round-trip through a hosted server
- **Playback** — native `libmpv` rendering with a custom OS-level surface per platform (Linux/X11, macOS, Windows), subtitle track selection, and direct torrent/magnet playback
- **Profiles** — multiple local profiles on one install, each with its own library, addons, and sync accounts
- **Addons** — install and manage Stremio-compatible addons directly, no separate addon server required
- **Auto-update** — in-app update checks and installation via Tauri's updater plugin

## Download

Get the latest build from [Releases](https://github.com/KhooLy/fluxa-desktop/releases/latest).

| Platform | Package |
| --- | --- |
| Windows 10+ | `.exe` — NSIS installer |
| macOS 11+ | `.dmg` — Universal (Intel + Apple Silicon) |
| Linux (Debian / Ubuntu) | `.deb` |
| Linux (Fedora / RHEL) | `.rpm` |
| Linux (portable) | `.AppImage` |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│          Desktop Shell  ·  Tauri 2 + React + TypeScript       │
│    UI   IPC   Native Window   mpv Playback   File System      │
├─────────────────────────────┬────────────────────────────────┤
│         fluxa-core          │     fluxa-streaming-engine      │
│  State, policy, addon       │  Video proxy, Dolby Vision      │
│  protocol, catalog, library │  rewrite, torrent engine        │
└─────────────────────────────┴────────────────────────────────┘
```

### Effect loop

Rust emits typed effects; the platform fulfills them. This keeps `fluxa-core` portable — no platform-specific code inside Rust.

```
Frontend  →  invoke('engine_dispatch', action)
          ←  { state, effects: [{ id, type, payload }] }
Frontend  →  runs each effect (HTTP / storage / auth / ...)
          →  invoke('engine_complete', { effectId, result })
          ←  { state, effects: [...] }
```

## Development

```bash
git clone https://github.com/KhooLy/fluxa-desktop.git
cd fluxa-desktop
npm install
npm run tauri dev
```

**Prerequisites**

- Node.js 22+
- Rust stable
- `fluxa-core` cloned at `../fluxa-core`
- `libmpv` on your system
  - Linux: `sudo apt install libmpv-dev` or `sudo pacman -S mpv`
  - macOS: `brew install mpv`
  - Windows: bundled automatically by CI

## Stack

[Tauri 2](https://tauri.app/) · [React 18](https://react.dev/) · [TypeScript](https://www.typescriptlang.org/) · [Vite](https://vitejs.dev/) · [Rust](https://www.rust-lang.org/) · [mpv](https://mpv.io/) · [librqbit](https://github.com/ikatson/rqbit) · [UniFFI](https://mozilla.github.io/uniffi-rs/)

---

**Legal** — Fluxa Desktop is a client-side interface for user-installed Stremio addons. It does not host, serve, or distribute any media content. All streams come from third-party addons chosen by the user. Fluxa is not affiliated with any addon developer, repository, or content provider. Users are responsible for ensuring they have the right to access what they stream.
