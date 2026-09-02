# @vosjs/cli

[![npm](https://img.shields.io/npm/v/@vosjs/cli)](https://www.npmjs.com/package/@vosjs/cli)
[![license](https://img.shields.io/npm/l/@vosjs/cli)](../../LICENSE)

The `vos` binary: render deterministic videos and stills from [vos](https://vos.so/engine) configs headlessly, from your terminal, CI, or an AI agent, and hand every take and platform verb (record the real product, cut it as data, deliver the release's media, sync with vos.so) to the plugin below.

```bash
pnpm add -D @vosjs/cli
npx vos render animation.json out.webm
```

## Commands

```bash
vos render <config.json|url|take> [out]  # config → video; a take directory renders via the plugin
vos still  <config.json|url> [out]   # config → single frame (WebP)
vos info   <config.json|url>         # inspect a config
vos check  <config.json|url>         # migrate → schema → syntax → compile → determinism/dialect lints, all local
vos preview <config.json|url>        # serve a local playback page
vos versions                         # installed @vosjs/* (and plugin) versions
```

That is the whole engine surface: local, deterministic, no account, no auth — this package knows nothing about any hosting platform. Everything else — the take pipeline (screen recordings in, the release's media out: `create` / `record` / `plan` / `digest` / `frames` / `deliver` / `open` / `validate`) and the vos.so platform verbs (`fetch` / `push` / `pull` / `login` / `duplicate` / `folder` / `asset` / `recipe`) — ships as a separately installed plugin:

```bash
npm i -D @vosso/vos-plugin
```

Any verb this CLI does not own is forwarded to the plugin (its `run(argv)` export is the contract; the earlier package names `@vosso/cli` and `@vosso/voila-cli` still resolve as fallbacks, and `vos voila <verb>` keeps working as a hidden alias for existing scripts). Installed plugin verbs appear in `vos help` via the plugin's manifest, and run as plain `vos <verb>` — one binary either way. `vos render` is polymorphic by a deterministic sniff, never a flag: a take directory is recognized by its `doc.json`; anything else renders as an engine config. The plugin's verbs and the vos.so contracts are documented at [vos.so/llms.txt](https://vos.so/llms.txt).

`vos render` accepts `--width` / `--height` / `--fps` / `--duration` / `--format webm|mp4`; `vos still` accepts `--time` / `--width` / `--height`. Configs can be local files or URLs, and API `{ "config": … }` envelopes are unwrapped automatically. Old config versions are migrated before rendering. `vos check` runs the full local validation pipeline — the same compiler a hosted push runs server-side, so a clean check is a config that will compile anywhere.

Rendering runs the same deterministic pipeline everywhere: the config is compiled with `@vosjs/core`, wrapped in the engine's capture template, and encoded frame-by-frame (WebCodecs) in headless Chromium. Same input, same video — locally, in CI, or on a server.

## Requirements

A Chromium-family browser. The CLI uses your installed Google Chrome automatically; otherwise run `npx playwright install chromium` once, or point `VOS_BROWSER_PATH` at a Chrome/Chromium executable. Module dependencies (three, gsap) load from the CDN inside the render page, so rendering needs network access.

## For scripts and agents

- Results on stdout, logs on stderr.
- `--json` switches stdout to NDJSON events, ending with `{"event":"done",…}`:

```bash
vos render animation.json --json
{"event":"phase","phase":"compile"}
{"event":"phase","phase":"render"}
{"event":"done","out":"animation.webm","bytes":812345,"width":1920,"height":1080,"fps":30,"duration":5,"format":"webm"}
```

- Exit codes: `0` ok · `1` error · `2` usage · `3` no browser available.
- No auth, no account — rendering is local.

The same core is available programmatically:

```ts
import { launchBrowser, loadVosConfig, renderVideo } from '@vosjs/cli'

const browser = await launchBrowser()
const { config } = await loadVosConfig('animation.json')
const { bytes } = await renderVideo(browser, {
  config,
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 5,
  format: 'webm',
})
```

Part of [vos](https://github.com/vosjs/vos), the open visual operating system. MIT.
