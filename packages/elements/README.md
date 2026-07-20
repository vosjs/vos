# @vosjs/elements

> The vos element system — text / image / SVG / video / audio renderers for Three.js overlays, shipped as both a typed ESM factory and an injectable IIFE bundle.

[![npm](https://img.shields.io/npm/v/@vosjs/elements.svg)](https://www.npmjs.com/package/@vosjs/elements)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open visual operating system behind [vosso](https://vos.so). Renders 2D overlay elements (text, images, SVG, video) as Three.js meshes positioned over a scene, plus non-visual audio elements synced to the master clock. `three` is an optional peer dependency and is provided at runtime (never bundled).

## Install

```bash
pnpm add @vosjs/elements three
```

## Element types

| Type | Renders as |
| --- | --- |
| `text` | A text mesh, with optional per-character `split` for staggered animation |
| `image` | An image plane (`src` loaded through the shared asset cache) |
| `svg` | A rasterized SVG plane |
| `video` | A video plane driven by the master clock |
| `audio` | A non-visual audio element, synced to the master clock (no mesh) |

## Two entry points

### `@vosjs/elements` — typed ESM factory

For app/build-time use (e.g. client-side export pipelines):

```ts
import * as THREE from 'three'
import { createVosElements } from '@vosjs/elements'

const elements = createVosElements(THREE)
const map = await elements.renderElements(elementsConfig, overlayScenes, resolution)
// ...
elements.disposeElements(map)
```

### `@vosjs/elements/bundle` — injectable IIFE string

For injecting into a sandboxed render context (the iframe/Worker that runs compiled Vos templates). The string defines a global `__vosElementsFactory`:

```ts
import { generateRenderTemplate } from '@vosjs/core/runtime'
import { elementsBundleCode } from '@vosjs/elements/bundle'

const html = generateRenderTemplate(compiledCode, {
  mode: 'playback',
  elementsBundleCode,
})
```

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
