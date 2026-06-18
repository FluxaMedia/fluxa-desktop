# Development

## Sibling repos

This repo expects two sibling checkouts next to it:

```
projects-i-made/
  fluxa-desktop/   (this repo)
  fluxa-core/      https://github.com/KhooLy/fluxa-core
  mpv-fork/        https://github.com/KhooLy/mpv (branch: gpu-next-render-backend)
```

`fluxa-core` is a path dependency in `src-tauri/Cargo.toml` — business logic lives there, not here.

## libmpv

We don't link against system libmpv. We use a custom fork (`KhooLy/mpv`, `gpu-next-render-backend` branch) with the gpu-next/libplacebo render backend.

`src-tauri/fetch-libmpv.sh` downloads the fork's **latest** release into `src-tauri/lib/`. CI always fetches latest too — there's no tag to keep in sync. Pushing a fix to the fork still needs a tagged release there (`fetch-libmpv.sh` only sees tagged releases, not branch pushes), but nothing in this repo needs touching afterward.

### Local Linux dev

The fork's Linux CI build is built on Ubuntu and bundles libplacebo + ffmpeg's own libraries so it doesn't depend on your system's versions. If `fetch-libmpv.sh` still fails to load (e.g. a very different distro), build the fork locally instead:

```bash
cd ../mpv-fork
meson setup build -Dlibmpv=true -Dgpl=false
ninja -C build
cp -L build/libmpv.so.2.5.0 ../fluxa-desktop/src-tauri/lib/
cd ../fluxa-desktop/src-tauri/lib
rm -f libmpv.so libmpv.so.2
ln -sf libmpv.so.2.5.0 libmpv.so.2
ln -sf libmpv.so.2 libmpv.so
```

This links against whatever ffmpeg/libplacebo your system already has, so it only works for local testing — release builds still go through the fork's CI.

## Releasing

Version lives in `package.json` and `src-tauri/Cargo.toml` (`tauri.conf.json` has no version field — it inherits from `Cargo.toml`).

```bash
npm run bump <new-version>
git add -A && git commit -m "chore: bump version to <new-version>"
git tag v<new-version> && git push origin master v<new-version>
```

Pushing the tag triggers `build.yml`: builds Windows/macOS/Linux, drafts the release, and only publishes it once all three succeed.
