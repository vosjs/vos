# @vosjs/tween

> Record a GSAP-dialect timeline into a structured, per-element tween IR — a recording facade that delegates 1:1 to a real tween backend while capturing the animation as data you can extract, edit, and deterministically sample.

[![npm](https://img.shields.io/npm/v/@vosjs/tween.svg)](https://www.npmjs.com/package/@vosjs/tween)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open visual operating system behind [vosso](https://vos.so). vos configs author animation as GSAP-dialect `createTimeline` functions. This package lets that same authoring surface become **data**: the recorder is shaped like the slice of `gsap` those functions use, captures every tween as a `TweenSpec` (with GSAP position parameters resolved to absolute time), and — given a real `gsap` backend — delegates 1:1 so live playback is unchanged.

## Install

```bash
pnpm add @vosjs/tween
```

## The pieces

- **Recorder** (`createTweenRecorder`, `RecordingTimeline`) — a `gsap`-shaped facade that records tweens as `TweenSpec`s. Pass a real `gsap` backend to delegate playback 1:1, or none to record only.
- **Extraction** (`extractTimeline`, `buildTracks`) — fold the recorded specs into per-target keyframe tracks (`TargetTrack` / `TimelineDoc`): the neutral model a per-element timeline editor edits.
- **Deterministic sampler** (`createSampler`) — evaluate a recorded timeline with no GSAP present. `seek(t)` becomes a pure function, which is what makes server rendering and frame-accurate export reproducible.
- **Spec player** (`createSpecPlayer`, `contextResolver`) — play a `TweenSpec[]` that lives in a document's data, resolving targets against a live context each frame (the timeline-as-data path).
- **Helpers** — `staggerOffsets`, `parseVars`, target tagging (`tagTarget`/`readTag`), and extraction-scope stubs (`makeElement`, `runCreateTimeline`, …).

## Example

```ts
import gsap from 'gsap'
import { createTweenRecorder, extractTimeline, createSampler } from '@vosjs/tween'

// record a config's createTimeline against the facade (delegating to real gsap)
const recorder = createTweenRecorder({ backend: gsap })
createTimeline(ctx, content, duration) // uses recorder as ctx.gsap

// fold into per-element tracks, then sample deterministically — no gsap needed
const doc = extractTimeline(recorder.specs)
const sampler = createSampler(doc)
const frame = sampler.seek(1.5)
```

A subpath `@vosjs/tween/bundle` provides the sampler/spec-player runtime as an inlinable string for injection into a compiled program template.

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
