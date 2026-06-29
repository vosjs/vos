# @vosjs/core

> The vos engine — turn a function into deterministic, resolution-independent, mixed-media video. Compiler, schema, runtime, and addon registry.

[![npm](https://img.shields.io/npm/v/@vosjs/core.svg)](https://www.npmjs.com/package/@vosjs/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open visual operating system that powers [vosso](https://vos.so).

**A video is just inputs and a function, rendered.** `@vosjs/core` takes a JSON description of an animation — scenes, cameras, post-processing, GSAP timelines, and overlay elements — and **compiles** it into a self-contained template that renders identically every time. The core is pure (no DOM dependencies), so it runs in the browser, in Node, or in a Cloudflare Worker for server-side rendering.

## Install

```bash
pnpm add @vosjs/core three gsap
```

`three` and `gsap` are **optional peer dependencies** — you bring your own versions, and the engine never bundles them.

## Quick start

```ts
import { compileVosConfig, vosConfigJsonSchema } from '@vosjs/core'

const config = {
  version: 2,
  duration: 3,
  camera: { preset: 'perspective' },
  // functions are authored as strings, compiled into executable code
  createContent:
    '(ctx) => { const { THREE, scene } = ctx; const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(m); return { m } }',
  createTimeline:
    '(ctx, content, duration) => ctx.gsap.timeline().to(content.m.rotation, { y: Math.PI, duration })',
}

vosConfigJsonSchema.parse(config) // validate
const template = compileVosConfig(config) // → runnable template string
```

The compiled template is an HTML/JS document you can render in an iframe, capture to video, or snapshot to an image.

## Subpath exports

| Import | What it gives you |
| --- | --- |
| `@vosjs/core` | `compileVosConfig`, schemas, addon registry, types |
| `@vosjs/core/compiler` | The compiler and code generators |
| `@vosjs/core/runtime` | `generateRenderTemplate`, `transformModuleCode`, render limits |
| `@vosjs/core/schema` | Zod schemas, validators, config migrations |
| `@vosjs/core/addons` | Three.js addon / post-processing registry |
| `@vosjs/core/extract` | Config extraction from LLM/text output |
| `@vosjs/core/types` | Pure type definitions |

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
