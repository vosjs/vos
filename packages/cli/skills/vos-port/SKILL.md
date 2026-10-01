---
name: vos-port
description: Bring a video someone made in Remotion or HyperFrames (or a hand-rolled HTML/canvas animation) into vos as a program whose words, colours and timings are knobs, so it keeps changing without code and lives on vos.so with versions, a studio and free export. Use when asked to "port", "convert", "move" or "bring" a Remotion or HyperFrames project to vos or vosso, to make such a video editable, or to put one on vos.so as more than a file.
license: MIT
---

# Port a Remotion or HyperFrames video into vos

A port is a REWRITE into a vos program whose content is data. The source
keeps its look; what changes is that every word, colour and timing a person
would change becomes a value in `data` with a knob over it, so the next
change is a data edit (in the studio, or `vos push` of a patched value),
never another rewrite.

Two ways to get this wrong, both seen in real ports:

- **One canvas black box.** Painting the whole picture in one Canvas2D
  function on a fullscreen quad matches the frames and leaves the studio
  nothing to edit: every literal in the source becomes a literal in code.
- **A tabulated page.** Sampling the rendered DOM into CSS keyframes is
  faithful and dead: thousands of sampled values, not one knob.

Read `references/intro-port.mjs` first: the Remotion showreel's intro scene,
ported by these rules and checked against Remotion's own render. It is the
shape every port takes: real functions, stringified into a `config.json`
(`node intro-port.mjs` writes one beside it). Every field a config, an
element, `ctx` and an ease accept is in `references/elements-and-context.md`,
copied from the published declarations with the facts they leave out
(which props re-raster, what `vos check` says about eases): read it there,
not in `node_modules`.

## The rules (the port grammar)

1. **Content is data.** Every string, colour, number and asset a person
   might change lives in `config.data`. Function strings hold none of it.
   Timings live in data too (`data.t`), in SECONDS, converted from frames
   once (`frames / fps`).
2. **What people change is a knob.** `params` over those keys: `text` for
   words, `color` for the palette (the source's own palette first), `font`
   for faces. Prove each one moves the picture:
   `vos still config.json k.png --time <t> --set data.<key>=<value>`.
3. **Things are elements.** Text is a `text` element whose `content`,
   `font.family` and `font.color` take `{ "$data": "<key>" }` (they
   re-raster live on a data edit). Logos and shapes are `svg` or `image`
   elements, footage a `video` element. Elements are what the studio selects
   and moves. **Every visible word is a bound element**, whatever animates
   it: a word whose letters rise one by one is ONE `split` element bound to
   its key, never a pool of per-letter elements filled from `onFrame` (a
   person can retype the first in the studio and not the second).
4. **Motion is the timeline.** `createTimeline` holds the tweens, on
   `ctx.elements.get(id).props` (whole) or `.segments` (`split: { type:
   'chars' | 'words' | 'lines' }` units), in the GSAP dialect. Read
   `el.segments` inside `createTimeline` and nowhere else: a data edit to a
   bound split word rebuilds its units and the timeline over them. Keep curves
   exact: Remotion's `Easing.bezier(a, b, c, d)` is `ease: 'css-bezier(a, b,
   c, d)'`; GSAP eases keep their names.
5. **Scenes are labels.** One `tl.addLabel('<scene>', t)` per scene or
   `<Sequence>`: the studio draws them on the program's timeline.
6. **A painter only for procedural pixels.** Noise blobs, grain, a scramble,
   a counter: `onFrame(ctx)` reads `ctx.time` and `ctx.data` and draws or
   writes exactly those. Never the whole picture.
7. **Sound is a track.** The score goes in `doc.json` beside the config
   (`audio: [{ id, key: "score.ogg", name, start, in, out, duration, gain,
   fadeIn, fadeOut }]`); `vos push` uploads it and `vos render` mixes it
   (`@vosjs/cli` 0.52+). Never a `data:` URI in an audio element.
8. **Faces from the catalog.** `fonts: [{ family, weight, url }]` with
   `https://assets.vos.so/fonts/<slug>/<weight>.woff2` (`GET
   https://vos.so/api/fonts`). An italic the catalog hosts is in the
   family's `italicFiles` (`<weight>-italic.woff2`): declare it as its own
   entry with `style: 'italic'` and set `font.style: 'italic'` on the
   element. A face the catalog lacks is SUBSTITUTED and the substitution is
   said in the push note.

## The coordinates, measured (these cost the reference port three rounds)

- **`props.x` / `props.y` are RENDER pixels, centre-relative, and `y` grows
  DOWN**, like CSS `translateY`. A source offset in design pixels (a
  1080-high frame) is scaled: `const k = ctx.resolution.height / 1080`,
  then `{ y: y0 + 190 * k }`. An unscaled offset looks right at 1080p and
  doubles at 540p. Render at two sizes to catch one.
- **`rotation` is degrees, counter-clockwise**: CSS `rotate(12deg)` is
  `rotation: -12`.
- **A static offset goes in the config**, `transform: { translateX,
  translateY }` in design pixels, and motion on `props.x/y`. A re-raster
  (new words, a new colour) keeps the offset a tween added from
  `@vosjs/elements` 0.8.3; before it the element snapped back to its
  config position.
- **Text that `onFrame` writes is in its own frame** from `@vosjs/core`
  0.25.2: a scramble or a counter written into `props.content` shows in
  `vos still`, the vos.so thumbnail and every exported frame. Before it the
  text landed a frame late in video and a still showed another frame's
  words, so a program compiled earlier gains the fix on its next push.
  Still choose the program's cover (`vos push --still <t>`, cli 0.53+) at
  the moment that sells it.
- **Transform origin is the centre.** Remotion's `transformOrigin: 'right
  center'` with `scaleX` becomes a centre scale plus an `x` tween that keeps
  the right edge still: `{ scaleX: 0, x: x0 + (width / 2) * k }`.

## Layering: where a painter goes (measured)

A frame draws in this order, and a painter joins it at the place it names:

1. **The 3D scene** (`ctx.scene`, `ctx.camera`) first, `scene.background`
   under all of it. A ground or a 3D object lives here, under every element.
2. **Then the elements**, one overlay scene per distinct element `zIndex`
   (default 100), lowest first, depth cleared between them, all drawn with
   `ctx.overlayCamera`: orthographic, in RENDER pixels, centred on the frame
   (x right, y up in three.js terms).
3. **Inside an overlay scene, later wins**: element *i* of `config.elements`
   has `renderOrder = zIndex + i × 0.01` (a split unit adds `0.001` per
   unit). Order elements in the array the way the source stacks them.

A painter that must sit BETWEEN elements is a plane in `ctx.overlayScene`
(the lowest-zIndex overlay scene, so keep every element at the default
`zIndex`) with a `renderOrder` between its neighbours:

```js
// createContent: a painter over element 1 and under element 2
const T = ctx.THREE
const canvas = document.createElement('canvas')
const tex = new T.CanvasTexture(canvas)
tex.colorSpace = T.SRGBColorSpace // or every colour renders lighter
const mesh = new T.Mesh(
  new T.PlaneGeometry(1, 1),
  new T.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
)
mesh.scale.set(ctx.resolution.width, ctx.resolution.height, 1) // full frame, render px
mesh.renderOrder = 100 + 1 * 0.01 + 0.005
mesh.frustumCulled = false
ctx.overlayScene.add(mesh)
// onFrame: paint `canvas` from ctx.time and ctx.data, then tex.needsUpdate = true
```

Keep the slot numbers in `data` beside the scene table (`layers: { card:
100.015, grain: 100.995 }`), computed from element indices in the build
script, so adding an element never silently reorders a painter. A painter
over everything (grain, a vignette) takes the highest slot; a CSS blend mode
is a custom `blending` on its material, stated in the push note as an
approximation.

## The mapping

- Remotion: `references/remotion.md`.
- HyperFrames: `references/hyperframes.md`.
- The target's types (elements, `ctx`, the timeline, eases):
  `references/elements-and-context.md`.
- A hand-rolled page (a single HTML file, its own canvas engine): read it as
  source with the same tables. What the page draws with DOM becomes
  elements; what it paints in a canvas is a painter, kept to the procedural
  parts.

## The procedure

1. **Get the source's own render.** Remotion: `npx remotion render <id>
   out/source.mp4`. HyperFrames: `npx hyperframes render` (or the one in
   `renders/`). It is the reference every check compares against.
2. **Inventory before writing** (cli 0.54+): `npx vos port inventory
   <page.html|project dir>` reads the piece as a browser renders it (words,
   the palette from its custom properties, faces with their catalog match,
   media, scenes, the CSS no element can say) into `port/inventory.json`,
   with stills from its render. A HyperFrames word is laid out where it
   SETTLES in its scene. A Remotion project (cli 0.55+) is bundled with its
   own `@remotion/bundler` and read the same way, so run `npm install` in it
   first: its `<Sequence>`s are the scenes, named by what they hold, its
   colour constants name the palette, `<Audio>` is the score. Each scene's
   ground is measured, and a word animated letter by letter is one `split`
   word. On an older CLI, read a Remotion project's words in `src/`. This IS
   the port's contract.
3. **Scaffold**: `npx vos port scaffold` writes `port/program/program.mjs`
   (every word a bound element, every colour a key, the knobs, a label and a
   TODO per scene, each scene's words shown in its window, a painter only
   when the inventory needs one, and the PAINTER STARTER as
   `content.refs.lib` when the piece needs a painter or springs: Remotion's
   `spring` to the frame, `springTo` for the timeline, `interpolate`,
   `bezier`, seeded noise; never read another engine's source for these),
   `doc.json` with the score as a track, and
   `port/REPORT.md` (substituted faces, gaps). Read the report first. On an
   older CLI, scaffold from `references/intro-port.mjs` by hand.
4. **Translate scene by scene** with the tables, replacing each TODO. One
   scene, then check it, then the next.
5. **Check** after every scene:

   ```bash
   npx vos build program.mjs && npx vos check .         # real functions → config.json; refuses module-scope reads
   npx vos compare . --against ../../renders/source.mp4 # per-frame SSIM + source | vos | difference sheets
   npx vos render . small.mp4 --width 960 --height 540  # the scale check (and the score, from doc.json)
   ```

   `vos compare` exits 1 when ANY frame is under 0.95 and writes a sheet
   per frame: LOOK at them, because a number does not catch a missing
   element. Without the 0.54 CLI, the same loop is `ffmpeg -ss <t>` for the
   source frame, `vos still` for yours, and ffmpeg's `ssim` and `hstack`.
6. **Knob honesty**: one `--set data.<key>=<value>` still per param.
7. **Push** with the score: `vos push config.json --folder <slug> --label
   "port of <source>" --note "<what was substituted, what is a painter>"
   --wait`, and hand over the watch and studio links.

## The honest gaps (say them in the push note)

These have no element equivalent today; each becomes a painter item or a
stated approximation:

| Source | In vos today |
| --- | --- |
| `overflow: hidden` masks, `clip-path` reveals | no element masks: approximate a masked WORD with opacity (it stays a bound element); paint only a shape |
| a colour per split unit (`charStyle` making one letter red) | segments carry x/y/opacity/scale/rotation only: a separate element, or paint it |
| `mixBlendMode` | no blend modes on elements: paint it |
| a shape's colour as a knob | an svg's colours are compiled in (static `colors`): paint the shape if its colour must change live |
| `spring()` | no spring EASE in the dialect; the scaffold's painter starter (cli 0.56+) has `lib.springTo`, Remotion's spring on the timeline a step per frame, exact. Older: `back.out(n)`, by eye |
| `@remotion/noise`, SVG `feTurbulence` | the painter, on the starter's `lib.noise2D/noise3D` (the same character, not the same values) |
| a group transform (scale the whole scene) | no element groups: tween each element the same way |

Colours render as authored from `@vosjs/elements` 0.8.2 (older versions
drew text, svg and image elements lighter): match the source's hex values
exactly and never adjust a colour by eye.

## When not to port

A piece that is mostly procedural canvas (a hand-rolled engine painting
every frame) has few elements to give: port it as a painter with its values
in `data`, and say that its knobs are the values, not the layout. A piece
whose owner only wants it hosted can be ingested as it is: `vos ingest
render.mp4` opens a finished render bare (0.52+).
