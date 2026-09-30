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
(`node intro-port.mjs` writes one beside it).

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
   and moves.
4. **Motion is the timeline.** `createTimeline` holds the tweens, on
   `ctx.elements.get(id).props` (whole) or `.segments` (`split: { type:
   'chars' | 'words' | 'lines' }` units), in the GSAP dialect. Keep curves
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
   https://vos.so/api/fonts`). A face the catalog lacks is SUBSTITUTED and
   the substitution is said in the push note.

## The coordinates, measured (these cost the reference port three rounds)

- **`props.x` / `props.y` are RENDER pixels, centre-relative, and `y` grows
  DOWN**, like CSS `translateY`. A source offset in design pixels (a
  1080-high frame) is scaled: `const k = ctx.resolution.height / 1080`,
  then `{ y: y0 + 190 * k }`. An unscaled offset looks right at 1080p and
  doubles at 540p. Render at two sizes to catch one.
- **`rotation` is degrees, counter-clockwise**: CSS `rotate(12deg)` is
  `rotation: -12`.
- **A static offset goes in the config**, `transform: { translateX,
  translateY }` in design pixels, never a `tl.set` on `props.x/y`, for any
  text whose content or colour changes live: every re-raster lays the
  element out again from its config and drops a tweened position.
- **Bind a live text to its full words.** Text that `onFrame` writes each
  frame (a scramble, a counter) starts as `{ "$data": "subtitle" }`, never
  `' '`: a still capture (and so the vos.so thumbnail) misses what `onFrame`
  writes, and then shows the bound words instead of nothing.
- **Transform origin is the centre.** Remotion's `transformOrigin: 'right
  center'` with `scaleX` becomes a centre scale plus an `x` tween that keeps
  the right edge still: `{ scaleX: 0, x: x0 + (width / 2) * k }`.

## The mapping

- Remotion: `references/remotion.md`.
- HyperFrames: `references/hyperframes.md`.
- A hand-rolled page (a single HTML file, its own canvas engine): read it as
  source with the same tables. What the page draws with DOM becomes
  elements; what it paints in a canvas is a painter, kept to the procedural
  parts.

## The procedure

1. **Inventory before writing.** From the source: size, fps, duration;
   scenes and their frame windows; every visible string; every colour (CSS
   custom properties, theme constants); fonts; media and audio files; the
   variables or `defaultProps` (they become params). Write them into `data`
   first. This IS the port's contract.
2. **Get the source's own render.** Remotion: `npx remotion render <id>
   out/source.mp4`. HyperFrames: `npx hyperframes render`. It is the
   reference every check compares against.
3. **Scaffold** a `build.mjs` from `references/intro-port.mjs`: real
   functions stringified, a template-literal guard, `data`, `params`,
   `fonts`, one element per string and shape, a label per scene.
4. **Translate scene by scene** with the tables. One scene, then check it,
   then the next.
5. **Check** after every scene:

   ```bash
   node build.mjs && vos check config.json
   vos still config.json v.png --times 0.5,1,2 --width 1920 --height 1080
   ffmpeg -ss 1 -i out/source.mp4 -frames:v 1 r-1.png
   ffmpeg -i r-1.png -i v-1.00s.png -filter_complex "[0:v][1:v]ssim" -f null -   # SSIM
   ffmpeg -i r-1.png -i v-1.00s.png -filter_complex hstack side.png            # LOOK at it
   vos render config.json small.mp4 --width 960 --height 540                  # the scale check
   ```

   A number does not catch a missing element: look at every side-by-side.
   Stills are for layout; text that `onFrame` writes shows in `vos render`
   output, not in `vos still` (a known capture gap), so check it in a
   rendered frame.
6. **Knob honesty**: one `--set data.<key>=<value>` still per param.
7. **Push** with the score: `vos push config.json --folder <slug> --label
   "port of <source>" --note "<what was substituted, what is a painter>"
   --wait`, and hand over the watch and studio links.

## The honest gaps (say them in the push note)

These have no element equivalent today; each becomes a painter item or a
stated approximation:

| Source | In vos today |
| --- | --- |
| `overflow: hidden` masks, `clip-path` reveals | no element masks: approximate with opacity, or paint the item |
| a colour per split unit (`charStyle` making one letter red) | segments carry x/y/opacity/scale/rotation only: a separate element, or paint it |
| `mixBlendMode` | no blend modes on elements: paint it |
| a shape's colour as a knob | an svg's colours are compiled in (static `colors`): paint the shape if its colour must change live |
| `spring()` | no spring ease in the dialect: a `back.out(n)` of the same shape, checked by eye |
| `@remotion/noise`, SVG `feTurbulence` | the painter |
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
