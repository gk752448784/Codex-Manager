## Frontend Desktop App

This directory contains the Next.js frontend used by the Tauri desktop shell.

## Development

Install dependencies and start the desktop frontend dev server:

```bash
pnpm install
pnpm run dev:desktop
```

Tauri dev mode:

```bash
pnpm run tauri:dev
```

## Static Export Validation

The desktop build depends on the exported static site in `apps/out`:

```bash
pnpm run build:desktop
```

## Linux Mint Packaging

Linux Mint is supported through Tauri's Linux bundle targets. Before packaging on Mint 21.x / Ubuntu 22.04 based systems, install the required native dependencies:

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libsoup-3.0-dev \
  patchelf \
  zip
```

Build both Linux desktop packages:

```bash
pnpm run tauri:build:linux
```

Build only one format:

```bash
pnpm run tauri:build:linux:appimage
pnpm run tauri:build:linux:deb
```

Output paths:

- `apps/src-tauri/target/release/bundle/appimage/*.AppImage`
- `apps/src-tauri/target/release/bundle/deb/*.deb`

For scripted local packaging, `scripts/rebuild-linux.sh --bundles "appimage,deb" --clean-dist` remains available at the repository root.
