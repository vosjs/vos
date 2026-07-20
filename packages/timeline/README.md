# @vosjs/timeline

> Deterministic time math for editable vos compositions — keyframe sampling, GSAP-compatible pure easings, and source-time remapping (trim / split / speed).

[![npm](https://img.shields.io/npm/v/@vosjs/timeline.svg)](https://www.npmjs.com/package/@vosjs/timeline)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open visual operating system behind [vosso](https://vos.so). This is a pure evaluation **library**, not a document format: apps embed its value types (keyframes, segments, speed spans) inside their own project documents and evaluate them with the same functions on both sides of the player bridge. No DOM, no engine coupling, no RNG or wall-clock — every function is a pure function of its arguments, so `seek(t)` renders identically on the host and inside a running program.

## Install

```bash
pnpm add @vosjs/timeline
```

## What it does

- **Keyframe sampling** — `sample()` interpolates a `KeyframeTrack` at any time with a resolved easing; `lerpArray` and `sortKeyframes` are the primitives underneath.
- **GSAP-compatible easings** — `EASINGS` / `resolveEase()` provide pure easing functions matching GSAP's names (including `css-bezier(…)` dialect eases), so a recorded animation samples the same curve the author saw.
- **Source-time remapping** — `mapTime`, `sourceToTimeline`, `totalDuration`, `rateAt`, `segmentRate`, and `splitBySpeed` remap between output time and source (footage) time across trims and speed changes. Editors keep spans anchored in source; the remap projects them into output.
- **Segment edits** — `trimSegment`, `splitSegments`, `removeSegment`, `normalizeSegments` operate on segment lists with a `MIN_SEGMENT_LENGTH` floor.

## Two evaluation contexts

The same math runs host-side (import from `@vosjs/timeline`) and inside a compiled program (inline the runtime string from `@vosjs/timeline/bundle`), so a timeline you edit in an app evaluates bit-identically when the program plays back.

```ts
// host
import { sample, mapTime, resolveEase } from '@vosjs/timeline'

const value = sample(track, t, resolveEase)
const sourceTime = mapTime(segments, outputTime)
```

```ts
// inside a program template
import { timelineRuntimeCode } from '@vosjs/timeline/bundle'
// inline timelineRuntimeCode into the render template; it exposes the same functions
```

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
