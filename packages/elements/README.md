# @vosjs/elements

> The vos element system: text, image, SVG, video and audio elements rendered as Three.js overlays, shipped as a typed factory and as an injectable bundle.

[![npm](https://img.shields.io/npm/v/@vosjs/elements.svg)](https://www.npmjs.com/package/@vosjs/elements)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open programmatic video engine behind [vos.so](https://vos.so). A config's `elements` array declares 2D things positioned over the scene; this package draws them as meshes in the overlay scenes and keeps the non-visual audio elements on the master clock. `three` is a peer dependency, provided at run time and never bundled.

## Install

```bash
pnpm add @vosjs/elements three
```

## Element types

| Type    | Renders as                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`  | A rasterized text mesh, resolution-true at the render size, with optional `split` (`chars`, `words`, `lines`) for staggered animation                                                               |
| `image` | An image plane, `src` loaded through the shared asset cache                                                                                                                                         |
| `svg`   | A rasterized SVG plane                                                                                                                                                                              |
| `video` | A video plane driven by the master clock                                                                                                                                                            |
| `audio` | No mesh: a sound synced to the master clock, with an optional `gainEnvelope` (`[t, gain]` points over output time) multiplied into `props.gain`; `@vosjs/core/audio` renders the same sound offline |

Element positions and sizes are in design pixels on a 1080-high frame (`DESIGN_HEIGHT`), so a program looks the same at every output resolution. Text `content`, `font.family` and `font.color` accept `{ $data: key }` bindings, resolved against the program's `data` and re-rasterized on `SET_DATA`.

## Styled text

A text element's `content` is a string, or a list of runs where parts of it are set differently. A run is a piece of text and the fields in which it departs from the element's `font`; a field left out is the element's own:

```json
{
  "type": "text",
  "content": [
    { "text": "Ship it " },
    { "text": "faster", "weight": 700, "color": "#e37358", "underline": true },
    { "text": " today", "italic": true }
  ],
  "font": { "family": "Lexend", "size": 72, "weight": 400 }
}
```

A run takes `weight`, `italic`, `color`, `underline`, `strike` and `highlight`. There is no markup in the words, a style may start and end inside a word, and a run's `text` may hold line breaks. Size, family and letter-spacing are the element's and one for the whole text.

- A run's `text` may be `{ "$data": "key" }`: a knob keeps editing plain words and the run keeps its style.
- With `split`, a unit draws the styles of the characters it holds; a word set half in bold is still one unit.
- `props.content` and `setContent` take a string or a list of runs. A string written over styled words replaces them whole.
- Declare a face in the program's `fonts` for every weight a run uses, or the browser fakes it from another weight (`lintVosText` in `@vosjs/core/lint` says so).

Plain and styled content are one layout and one painter: a string is one run a line.

## Two entry points

### `@vosjs/elements`: the typed factory

For app or build-time use, such as a client-side export pipeline:

```ts
import * as THREE from 'three'
import { createVosElements } from '@vosjs/elements'

const elements = createVosElements(THREE)
const map = await elements.renderElements(
  config.elements,
  overlayScenes, // Record<layerIndex, THREE.Scene>
  resolution, // { width, height }
  undefined, // legacy slot; the factory's THREE is used
  config.data, // resolves { $data } bindings
)
elements.updateResolution(map, nextResolution)
elements.updateData(map, nextData)
elements.disposeElements(map)
```

`createVosElements` returns `renderElements`, `disposeElements`, `updateResolution`, `updateData` and `rerasterAll`. The root also exports the text layout helpers (`layoutTextBlock`, `layoutSplitUnits`, `segmentText`, `graphemes`, `rasterScaleFor`, `clampRasterScale`, `lineMetricsFrom`, `lineWidthWithSpacing`) and the binding helpers (`extractTextBindings`, `resolveTextElement`, `resolveBoundRuns`, `isDataRef`).

### `@vosjs/elements/text`: styled text, pure

What a run is and everything done to a list of them, with no DOM and no three: a host that edits text imports this entry alone.

```ts
import {
  layoutText,
  caretStops,
  toggleStyle,
  replaceRange,
  toRichText,
} from '@vosjs/elements/text'
```

- **Runs** (`TextRun`, `RichText`): `normalizeRuns`, `plainText`, `replaceRange`, `setStyle`, `toggleStyle`, `clearStyle`, `commonStyle`, `styleAt`, `sliceRuns`, `diffInput`, and `toRichText`, the guard for text arriving from outside. Offsets are into the plain words, and a style never splits a grapheme.
- **Layout** (`layoutText`): lines of runs into visual lines, same-style fragments at measured positions, and the units a per-unit animation moves. Measurement is handed in, so a page, a host and a node test run the same function.
- **Caret** (`caretStops`, `caretAt`, `offsetAtX`, `rangeRects`): where a caret stands on what was laid out.

### `@vosjs/elements/bundle`: the injectable string

For a sandboxed render page (the iframe or headless browser that runs a compiled program). The string is an IIFE that defines a global `__vosElementsFactory`, which the render template calls with its own `THREE`:

```ts
import { generateRenderTemplate } from '@vosjs/core/runtime'
import { elementsBundleCode } from '@vosjs/elements/bundle'

const html = generateRenderTemplate(program, {
  mode: 'playback',
  elementsBundleCode,
})
```

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
