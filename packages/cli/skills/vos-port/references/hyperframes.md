# HyperFrames → vos

A HyperFrames composition is HTML and CSS moved by ONE paused GSAP timeline.
vos speaks the GSAP dialect, so most calls carry over nearly verbatim; what
changes is the target (an element's `props` instead of a DOM node) and the
units (render pixels, y down, degrees counter-clockwise).

| HyperFrames | vos |
| --- | --- |
| root `data-width`, `data-height`, `data-duration` | render size; `config.duration` |
| `data-composition-variables`, CSS custom properties on the root (`--bg`, `--accent`) | `data` keys and `params` (a colour variable is a `color` knob) |
| a text node or heading | a `text` element, `content: { "$data": key }` |
| inline `<svg>` / `<img>` | an `svg` element (`src` is the markup) / an `image` element, the file uploaded |
| `<video data-start data-media-start>` | a `video` element, windowed by opacity; no source in-point yet |
| `<audio data-start data-duration data-volume>` | `doc.json` `audio: [{ key, start, in: 0, out: duration, duration, gain: volume, fadeIn, fadeOut }]` |
| `gsap.timeline({ paused: true })` at `window.__timelines[id]` | `createTimeline` returns `ctx.gsap.timeline({ paused: true })`; vos drives it |
| `tl.to / from / fromTo / set` on a DOM node | the same call on `ctx.elements.get(id).props` |
| `x`, `y` in CSS pixels | `* k` (`k = ctx.resolution.height / 1080`); y grows down |
| `rotation` / `rotate` in degrees | negate it (vos is counter-clockwise) |
| SplitText-style per-character motion | `split: { type: 'chars' }` + tweens over `segments` |
| a sub-composition or scene `div` with a time window | `tl.addLabel(name, t)` and its elements tweened in and out inside the window |
| an `onUpdate` proxy clock that draws (`renderAll(t)`) | `onFrame(ctx)`, reading `ctx.time`, for exactly those procedural parts |
| GSAP ease names (`power3.out`, `back.out(1.7)`, `expo.inOut`) | the same names |
| a CSS `cubic-bezier(a, b, c, d)` timing | `ease: 'css-bezier(a, b, c, d)'` (exact; spelled `cubic-bezier` it plays linear) |
| CSS `--chrome` set by the timeline | a `data` value read in `onFrame`, or a tween on the element that shows it |
| faces resolved by the runtime from CSS families | `fonts: [{ family, weight, url }]` from the catalog |
| `mix-blend-mode`, `clip-path`, `overflow: hidden` reveals | GAPS: a revealed word keeps its bound element with an opacity approximation; the painter only for a shape; said in the push note |

Two traps specific to HyperFrames sources:

- The runtime rewrites a sub-composition's CSS (it scopes selectors), which
  can flip the cascade: the file you read is not always the document that
  renders. When a colour or size disagrees with the render, believe the
  render (`npx hyperframes render`), not the stylesheet.
- `window.__player.seek(t)` is the clock the renderer uses; seeking
  `__timelines.main` does not drive a mounted sub-composition. Read times
  from the render, not by scrubbing the main timeline.
