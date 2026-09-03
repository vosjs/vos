# @vosjs/core

> The vos engine: a Zod schema for the config, the compiler that turns it into a program, the render template and its bridge protocol, the addon registry, an offline audio renderer and the determinism linters.

[![npm](https://img.shields.io/npm/v/@vosjs/core.svg)](https://www.npmjs.com/package/@vosjs/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open programmatic video engine behind [vos.so](https://vos.so).

**A video is inputs and a function, rendered.** A vos config is JSON: a camera, a scene, function strings that build a Three.js scene and a GSAP-dialect timeline, optional overlay elements, post-processing and data. `compileVosConfig` turns it into a program whose every frame is a pure function of time, and `generateRenderTemplate` wraps that program into one page that plays it, captures it to video, or captures one still. The package is pure: no DOM, no browser globals, so it runs in the browser, in Node and in a Worker.

## Install

```bash
pnpm add @vosjs/core three gsap
```

`three` and `gsap` are optional peer dependencies. You bring your own versions; the engine never bundles them, and a compiled program loads them from an import map at run time.

## Quick start

```ts
import { compileVosConfig, vosConfigJsonSchema } from '@vosjs/core'
import { generateRenderTemplate } from '@vosjs/core/runtime'

const config = {
  version: 2,
  duration: 3,
  camera: { preset: 'perspective' },
  createContent:
    '(ctx) => { const { THREE, scene } = ctx; const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(m); return { objects: [m], m } }',
  createTimeline:
    '(ctx, content, duration) => ctx.gsap.timeline().to(content.m.rotation, { y: Math.PI, duration })',
}

vosConfigJsonSchema.parse(config) // throws on an invalid config
const program = compileVosConfig(config) // an ES module string: export const initVos = async (container, deps) => …
const html = generateRenderTemplate(program, { mode: 'playback' })
```

`version`, `duration`, `camera`, `createContent` and `createTimeline` are the required fields. Functions are authored as strings and compiled into code, so they are plain JavaScript: no TypeScript syntax inside them.

The template has three modes, and one template serves all three, so what you preview is what you export:

| `mode`              | What the page does                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `playback`          | Plays the program and speaks the bridge protocol over `postMessage` (play, pause, seek, edit) |
| `capture-video`     | Renders frame by frame at a fixed fps and encodes with WebCodecs (`capture` option)           |
| `capture-thumbnail` | Renders one frame at `capture.thumbnailTime` and hands back a WebP                            |

Other `generateRenderTemplate` options: `elementsBundleCode` (the `@vosjs/elements` bundle, needed for `elements`), `editor` (enables hit-testing and drag-preview messages), `capture` (`width`, `height`, `duration`, `fps`, `format: 'webm' | 'mp4'`, `range`, `encoder`, `uploadUrl`, `data`), `threeVersion`, `gsapVersion`, `preloadModuleUrls`, `additionalImportmapEntries`, `tweenEngine`, `tweenBundleCode`. `transformModuleCode(code, 'server' | 'client')` rewrites a compiled module for a server render (import-map globals) or a client export (dependencies injected on `globalThis`).

## The config

| Field               | Purpose                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | The config era. Current is 2, and it is the floor: a version the engine cannot resolve is refused, never guessed.                                           |
| `duration`          | Seconds. The timeline's length and the transport's clock.                                                                                                   |
| `camera`            | `{ preset: 'perspective' \| 'orthographic' \| 'fullscreen', fov?, near?, far?, position?, lookAt? }`                                                        |
| `scene`             | `{ background?, fog? }`                                                                                                                                     |
| `setup`             | `async (ctx) => setupData`. Loaders and utils (`ctx.loaders`, `ctx.utils`) are available here; addon detection reads which ones you name.                   |
| `createContent`     | `(ctx, setupData) => { objects, onData?, assetsReady? }`. Builds the scene on `ctx.scene` (3D) and `ctx.overlayScene` (2D).                                 |
| `createTimeline`    | `(ctx, content, duration) => timeline`, in the GSAP dialect on `ctx.gsap`.                                                                                  |
| `onFrame`           | `(ctx, content, deltaTime)`. Runs every frame; the place to read `ctx.data` for live knobs.                                                                 |
| `data`              | Arbitrary JSON the program reads as `ctx.data`. Replaced live with `SET_DATA`; see below.                                                                   |
| `elements`          | 2D overlay elements (text, image, svg, video, audio) rendered by `@vosjs/elements`. Text `content`, `font.family` and `font.color` accept `{ $data: key }`. |
| `objects`           | Declared 3D objects: primitives, GLB models and 3D text.                                                                                                    |
| `fonts`             | `[{ family, url, weight?, style? }]`. Registered and awaited before the first frame (capped at 4 s, fail-open).                                             |
| `postprocessing`    | `bloom`, `glitch`, `filmGrain`, `dotScreen`, `output`; `perLayerEffects` and `dynamicLayers` for layered passes.                                            |
| `retime`            | `(t, data) => programTime`. Remaps output time to program time; see below.                                                                                  |
| `stack`             | More programs on the same context; see below.                                                                                                               |
| `params`, `presets` | The remix-knob contract over `data`, read by `@vosjs/shared/params`.                                                                                        |

The Zod schema and the migration ladder live in `@vosjs/core/schema` (`vosConfigJsonSchema`, `migrateConfig`, `CURRENT_CONFIG_VERSION`). `compileVosConfig` migrates before it validates, so a config without `version` compiles as the current era; a config you store should always carry one.

## Live edits: `SET_DATA` and the three rungs

A program compiled once can take new `data` without reloading. The bridge command `SET_DATA { data }` replaces `ctx.data`, and the engine applies it by the first rung that fits:

1. `content.onData(data)`, if `createContent` returned one.
2. Otherwise an `onFrame` program reads the swapped `ctx.data` on the next frame.
3. Otherwise the content is rebuilt in place: dispose, run `createContent` again, restore the transport. No module re-import, no blank frame.

So knobs work on every program, and `onFrame` is the cheap path. Bind text to data with `{ $data: key }` and a `SET_DATA` re-rasters only the affected elements.

## Retime

`retime` evaluates the program at `f(t)`: a pure function of the output time and `ctx.data`, returning the program time to render.

```ts
const config = {
  // …
  data: { rate: 0.5 },
  retime: '(t, data) => t * data.rate', // half speed; SET_DATA { rate: 2 } doubles it live
}
```

Each frame the runtime seeks the program's own timeline at `retime(outputTime, data)` and sets `ctx.time` to it, while the transport (play, pause, seek, `SET_DURATION`, capture) counts output time on a clock of `duration` seconds; `ctx.outputTime` carries that number and `READY.retime` tells a host the transport is the clock. Slow motion, speed ramps, reverse (`(t, d) => d.duration - t`), a freeze frame, a ping-pong loop, none of them need the timeline re-authored, and every capture path stays exact because a frame is still a pure function of `(data, output time)`. The result is clamped to `[0, duration]` of the program timeline; a non-finite result falls back to `t` and warns once. Stack entries are output-anchored: their `ctx.time` is the output time, so a retime never moves a HUD.

## The program stack

A config runs one program: `setup → createContent → createTimeline → onFrame`. `stack` runs more of them on the same context, after the main one, in array order: a HUD, a subtitle pass, a watermark, an overlay a remixer adds without touching the main program's code.

```ts
const config = {
  version: 2,
  duration: 3,
  camera: { preset: 'perspective' },
  createContent: '(ctx) => { /* the scene */ return { objects: [] } }',
  createTimeline:
    '(ctx, content, duration) => ctx.gsap.timeline().to({}, { duration })',
  stack: [
    {
      id: 'hud',
      data: { label: 'take 1' },
      createContent:
        '(ctx) => { const m = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(200, 40)); ctx.overlayScene.add(m); return { objects: [m] } }',
      onFrame:
        '(ctx, content) => { content.objects[0].position.x = ctx.time * 50 }',
    },
  ],
}
```

Three rules make it a composition, not a nesting:

- **Own data.** An entry's `ctx.data` is its own: `data` bakes the default, `deps.stack[id]` overrides it at load, and `SET_DATA { data, target: id }` replaces it live with the same three rungs as the main program. Everything else on `ctx` (`scene`, `overlayScene`, `renderer`, `elements`, `time`, `progress`) is shared.
- **One clock.** Entries have no `createTimeline`; they read `ctx.time` like any hook, so frames stay a pure function of time.
- **Own errors.** A throwing entry is disabled for the session and reported (bridge `STACK_ERROR`); the main program and the other entries keep running. `GET_STACK_STATE` answers which entries are alive.

An entry's `createContent` returns the objects it added, like the main program's; that list is what a rebuild removes, since entries share the scene. Addon detection and the determinism lints read an entry's strings exactly as the main program's.

## Retime the tweens, live

A host editing a program's timing does not need to rewrite `createTimeline`. On the vos tween backend the recorded timeline takes an overlay (`@vosjs/tween`'s `TweenEdit[]`, one entry per recorded tween index) and the bridge applies it live:

```ts
player.postMessage({
  type: 'SET_TWEEN_EDITS',
  edits: [{ index: 2, startTime: 2.7, duration: 4 }],
})
```

The whole overlay, every time: it applies from the recording, never on top of the previous overlay, so an edit that leaves the overlay leaves the timeline too. The frame under the playhead repaints, an `UPDATE` carries the new duration, and the overlay survives a warm `LOAD` (or rides one as `LOAD.tweenEdits`). `READY.canRetimeTweens` says the running timeline honors it; the gsap backend does not, and a host then bakes the overlay into `createTimeline` (`@vosjs/shared/timelineEdits`) and loads.

## The bridge protocol

A `playback` page speaks `VOS_BRIDGE_PROTOCOL` (currently 8) over `postMessage`. Commands: `LOAD` (a program, its `data`, `stack` data and `tweenEdits`), `PLAY`, `PAUSE`, `SEEK_TIME`, `PLAY_SPEED`, `SET_DURATION`, `SET_DATA`, `SET_TWEEN_EDITS`, `SET_MUTED`, `GET_STACK_STATE`, and in editor mode `HIT_TEST`, `GET_ELEMENT_RECTS`, `SET_ELEMENT_PROPS`, `OBJECT_BOUNDS`. Events: `BRIDGE_READY`, `READY` (with `canSetDuration`, `canRetimeTweens`, `retime`, `stack`), `UPDATE { progress, time, duration }`, `PRELOAD_PROGRESS`, `STACK_ERROR`, `STACK_STATE`, `OBJECT_RECT`. The `VosBridgeCommand` and `VosBridgeEvent` types are exported from `@vosjs/core/runtime`; `@vosjs/editor` is the host-side client.

## Render audio

An `audio` element plays under the master clock: set `props.playing`, animate `props.currentTime`, fade `props.gain`. `@vosjs/core/audio` renders that same sound offline, so an export carries it:

```ts
import { renderAudio, toAudioBuffer } from '@vosjs/core/audio'

const pcm = await renderAudio(config, { sampleRate: 48000, channels: 2 })
// { sampleRate, length, channels: Float32Array[] }: mux it beside the captured frames,
// or wrap it for Web Audio with toAudioBuffer(pcm, audioContext)
```

The schedule is sampled with the same pure tween sampler live playback uses (`playing`, `currentTime`, `gain` on every audio element, through `retime`), then the decoded sources are mixed sample-exactly into plain PCM. No DOM, no pixels: the decoder is injectable (`decode: (src) => Promise<PcmBuffer | null>`; the default is `fetch` plus Web Audio's `decodeAudioData` where a context exists), so it runs in a Worker or in Node as well as a page. `planAudio` and `mixAudio` are the two halves, for consumers that inspect a schedule or bring their own sources.

`gainEnvelope` on an audio element is `[t, gain]` points over output time, linear between them and held flat outside, multiplied with `props.gain`: a fade, a duck under a voice, a bed that swells, as data the renderer replays and live playback follows frame by frame. `normalizeEnvelope` and `sampleEnvelope` read one.

## Determinism and linting

The engine owns a single master clock and every render is a pure function of time, so the same config produces the same frames anywhere. `@vosjs/core/lint` guards that contract before you render:

```ts
import {
  lintVosConfig,
  hasDeterminismErrors,
  lintVosDialect,
  lintVosFonts,
} from '@vosjs/core/lint'

const issues = lintVosConfig(config)
if (hasDeterminismErrors(issues)) throw new Error('non-deterministic config')
```

`lintVosConfig` flags `Math.random`, wall-clock reads, timers and network calls in any function string (rules: `random`, `gsap-random`, `gsap-string-random`, `wall-clock`, `timer`, `network`; silence one line with `// vos-lint-disable-next-line <rule>`). `lintVosDialect` checks the GSAP authoring dialect the recorder can replay (no plugins, modifiers, DOM targets, playback control, `repeatRefresh`, `immediateRender`, snapping, or unknown eases). `lintVosFonts` warns when a text element names a family that `fonts` does not declare, which would fall back silently on a server.

## Addons

Function strings are scanned by keyword: naming `ctx.loaders.GLTFLoader` or `ctx.utils.OrbitControls` in `setup` pulls that addon into the compiled import map, and a generic `loaders` or `utils` reference pulls the whole category. `ADDON_REGISTRY` lists them with a `category` of `loader`, `util`, `postprocessing` or `external`; external npm packages carry an `importSpecifier`, `namedExports` and a `cdnUrl`. Modules load from `esm.sh` (`CDN_ORIGIN`, `threeUrl`, `gsapUrl`, `externalPackageUrl` in `@vosjs/core/addons`).

## Subpath exports

| Import                 | What it gives you                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vosjs/core`          | `compileVosConfig`, `vosConfigJsonSchema`, `vosConfigSchema`, `isValidVosConfigJson`, `migrateConfig`, `CURRENT_CONFIG_VERSION`, the registries, the types |
| `@vosjs/core/compiler` | `compileVosConfig(config, { tweenEngine? })`                                                                                                               |
| `@vosjs/core/runtime`  | `generateRenderTemplate`, `transformModuleCode`, `RENDER_LIMITS`, `VOS_BRIDGE_PROTOCOL`, the bridge types                                                  |
| `@vosjs/core/audio`    | `renderAudio`, `planAudio`, `mixAudio`, `toAudioBuffer`, `normalizeEnvelope`, `sampleEnvelope`, the PCM helpers                                            |
| `@vosjs/core/schema`   | The Zod schemas, `migrateConfig`, the validators                                                                                                           |
| `@vosjs/core/addons`   | `ADDON_REGISTRY`, `POSTPROCESSING_REGISTRY`, `detectRequiredAddons`, `generateAddonImports`, the CDN URL helpers                                           |
| `@vosjs/core/extract`  | `extractConfigFromText`, `extractConfigFromFunctionCall`: pull a config out of model or text output                                                        |
| `@vosjs/core/lint`     | `lintVosConfig`, `hasDeterminismErrors`, `lintVosDialect`, `hasDialectErrors`, `lintVosFonts`                                                              |
| `@vosjs/core/types`    | Type definitions only                                                                                                                                      |

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
