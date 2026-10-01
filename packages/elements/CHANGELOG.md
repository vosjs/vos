# @vosjs/elements

## 0.10.0

### Minor Changes

- a87b795: A split text element's `props` move the WORD. They were built on the first unit's mesh, so `props.x`, `opacity`, `scale` and `rotation` moved, faded and turned one letter while the rest stood still, and a program had to move every letter by hand. They are now the word's group: `x`/`y`/`z` offset every unit, `opacity` multiplies each unit's own, `scale` and `rotation` scale and turn the word about its centre (`rotationX`/`rotationY` add to each unit's own), and `zIndex` reorders the units together. Each unit's `segments` props still animate the letter, composed under the word's, so letters can rise one by one while the word drifts. A data edit that rebuilds the units keeps the offset the timeline gave the word. A drag in the studio moves the whole word. Elements that are not split are unchanged.

## 0.9.0

### Minor Changes

- 0a4f08d: A split text element bound to data follows a data edit. `content`, `font.family` and `font.color` bound with `{ $data }` on a `split` element used to resolve once at boot, so a knob on a per-letter word changed nothing until a reload. The element now rebuilds its units from the new values (`segments` and `props` are replaced), the new `takeStructural(elements)` on the element system reports it, and the compiled `setData` rebuilds content and timeline so the per-letter tweens run over the new letters, whatever rung the program would otherwise take. A program compiled before this still shows the new word, unanimated, until its next compile.

## 0.8.3

### Patch Changes

- e541410: Text written in a frame is in that frame. A text element's raster writes (`props.content`, `color`, font and stroke props) were applied on a microtask after the frame had drawn, so text written in `onFrame` landed one frame late in every export and showed the previous words in every still. The compiled frame now flushes each element's queued raster (`ElementInstance.flushRaster`) after `onFrame` and the stack, before it draws; the microtask stays as the fallback for a write outside a frame. A stored program gains it the next time it compiles.

  A re-raster keeps the offset a tween or a drag added to `props.x` / `props.y`, moving the element to its new layout plus that offset, instead of snapping it back to the config position.

  `ElementProps` states its units: `x` and `y` are render pixels from the frame centre with y down, `rotation` degrees counter-clockwise.

## 0.8.2

### Patch Changes

- be30d7c: Element colours render as authored. Text, svg and image element textures are now marked sRGB; without it the renderer treated their pixels as linear and encoded them again, so every element colour came out lighter (`#FF4D2E` rendered as `#FF9576`). Programs render darker and more saturated than before, which is the colour their authors wrote. The CLI ships the 0.7.1 skills catalog, with `vos-port`.

## 0.8.1

### Patch Changes

- 598cec7: READMEs rewritten against the current API: every example compiles against the exported signatures, each package lists its real exports, and stale package names and moved modules are gone.

## 0.8.0

### Minor Changes

- d621857: `renderAudio`: the sound a program plays, rendered offline.

  `@vosjs/core/audio` exports `renderAudio(config, { duration?, sampleRate?, channels?, decode? })`, which samples the program's audio schedule with the same pure tween sampler live playback uses (`props.playing`, `props.currentTime`, `props.gain` on every `AudioElement`, through `retime`) and mixes the decoded sources into plain PCM (`{ sampleRate, length, channels: Float32Array[] }`). No DOM, no pixels: the decoder is injectable (`fetch` + Web Audio's `decodeAudioData` by default where a context exists), so it runs in a Worker or in Node as well as a page, and `toAudioBuffer` wraps the result for a Web Audio consumer. `planAudio` (the schedule as points) and `mixAudio` (the sample-exact mixer) are its two halves, exported for consumers that inspect a schedule or bring their own sources. Every vos author with an `AudioElement` used to get silence in every export.

  `AudioElement.gainEnvelope`: `[t, gain]` points over OUTPUT time, linear between them, held flat outside, multiplied with `props.gain`. Fades, ducking and a bed that swells under a title as data. Live playback follows it frame by frame: the render loop now publishes `window.__vos__.outputTime` and runs `window.__vos__.frameCallbacks` once per frame on programs with elements, and a media element with an envelope registers there. Programs without elements compile exactly as before.

## 0.7.1

### Patch Changes

- a165ecb: Bridge protocol 6: `SET_MUTED` and `OBJECT_BOUNDS`.

  `SET_MUTED { muted }` mutes or unmutes every media element of the instance (video and audio) without touching their gain or the transport, and survives a warm `LOAD`: `window.__vos__.setGlobalMuted` sits beside `setGlobalPaused`, and the media props proxy applies `element.muted = own || global` on creation and on every global callback. A compare pane, a muted preview, a second player on one page.

  `OBJECT_BOUNDS { id }` (editor mode) answers `OBJECT_RECT` with a declarative object's world bounding box projected through the main camera into viewport CSS px — the sibling of `GET_ELEMENT_RECTS` for the 3D scene, so a host can draw a transform box around a prop.

## 0.7.0

### Minor Changes

- beb07a0: Data-carried webfonts. `data.fonts` accepts the same `{family, url,
weight?, style?}` entries as `config.fonts`, registered through one
  dedup'd registrar: boot faces (both sources) are awaited before first
  render (capped, fail-open); faces arriving via `setData` load lazily and
  re-raster text elements when they land, so the real face replaces the
  fallback without a recompile — font swaps become pure data edits. New
  element-system API: `rerasterAll(elementMap)` plus per-instance
  `refreshRaster()` (re-draw with unchanged values).

## 0.6.0

### Minor Changes

- 77fa2c8: `{$data: key}` bindings for text element props. `content`, `font.family` and
  `font.color` may now be a `{$data: 'key'}` reference: the value resolves from
  the host's data object at render time and re-resolves on `setData`, so a
  bound headline or font swap is a pure data edit — the element re-rasters in
  place with no re-init. Bindings live in the elements config (part of the
  compiled program), so hosts classify bound-value changes as SET_DATA by
  construction. Split text resolves bindings at boot only (per-unit meshes and
  timeline segment bindings make live content changes structural); every fresh
  boot — export, server render, preview — resolves correctly. New element
  system API: `updateData(elementMap, data)` plus per-instance `updateData`,
  wired from the compiled module's `setData`.

## 0.5.0

### Minor Changes

- f49ab19: Live text editing. `ElementInstance.setContent` is real (previously a warn stub): non-split text elements re-measure, re-raster and swap geometry/texture IN PLACE — the mesh keeps its identity, so scene membership, render order and timeline bindings stay valid — then reposition to config truth. The props proxy gains raster-prop setters (`content`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `letterSpacing`, `color`, `strokeColor`, `strokeWidth`), coalesced on a microtask so a burst of writes re-rasters once. Bridge protocol bumps to 4: `SET_ELEMENT_PROPS` values may now be strings, enabling live content/color/family previews from editors. `@vosjs/editor` adds the matching durable commits, `setTextContentRecipe` and `setTextStyleRecipe` (font fields + stroke, null stroke removes). Split text stays structural (one mesh per unit); `setContent` on a split element warns and defers to a reload.

## 0.4.0

### Minor Changes

- 27264cf: Resolution-true text and SVG rasterization. Canvas-backed element textures are now rasterized at the drawing-buffer texel density instead of 1080p design pixels, so a 4K export gets a 4K raster (and hi-DPR previews stop magnifying soft textures); plane geometry stays in design units so layout is unchanged. Text textures gain mipmaps and anisotropy (no more shimmer under minification), `font.letterSpacing` actually draws (native `ctx.letterSpacing`, with a per-grapheme fallback on older engines), line boxes use real font metrics so descenders never clip, and split text is fixed: `lines` stacks vertically instead of collapsing onto one row, `words` keeps real whitespace advances, `chars` segments by grapheme cluster (emoji-safe), and `font.align`/`font.lineHeight` are honored. Element instances and the `createVosElements` factory expose `updateResolution(...)`, and the compiled template's resize handler re-rasterizes canvas-backed textures (with hysteresis) when the buffer size changes. The compiled template also forwards `maxAnisotropy`/`maxTextureSize` GPU capabilities, and oversized rasters clamp to the texture budget. `vosConfigJsonSchema` gains a real (passthrough, non-stripping) schema for text elements with a permissive fallback.

## 0.3.1

### Patch Changes

- 0a4a6e4: Improve npm discoverability metadata: query-matched descriptions, expanded keywords, and homepage pointing at vos.so/engine. No code changes.

## 0.3.0

### Minor Changes

- 9e2f189: feat: audio element — `{ type: 'audio', src, gain?, loop?, startTime? }` plays a sound file synced to the master clock. Drive it like an html5 video (set `playing`, animate `currentTime` in createTimeline); playback honors the global pause/seek transport state, and the new animatable `gain` element prop (0-1) maps to volume for fades. Audio elements render no pixels: they carry an invisible mesh, are skipped by editor hit-testing, and report `visible: false` in element rects. Audio files participate in asset preloading (fetched to a blob URL and cached like video).

## 0.2.1

### Patch Changes

- 7d265b8: Harden frame-accurate video: graceful fallback + robust demux.

  - When the WebCodecs path fails (non-MP4 container, unsupported codec, decode
    error), the video element now falls back to the HTMLVideoElement path instead
    of throwing — a black/failed video is never an acceptable outcome. Applies to
    both `frameSource: 'auto'` and `'webcodecs'`.
  - mp4box demux now settles on the track's sample count (or shortly after flush)
    instead of a single microtask, fixing spurious "no samples extracted" when
    mp4box delivers samples across tasks.

## 0.2.0

### Minor Changes

- 2431af7: Add a frame-accurate video source (WebCodecs + mp4box).

  Video elements gain an optional `frameSource: 'auto' | 'webcodecs' | 'html5'`. The
  `webcodecs` path decodes the **exact** frame at the requested presentation time via
  `VideoDecoder` + mp4box (decode-order GOP decode, output selected by PTS — correct
  for B-frames) and draws it to a `CanvasTexture`, replacing `HTMLVideoElement.currentTime`
  sync, which is not frame-accurate. This makes deterministic export/scrub of recorded
  video possible.

  `waitForVideosReady()` is now real: elements register their in-flight decode via
  `window.__vos__.registerDecode`, and the export/scrub loop awaits the exact frame before
  capturing. The legacy `html5` path is unchanged and remains the default. mp4box is loaded
  from esm.sh at runtime (keeps the injectable elements bundle lean). Requires a secure
  context with WebCodecs; `auto` falls back to `html5` when unavailable.
