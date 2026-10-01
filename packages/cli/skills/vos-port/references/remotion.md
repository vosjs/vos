# Remotion → vos

Remotion's model is a pure function of the frame; vos's is a timeline the
engine seeks. Most of a port is turning `interpolate(frame, …)` calls into
tweens that start and end at the same seconds with the same curve.
Remotion's compositing (a persistent ground under transparent scenes that
cross-fade) is vos's, so cross-fades port with no compensation.

The interpolate, bezier, translate, rotate, origin, per-letter, scramble and
ground rows were checked against Remotion's render in `intro-port.mjs`; GAP
rows name what has no element equivalent yet.

| Remotion | vos |
| --- | --- |
| `<Composition width height fps durationInFrames defaultProps schema>` | `config.duration = durationInFrames / fps`; render at `--width/--height`; `defaultProps` → `data`; the zod `schema` → `params` kinds (`z.string()` text, a colour string `color`) |
| `useCurrentFrame()` | nothing in a tween (the timeline is the clock); `ctx.time * fps` inside `onFrame` |
| `interpolate(f, [a, b], [x, y], { easing, extrapolate: 'clamp' })` | `tl.fromTo(props, { p: x }, { p: y, duration: (b - a) / fps, ease }, a / fps)` |
| `Easing.bezier(x1, y1, x2, y2)` | `ease: 'css-bezier(x1, y1, x2, y2)'` (exact) |
| `spring({ frame, fps, config })` | the painter starter (cli 0.56+): `content.refs.lib.springTo(tl, props, { y: [from, to] }, at, { fps, config })` puts Remotion's own spring on the timeline, a step per frame, exact to the frame; `lib.spring({ frame, fps, config })` is the value (`durationInFrames`, `delay`, `overshootClamping` as Remotion's). On an older CLI: `back.out(n)` of a similar overshoot, by eye |
| `<Sequence from durationInFrames>` | `tl.addLabel(name, from / fps)` and the scene's elements tweened in and out inside that window |
| `<TransitionSeries>` + `fade()` | opacity tweens across the overlap window |
| `<AbsoluteFill>` + flex centring | `position: 'center'`; offsets in `transform: { translateX, translateY }` (design px) |
| `translateY(Npx)` animated | `props.y` += `N * k` (`k = ctx.resolution.height / 1080`; y grows down, like CSS) |
| `rotate(Ndeg)` | `rotation: -N` (degrees, counter-clockwise) |
| `transformOrigin` other than centre | a centre transform plus a compensating `x`/`y` tween |
| a React text component per letter (`RiseText`) | `split: { type: 'chars' }` + one tween per `segments[i]` at `start + i * stagger` |
| `charStyle` giving one letter a colour | GAP: segments carry no colour; a separate element or a painter |
| `overflow: hidden` letter masks | GAP: no element masks; opacity approximates |
| a string rebuilt per frame (`Scramble`, a counter) | `onFrame` writes `ctx.elements.get(id).props.content`; the element sized by the full words first |
| `<Img src={staticFile('x.png')}>` | an `image` element; the file uploaded (`vos asset push x.png`) and its url in `data` |
| `<Audio src={staticFile('s.mp3')} />` | `doc.json` `audio: [{ key: 's.mp3', start, in, out, duration, gain, fadeIn, fadeOut }]` |
| `<Video>` / `<OffthreadVideo>` | a `video` element, windowed by opacity; a source in-point is not supported yet |
| `@remotion/google-fonts` `loadFont()` | `fonts: [{ family, weight, url }]` from `https://vos.so/api/fonts`; a face the catalog lacks is substituted and said |
| `@remotion/noise` `noise3D`, SVG `feTurbulence` grain | the painter, with `content.refs.lib.noise2D/noise3D(seed, …)` (cli 0.56+: seeded simplex, the character of `@remotion/noise`, not its values, so match by eye), reading its seed and amounts from `data` |
| `mixBlendMode` | GAP: the painter |
| an inline `<svg>` shape | an `svg` element (`src` is the markup); its colours are static, so a shape colour that must be a knob is painted |
| a solid background | `ctx.scene.background = new ctx.THREE.Color(ctx.data.ink)` in `createContent`, `.set(ctx.data.ink)` in `onFrame` |

Two traps specific to Remotion sources:

- A side-effect-only font import can be tree-shaken by the project's
  `sideEffects` field, so the SOURCE render may already be in a fallback
  face. Compare the source render's headline width against the declared
  face before blaming the port.
- `durationInFrames` counts frames, and `interpolate` ranges are frames:
  convert every number once, in `data.t`, and never mix frames and seconds
  inside a function.
