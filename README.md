# vos

> The open visual operating system — turn a function into deterministic, resolution-independent, mixed-media video, and render it anywhere.

[![CI](https://github.com/vosjs/vos/actions/workflows/ci.yml/badge.svg)](https://github.com/vosjs/vos/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**A video is just inputs and a function, rendered.** vos takes a JSON description of an animation — scenes, cameras, post-processing, GSAP timelines, and overlay elements — and **compiles** it into a self-contained template that renders identically every time, anywhere a browser can run: the browser, Node, or a Cloudflare Worker. The core is pure (no DOM dependencies), and `three` / `gsap` stay optional peers you bring yourself.

`vos` — short for **V**isual **O**perating **S**ystem, and Latin for _you_ — is the open engine. [vosso](https://vos.so) is the platform built on it: a visual operating system for generated video, where every app is _powered by vos_.

## Packages

| Package                                  | Description                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@vosjs/core`](./packages/core)         | The engine: config compiler, validation schema (Zod), runtime template generator, addon registry, and types.                                      |
| [`@vosjs/elements`](./packages/elements) | The element system: text / image / SVG / video renderers for Three.js overlays, shipped as a typed ESM factory **and** an injectable IIFE bundle. |

> `three` and `gsap` are **optional peer dependencies** — you bring your own versions, and the engine never bundles them.

## Install

```bash
pnpm add @vosjs/core three gsap
```

## Quick start

```ts
import { compileVosConfig, vosConfigJsonSchema } from '@vosjs/core'

const config = {
  version: 2,
  scene: { background: '#000' },
  camera: { type: 'perspective', position: [0, 0, 5] },
  // functions are authored as strings, compiled into executable code
  createContent: '(ctx) => { /* build your Three.js scene with ctx.THREE */ }',
}

// validate, then compile to a runnable template string
vosConfigJsonSchema.parse(config)
const template = compileVosConfig(config)
```

The compiled template is an HTML/JS document you can render in an iframe, capture to video, or snapshot to an image — the same template powers playback, export, and server rendering.

### Subpath exports (`@vosjs/core`)

| Import                 | What it gives you                                              |
| ---------------------- | -------------------------------------------------------------- |
| `@vosjs/core`          | `compileVosConfig`, schemas, addon registry, types             |
| `@vosjs/core/compiler` | The compiler and code generators                               |
| `@vosjs/core/runtime`  | `generateRenderTemplate`, `transformModuleCode`, render limits |
| `@vosjs/core/schema`   | Zod schemas, validators, config migrations                     |
| `@vosjs/core/addons`   | Three.js addon / post-processing registry                      |
| `@vosjs/core/extract`  | Config extraction from LLM/text output                         |
| `@vosjs/core/types`    | Pure type definitions                                          |

## Development

This is a [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build) monorepo.

```bash
pnpm install
pnpm build       # build all packages
pnpm typecheck
pnpm test
pnpm lint
```

Releases are managed with [Changesets](https://github.com/changesets/changesets). To propose a release, run `pnpm changeset` and commit the generated file with your PR.

## Roadmap

- **Plugin SDK** (`@vosjs/plugin-sdk`) — a unified `definePlugin()` contract so addons, element renderers, schema extensions, and codegen hooks can be contributed by third-party packages.
- **Browser adapter** (`@vosjs/web`) — a Vite-friendly dynamic addon loader whose import map is plugin-contributed.
- **CLI & scaffolding** (`@vosjs/cli`, `create-vos`).

## License

[MIT](./LICENSE) © vosso
