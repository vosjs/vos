# @vosjs/tween

> Record a GSAP-dialect timeline into a per-target tween IR, then sample it deterministically with no GSAP present: the animation becomes data you can extract, retime and replay frame for frame.

[![npm](https://img.shields.io/npm/v/@vosjs/tween.svg)](https://www.npmjs.com/package/@vosjs/tween)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open programmatic video engine behind [vos.so](https://vos.so). vos configs author animation as GSAP-dialect `createTimeline` functions. This package lets that authoring surface become data: the recorder is shaped like the slice of `gsap` those functions use, captures every tween as a `TweenSpec` with position parameters resolved to absolute time, and plays the recording back through a pure sampler, which is what makes a server render frame-identical to a browser preview. In vos nothing loads GSAP at run time: it is the shape of the authoring API, not an engine underneath it. Its only dependency is `@vosjs/timeline`.

## Install

```bash
pnpm add @vosjs/tween
```

## The pieces

- **Recorder.** `createTweenRecorder(backend?)` returns a `gsap`-shaped object: `timeline(vars)` gives a `RecordingTimeline` that records `to`, `from`, `fromTo`, `set`, `add`, labels, `repeat` and callbacks as `TweenSpec`s. The optional `backend` forwards each call to a real `gsap`, a legacy seam for hosts still driving playback with it; vos itself passes none. It also exposes `utils` and the list of `timelines` it created.
- **Retime overlay.** `timeline.applyEdits(edits)` takes `TweenEdit[]` (`{ index, startTime?, duration?, ease?, to?, from? }`, addressed by recorded index) and applies them from the original recording every time, so an edit that leaves the overlay leaves the timeline. This is the seam the engine's `SET_TWEEN_EDITS` rides.
- **Extraction.** `extractTimeline(timeline)` folds the recording into a `TimelineDoc` (`{ duration, specs, tracks }`) of per-target keyframe tracks; `buildTracks(specs)` is the half that takes bare specs. This is the neutral model a per-element timeline editor edits.
- **Deterministic sampler.** `createSampler(entries)` evaluates recorded entries with no GSAP present; `seek(t)` writes the sampled values onto the targets. A backend-less `RecordingTimeline` seeks through it, so the same `createTimeline` plays anywhere.
- **Spec player.** `createSpecPlayer(resolve)` plays a `TweenSpec[]` that lives in a document's data, resolving targets against a live context each frame through `contextResolver(ctx, content)`: the timeline-as-data path.
- **Helpers.** `staggerOffsets`, `parseVars`, target tagging (`tagTarget`, `readTag`, `targetKey`), and the extraction-scope stubs (`makeElement`, `makeElementsMap`, `tagUniforms`, `tagRef`, `runCreateTimeline`) that let a host run a config's `createTimeline` against stand-in content.

## Example

```ts
import { createTweenRecorder, extractTimeline } from '@vosjs/tween'

// run a config's createTimeline with the recorder as ctx.gsap
const recorder = createTweenRecorder()
const tl = createTimeline({ ...ctx, gsap: recorder }, content, duration)

// the animation as data
const doc = extractTimeline(tl) // { duration, specs, tracks }

// retime tween #0 without touching the author's function
tl.applyEdits([{ index: 0, startTime: 0.5, duration: 1.2 }])

// seek is a pure function: the sampler writes the values onto the targets
tl.seek(0.5)
```

`runCreateTimeline(source, { gsap: recorder }, content, duration)` does the first step from a function string, with the stubs a bare extraction needs.

`@vosjs/tween/bundle` exports `tweenRuntimeCode`, an inlinable string that defines `globalThis.__vosTween` (the recorder, the timeline, extraction, the spec player and the tagging helpers) for a compiled program's page.

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
