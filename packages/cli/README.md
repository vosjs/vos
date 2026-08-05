# @vosjs/cli

[![npm](https://img.shields.io/npm/v/@vosjs/cli)](https://www.npmjs.com/package/@vosjs/cli)
[![license](https://img.shields.io/npm/l/@vosjs/cli)](../../LICENSE)

Command line for [vos](https://vos.so/engine), the open visual operating system — render deterministic videos and stills from vos configs, headlessly, from your terminal, CI, or an AI agent.

```bash
pnpm add -D @vosjs/cli
npx vos render animation.json out.webm
```

## Commands

```bash
vos render <config.json|url|take> [out]  # config → video; a take directory renders via the take pipeline
vos still  <config.json|url> [out]   # config → single frame (WebP)
vos info   <config.json|url>         # inspect a config
vos preview <config.json|url>        # serve a local playback page
vos versions                         # installed @vosjs/* versions

# Take pipeline — screen recordings in, product video out (npm i -D @vosso/cli)
vos create   --actions actions.json [out.webm] [--strict]   # record + plan + render, one shot
vos record   --actions actions.json [--out take] [--strict]
vos plan     <take> [--fresh]
vos frames   <take> [--at-zooms | --frame <t> --size WxH]
vos open     <take>
vos validate <actions.json|take>

# Platform (vos.so) — fetch a program, validate locally, push a private remix
vos fetch <vosId|watch-url> [--out dir]   # writes config.json + meta.json (no auth for public programs)
vos check <config.json>                   # migrate → schema → syntax → compile → determinism/dialect lints, all local
vos push  <config.json|take> [--vos id] [--title t] [--slug s] [--remix-of id] [--note n] [--label l] [--base versionId] [--overrides id,id]
vos pull  [dir|take] [--vos id] [--since versionId] [--check]   # what changed on vos.so since your base; syncs config + base
```

The take verbs delegate to the separately installed [`@vosso/cli`](https://www.npmjs.com/package/@vosso/cli) (its `run(argv)` export is the contract; `@vosso/voila-cli` remains an install fallback, and `vos voila <verb>` keeps working as a hidden alias for existing scripts). `vos render` is polymorphic by a deterministic sniff, never a flag: a take directory is recognized by its `doc.json`; anything else renders as an engine config.

The platform verbs implement the iteration loop of the remix contract at [vos.so/llms-remix.txt](https://vos.so/llms-remix.txt): `fetch` a public program's config (params and presets preserved), edit it, `check` it locally (the same compiler the platform runs), and `push` it back as a **private** vos with lineage — or iterate an existing one with `--vos`. Auth resolves from `VOS_API_KEY`, then the first line of `~/.config/vos/credentials` (mint a key at [vos.so/app/api](https://vos.so/app/api); an ephemeral `vos_rg_` remix grant works too). Keys can never publish — the pushed vos stays private until a human publishes it on vos.so. A directory that has fetched or pushed TRACKS its vos through `meta.json`, so `--base` defaults to the version you actually edited from: a push against a moved head is rejected with the attributed, typed changelog of what changed there, and `vos pull` brings those changes down — versions with origin, label, note and a semantic summary, plus the `protected` set of human-edited nodes (keep their values unless the user asked; `--overrides` is the explicit consent). The previous local copy survives as `config.backup.json`. Take directories (recognized by `doc.json`) push and pull through the take pipeline in `@vosso/cli` automatically. `VOS_ORIGIN` overrides the platform origin for self-hosted or local development.

`vos render` accepts `--width` / `--height` / `--fps` / `--duration` / `--format webm|mp4`; `vos still` accepts `--time` / `--width` / `--height`. Configs can be local files or URLs, and API `{ "config": … }` envelopes are unwrapped automatically. Old config versions are migrated before rendering.

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
