# The vos tween dialect

`createTimeline` in a `VosConfigJson` returns a **master timeline** that the engine
seeks frame-by-frame (`pause()` → `seek(frame / fps)` → render → capture). Because
export is frame-stepped, rendering must be a pure function of timeline time: the same
`t` must always produce the same pixels.

The engine uses GSAP's `timeline()` as the default implementation of that clock, and
GSAP is the recommended **authoring dialect** — it is the most widely documented
animation API, so hand-written and LLM-generated timelines are best expressed in it.
But the engine only depends on a small **structural** timeline surface (`VosTimeline`:
`pause/play/seek/clear/timeScale/time/progress/duration/totalDuration/eventCallback`),
and the set of tween features the engine and its editing tools can faithfully
model is a deliberately frozen **subset** of the GSAP API.

`lintVosDialect()` (in `@vosjs/core/lint`) enforces that subset. This document is the
human-readable spec behind it. A config can be perfectly deterministic on real GSAP and
still be off-dialect (e.g. a `modifiers` callback) — the determinism linter and the
dialect linter are separate checks.

Suppress any single line with `// vos-lint-disable-next-line <rule|all>`.

## Supported surface

- **Timeline creation:** `ctx.gsap.timeline(vars)`, ideally `{ paused: true }`.
- **Tweens:** `.to`, `.from`, `.fromTo`, `.set` on **plain objects**, element `props`
  / `segments`, shader `uniforms`, or THREE object numerics (`.rotation`, `.position`, …).
- **Position parameters:** absolute seconds (`0`, `1.5`), labels, `'<'` / `'>'`,
  relative `'+=x'` / `'-=x'`.
- **Vars:** `duration`, `delay`, `ease` (see below), `repeat`, `yoyo`, `repeatDelay`,
  numeric/`{each, amount, from: <index|'start'|'center'|'end'|'edges'>}` `stagger`,
  and callbacks (`onUpdate`, `onComplete`, …).
- **Eases (string form):** `none`, `linear`, and `<family>.<in|out|inOut>` for families
  `power1`–`power4`, `sine`, `expo`, `circ`, `back`.
- **Tweened values:** numbers. (Colors, unit strings, and complex string interpolation
  are outside the numeric core.)

## Not in the dialect (and why)

| Rule | Rejected | Why | Instead |
| --- | --- | --- | --- |
| `plugin` | `registerPlugin`, ScrollTrigger, DrawSVG, MorphSVG, MotionPath, SplitText, Flip, Physics2D, TextPlugin, CustomEase, GSDevTools, … | Plugins are large, effect-specific surfaces; several are per-tick and not analytically seekable | Absorb the effect as a **vos element capability** driven by numeric props (e.g. path-draw → element `drawStart`/`drawEnd`). Text splitting is native via the element `split` config. |
| `modifiers` | `modifiers: { … }` | Per-tick post-processing whose result can depend on GSAP's vars key order | Tween the driver property, compute derived properties in `onUpdate` |
| `dom-target` | `.to('#id', …)`, `.from('.cls', …)` | String/selector targets pull in DOM + CSS unit/transform semantics | Tween plain objects / element `props` / THREE numerics |
| `playback-control` | `addPause()`, `tweenTo()`, `tweenFrom()` | Break seek-driven determinism; the engine owns transport | Let the engine drive playback |
| `repeat-refresh` | `repeatRefresh: true` | Re-evaluates values per iteration → iteration-dependent under scrub | Precompute values |
| `snap` | `snap: { … }` | Per-tick post-processing | Precompute snapped values |
| `immediate-render` (warn) | `immediateRender: <override>` | Overrides default render-on-add semantics | Rely on defaults (`from`/`fromTo`/`set` render on add; `to` does not) |
| `unknown-ease` (warn) | `elastic`, `bounce`, `steps()`, `rough`, `slow`, `back.out(1.7)`, other parameterized/custom eases | Not yet implemented by the vendored evaluator — would silently fall back to linear | Use a supported family, or precompute the curve |

## Determinism (separate check)

`lintVosConfig()` additionally flags non-determinism regardless of dialect: `Math.random()`,
`gsap.utils.random()`, **string-form `random()` tween values** (`{ x: 'random(-100,100)' }`),
`stagger: { from: 'random' }`, wall-clock (`Date.now`, `performance.now`), timers/rAF, and
network. Randomness must be seeded or precomputed.

## Cleanroom note

An alternate deterministic backend that implements this dialect must be written from
**public documentation and black-box behavioral testing only** — never by reading GSAP's
source. Parity is established by running the same timeline through both backends and
comparing numeric output. This keeps the dialect an interoperable API surface rather than
a derivative of any one implementation.
