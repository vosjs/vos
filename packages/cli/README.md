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
vos render <config.json|url> [out]   # config → video (WebM/MP4)
vos still  <config.json|url> [out]   # config → single frame (WebP)
vos info   <config.json|url>         # inspect a config
vos preview <config.json|url>        # serve a local playback page
vos versions                         # installed @vosjs/* versions
```

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
