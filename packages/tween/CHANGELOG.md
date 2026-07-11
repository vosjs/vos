# @vosjs/tween

## 0.7.0

### Minor Changes

- d156298: `createSpecPlayer(resolve)` + `contextResolver(ctx, content)` — data-driven
  timeline playback: evaluate serializable `TweenSpec[]` (carried in a program's
  `ctx.data`) against live targets each frame. `setSpecs` memoizes by array
  identity (frozen SET_DATA snapshots invalidate for free) and preserves
  original base values across rebuilds, so implicit starts stay correct when
  specs are live-swapped mid-playback. The interpreter-pattern foundation for
  data-driven animation editing. Exposed in the runtime bundle.

## 0.6.0

### Minor Changes

- 05fc9a8: `TweenEdit` value overrides: `to` / `from` per-property numeric overrides merge
  into the recorded spec (an absolute `to` supersedes a relative `'+=x'` delta;
  a `from` override on an implicit-start prop pins it). Completes the overlay
  editing surface: retime, re-ease, and re-value without regenerating code.

## 0.5.1

### Patch Changes

- 443b4fb: Fix scrubbing on the sampler backend: `progress(value)` and `time(value)` are
  now GSAP-style setters (setter = seek). The playback bridge's SEEK command
  calls `timeline.progress(value)` — the getter-only implementation silently
  ignored it, so dragging the player's progress bar snapped back to the
  pre-drag position.

## 0.5.0

### Minor Changes

- 326df42: `RecordingTimeline.applyEdits(edits)` — serializable timing/ease overrides
  (`TweenEdit`: entry index → startTime/duration/ease) applied to the recorded
  entries with the master footprint recomputed and the sampler invalidated.
  This is the editor retiming seam: replay the original `createTimeline`
  through the recorder, then apply the overlay — works for opaque tweens
  (onUpdate/modifier bodies) too, since edits address timing, not values.

## 0.4.0

### Minor Changes

- d891f70: Selectable tween backend (`tweenEngine: 'gsap' | 'vos'`).

  - `@vosjs/core`: `generateRenderTemplate` accepts `tweenEngine` +
    `tweenBundleCode` — in vos mode the template imports no GSAP (the importmap
    entry remains for legacy artifacts), inlines the @vosjs/tween runtime, and
    supplies `deps.gsap` as a fresh deterministic recorder per LOAD.
    `compileVosConfig` accepts `{ tweenEngine }` to omit the (shadowed) gsap
    import from compiled modules. Compiled artifacts stay backend-agnostic:
    `ctx.gsap` always comes from `deps.gsap`, so either artifact runs under
    either host backend.
  - `@vosjs/tween`: new `@vosjs/tween/bundle` export (`tweenRuntimeCode` IIFE
    defining `globalThis.__vosTween`) and the remaining master-timeline
    transport surface — `paused()`, `repeat()` (`-1` loops the play driver),
    `kill()`, getter forms of `timeScale()` / `eventCallback()`.

## 0.3.0

### Minor Changes

- d69465f: Relative numeric tween values (`'+=0.5'` / `'-=10'`): recorded as structured
  per-property deltas (`TweenSpec.toRelative`), resolved by the sampler and the
  extractor as `destination = start value ± delta`. Surfaced by the real-config
  parity sweep (a common authored idiom). DIALECT.md updated.

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

### Patch Changes

- Updated dependencies [4f19e94]
  - @vosjs/timeline@0.2.0

## 0.1.1

### Patch Changes

- 1248cc0: Fix the published `@vosjs/timeline` dependency spec to a concrete semver range so
  the package installs from the registry (the initial 0.1.0 publish carried an
  unrewritten `workspace:` protocol spec).
