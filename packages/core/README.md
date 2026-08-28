# @vosjs/core

> The vos engine — turn a function into deterministic, resolution-independent, mixed-media video. Compiler, schema, runtime, and addon registry.

[![npm](https://img.shields.io/npm/v/@vosjs/core.svg)](https://www.npmjs.com/package/@vosjs/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open visual operating system that powers [vosso](https://vos.so).

**A video is just inputs and a function, rendered.** `@vosjs/core` takes a JSON description of an animation — scenes, cameras, post-processing, GSAP timelines, and overlay elements — and **compiles** it into a self-contained template that renders identically every time. The core is pure (no DOM dependencies), so it runs in the browser, in Node, or in a Cloudflare Worker for server-side rendering.

## Install

```bash
pnpm add @vosjs/core three gsap
```

`three` and `gsap` are **optional peer dependencies** — you bring your own versions, and the engine never bundles them.

## Quick start

```ts
import { compileVosConfig, vosConfigJsonSchema } from '@vosjs/core'

const config = {
  version: 2,
  duration: 3,
  camera: { preset: 'perspective' },
  // functions are authored as strings, compiled into executable code
  createContent:
    '(ctx) => { const { THREE, scene } = ctx; const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(m); return { m } }',
  createTimeline:
    '(ctx, content, duration) => ctx.gsap.timeline().to(content.m.rotation, { y: Math.PI, duration })',
}

vosConfigJsonSchema.parse(config) // validate
const template = compileVosConfig(config) // → runnable template string
```

The compiled template is a single HTML/JS document. One template powers all three modes — `generateRenderTemplate({ mode })` builds it for `playback` (interactive iframe), `capture-video` (frame-by-frame WebCodecs encode), or `capture-thumbnail` (single-frame snapshot) — so what you preview is exactly what you export.

## Determinism & linting

The engine owns a single master clock and every render is a pure function of time, so the same config produces the same frames anywhere. `@vosjs/core/lint` guards that contract before you render:

```ts
import { lintVosConfig, hasDeterminismErrors } from '@vosjs/core/lint'

const issues = lintVosConfig(config)
if (hasDeterminismErrors(issues)) throw new Error('non-deterministic config')
```

`lintVosConfig` flags non-deterministic patterns (`Date.now()`, `Math.random()`, wall-clock reads), and `lintVosDialect` checks the GSAP authoring dialect.

## Retime the tweens, live

A host editing a program's timing does not need to rewrite `createTimeline`. On the vos tween backend the recorded timeline takes an overlay — `@vosjs/tween`'s `TweenEdit[]`, one entry per recorded tween index — and the bridge applies it live:

```ts
player.postMessage({
  type: 'SET_TWEEN_EDITS',
  edits: [{ index: 2, startTime: 2.7, duration: 4 }],
})
```

The whole overlay, every time: it applies from the recording, never on top of the previous overlay, so an edit that leaves the overlay leaves the timeline too. The frame under the playhead repaints, an `UPDATE` carries the new duration, and the overlay survives a warm `LOAD` (or rides one as `LOAD.tweenEdits`). `READY.canRetimeTweens` says the running timeline honors it; the gsap backend does not, and a host then bakes the overlay into `createTimeline` (`tl.applyEdits(edits)` after the user's function returns) and loads.

## Retime

`retime` evaluates the program at `f(t)`: a pure function of the OUTPUT time and `ctx.data`, returning the program time to render.

```ts
const config = {
  // …
  data: { rate: 0.5 },
  retime: '(t, data) => t * data.rate', // half speed; setData({ rate: 2 }) doubles it live
}
```

Each frame the runtime seeks the program's own timeline at `retime(outputTime, data)` and sets `ctx.time` to it, while the transport (play, pause, seek, `SET_DURATION`, capture) keeps counting output time on a clock of `duration` seconds — `ctx.outputTime` carries that number, and `READY.retime` tells a host the transport is the clock. Slow motion, speed ramps, reverse (`(t, d) => d.duration - t`), a freeze frame, a ping-pong loop, none of them needing the timeline re-authored, and every capture path exact by construction because a frame is still a pure function of `(data, output time)`. The result is clamped to the program timeline's `[0, duration]`; a non-finite result falls back to `t` and warns once. Stack entries are output-anchored: their `ctx.time` is the output time, so a retime never moves a HUD.

## The program stack

A config runs one program: `setup → createContent → createTimeline → onFrame`. `stack` runs more of them on the same context, after the main one, in array order — a HUD, a subtitle pass, a watermark, an overlay a remixer adds without touching the main program's code:

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

- **Own data.** An entry's `ctx.data` is its own: `data` bakes the default, `deps.stack[id]` overrides it at load, and `setData(next, id)` (bridge: `SET_DATA { data, target: id }`) replaces it live with the same three rungs as the main program (`content.onData`, else an `onFrame` entry reads next frame, else the entry's content is rebuilt). Everything else on `ctx` — `scene`, `overlayScene`, `renderer`, `elements`, `objects`, `time`, `progress` — is shared.
- **One clock.** Entries have no `createTimeline`; they read `ctx.time` like any hook, so frames stay a pure function of time.
- **Own errors.** A throwing entry is disabled for the session and reported (`result.stack.onError`, bridge `STACK_ERROR`); the main program and the other entries keep running. `result.stack.state()` (bridge `GET_STACK_STATE`) says which entries are alive.

An entry's `createContent` returns the objects it added (`objects`), like the main program's — that list is what a rebuild removes, since entries share the scene. Addon detection and the determinism lints read an entry's strings exactly as the main program's.

## Render audio

An `AudioElement` plays under the master clock: set `props.playing`, animate `props.currentTime`, fade `props.gain`. `@vosjs/core/audio` renders that same sound offline, so an export carries it:

```ts
import { renderAudio, toAudioBuffer } from '@vosjs/core/audio'

const pcm = await renderAudio(config, { sampleRate: 48000, channels: 2 })
// { sampleRate, length, channels: Float32Array[] } — mux it beside the captured frames,
// or wrap it for Web Audio: toAudioBuffer(pcm, audioContext)
```

The schedule is sampled with the same pure tween sampler live playback uses (`playing`, `currentTime`, `gain` on every audio element, through `retime`), then the decoded sources are mixed sample-exactly into plain PCM. No DOM, no pixels: the decoder is injectable (`decode: (src) => Promise<PcmBuffer | null>`; the default is `fetch` + Web Audio's `decodeAudioData` where a context exists), so it runs in a Worker or in Node as well as a page. `planAudio` and `mixAudio` are the two halves, for consumers that inspect a schedule or bring their own sources.

`gainEnvelope` on an `AudioElement` is `[t, gain]` points over output time, linear between them and held flat outside, multiplied with `props.gain`: a fade, a duck under a voice, a bed that swells, as data the renderer replays and live playback follows frame by frame.

## Subpath exports

| Import                 | What it gives you                                              |
| ---------------------- | -------------------------------------------------------------- |
| `@vosjs/core`          | `compileVosConfig`, schemas, addon registry, types             |
| `@vosjs/core/compiler` | The compiler and code generators                               |
| `@vosjs/core/runtime`  | `generateRenderTemplate`, `transformModuleCode`, render limits |
| `@vosjs/core/audio`    | `renderAudio`, `planAudio`, `mixAudio`, the gain envelope      |
| `@vosjs/core/schema`   | Zod schemas, validators, config migrations                     |
| `@vosjs/core/addons`   | Three.js addon / post-processing registry                      |
| `@vosjs/core/extract`  | Config extraction from LLM/text output                         |
| `@vosjs/core/lint`     | Determinism + GSAP-dialect linters for configs                 |
| `@vosjs/core/types`    | Pure type definitions                                          |

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
