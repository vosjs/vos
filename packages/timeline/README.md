# @vosjs/timeline

> Deterministic time math for editable compositions: keyframe sampling, GSAP-compatible pure easings, and source-time remapping across trims, splits and speed changes.

[![npm](https://img.shields.io/npm/v/@vosjs/timeline.svg)](https://www.npmjs.com/package/@vosjs/timeline)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open programmatic video engine behind [vos.so](https://vos.so). This is an evaluation library, not a document format: apps embed its value types (keyframes, segments, speed spans) inside their own documents and evaluate them with the same functions on both sides of the player bridge. No DOM, no engine coupling, no random source, no wall clock, no dependencies. Every function is a pure function of its arguments, so `seek(t)` renders identically on the host and inside a running program.

## Install

```bash
pnpm add @vosjs/timeline
```

## What it does

- **Keyframe sampling.** `sample(track, t)` interpolates a numeric `KeyframeTrack` at any time; `sample(track, t, lerpArray)` does the same for vector tracks. A keyframe's `ease` names the curve into it from the previous keyframe; `interpolate: 'step'` holds. `sortKeyframes` is the primitive underneath, and `sample` throws on an empty track.
- **GSAP-compatible easings.** `EASINGS` and `resolveEase(name)` give pure easing functions under GSAP's names, including parameterized forms (`back.out(1.7)`, `elastic.inOut(1, 0.5)`, `steps(5)`), bare families (`power2` means `power2.out`) and the `css-bezier(x1, y1, x2, y2)` dialect, so a recorded animation samples the curve its author saw. An unknown name resolves to linear rather than throwing.
- **Source-time remapping.** A `Segment` is a kept span of source footage `{ in, out, rate? }`, where `rate` is source seconds per output second. `mapTime(segments, outputT)` projects output time into source time, `sourceToTimeline` goes the other way (and returns `null` inside a cut), `totalDuration` and `rateAt` read the list, and `splitBySpeed(segments, speedSpans)` folds speed spans into rated segments. An empty list is the identity.
- **Segment edits.** `trimSegment`, `splitSegments`, `removeSegment` and `normalizeSegments` edit a segment list with a `MIN_SEGMENT_LENGTH` floor of 0.05 s.

## Two evaluation contexts

The same math runs host-side and inside a compiled program. The host imports from `@vosjs/timeline`; a render template inlines the runtime string from `@vosjs/timeline/bundle`, which defines `globalThis.__vosTimeline` with the evaluation subset: `EASINGS`, `resolveEase`, `lerpArray`, `sample`, `mapTime`, `rateAt`, `sourceToTimeline`, `totalDuration`. The edit helpers and `splitBySpeed` are host-only by design; a program receives already-rated segments as data.

```ts
// host
import { sample, mapTime, resolveEase } from '@vosjs/timeline'

const value = sample(track, t)
const sourceTime = mapTime(segments, outputTime)
const ease = resolveEase('power2.inOut')
```

```ts
// building a render template
import { timelineRuntimeCode } from '@vosjs/timeline/bundle'
// inline timelineRuntimeCode before the program; it reads __vosTimeline.sample(...)
```

## Exports

`sample`, `lerpArray`, `sortKeyframes`, `EASINGS`, `resolveEase`, `mapTime`, `sourceToTimeline`, `totalDuration`, `rateAt`, `segmentRate`, `splitBySpeed`, `trimSegment`, `splitSegments`, `removeSegment`, `normalizeSegments`, `MIN_SEGMENT_LENGTH`; types `Keyframe`, `KeyframeTrack`, `Segment`, `SpeedSpan`, `EaseName`, `EaseFn`, `Lerp`. `@vosjs/timeline/bundle` exports `timelineRuntimeCode`.

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
