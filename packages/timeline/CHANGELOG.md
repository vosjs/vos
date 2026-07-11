# @vosjs/timeline

## 0.3.0

### Minor Changes

- dbb1250: Rate-aware time remapping (speed changes). `Segment` gains an optional `rate` field (source seconds per output second): `mapTime`, `sourceToTimeline`, and `totalDuration` now evaluate rated segments, so speed-ups contract the output timeline and slow-downs stretch it. New `SpeedSpan` type + `splitBySpeed(segments, speeds)` intersect footage-anchored speed spans with a segment list into rated segments, `rateAt(segments, t)` reports the rate under the playhead (for mirroring with `video.playbackRate`), and `segmentRate(segment)` exposes the effective rate. Segment-editing helpers (`splitSegments`, `trimSegment`) preserve rates and scan in output time. Backward compatible: rate-less segments behave exactly as before, and the runtime bundle (`__vosTimeline`) picks the new math up transparently.

## 0.2.0

### Minor Changes

- 4f19e94: Deterministic tween sampler + dialect tooling.

  - `@vosjs/core`: structural `VosTimeline` interface (public API no longer
    hard-depends on the `gsap` type); `lintVosDialect()` enforcing the frozen
    tween dialect (plugins, `modifiers`, selector targets, playback control,
    `repeatRefresh`, `snap`; ease-set warnings) with `DIALECT.md`; determinism
    linter catches string-form `random()` values and `stagger: {from: 'random'}`.
  - `@vosjs/timeline`: `elastic`/`bounce`/`steps(n)` easings and parameterized
    ease parsing (`back.out(1.7)`, `elastic.out(1, 0.3)`), bare-family default
    (`'power2'` → `power2.out`) — all curve-verified against `gsap.parseEase`.
  - `@vosjs/tween`: sampler backend — with no live backend, a recorded timeline
    now evaluates itself: pure `seek(t)` (repeat/yoyo folding, analytic implicit
    endpoint capture, defined conflict rule), per-tween and timeline `onUpdate`,
    wall-clock preview `play()`. Array targets expand with GSAP-normalized
    stagger offsets (`each`/`amount`/`from`). Differential parity harness proves
    numeric equivalence with real GSAP across the dialect corpus.

## 0.1.1

### Patch Changes

- 0a4a6e4: Improve npm discoverability metadata: query-matched descriptions, expanded keywords, and homepage pointing at vos.so/engine. No code changes.

## 0.1.0

### Minor Changes

- 60a6279: Initial release: deterministic time math for editable vos compositions.

  - **Value types** (`Keyframe`, `KeyframeTrack`, `Segment`, `EaseName`) designed
    to be embedded inside app project documents and shipped through `ctx.data` —
    an evaluation library, not a document format.
  - **`sample(track, t, lerp?)`**: pure keyframe evaluation (binary search,
    clamp outside the range, ease-into convention, `step` mode, custom lerps).
  - **GSAP-parity easings**: `EASINGS` registry (`none`, `power1..4`, `sine`,
    `expo`, `circ`, `back` × in/out/inOut) built with GSAP's own in/out/inOut
    construction and verified against `gsap.parseEase` in tests.
  - **`mapTime` / `sourceToTimeline` / `totalDuration`**: source-time remapping —
    the trim/split/multi-clip primitive.
  - **Segment edit helpers** (host-only): `splitSegments`, `trimSegment`,
    `removeSegment`, `normalizeSegments`.
  - **`@vosjs/timeline/bundle`**: `timelineRuntimeCode`, a self-contained IIFE
    exposing `globalThis.__vosTimeline` for inlining into constant interpreter
    programs — golden-tested to evaluate identically to the host module.
