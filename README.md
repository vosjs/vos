# vos

> The open programmatic video engine, and the `vos` CLI that turns a real product into its demo, its store listing and its social cuts. Deterministic, resolution-independent, rendered anywhere a browser runs.

[![CI](https://github.com/vosjs/vos/actions/workflows/ci.yml/badge.svg)](https://github.com/vosjs/vos/actions/workflows/ci.yml)
[![npm: @vosjs/cli](https://img.shields.io/npm/v/%40vosjs%2Fcli?label=%40vosjs%2Fcli)](https://www.npmjs.com/package/@vosjs/cli)
[![npm: @vosjs/core](https://img.shields.io/npm/v/%40vosjs%2Fcore?label=%40vosjs%2Fcore)](https://www.npmjs.com/package/@vosjs/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**A video is inputs and a function, rendered.** vos takes a JSON description of an animation (a Three.js scene, a GSAP-dialect timeline, 2D overlay elements, post-processing) and compiles it into a self-contained program that draws the same frame for the same time, every time, in a browser, in Node, or on a server. Because every frame is a pure function of time, a render can be sharded, cached, retimed and edited as data.

The same engine drives a screen-recording pipeline: the `vos` CLI scripts a browser through the real product, records it with an exact cursor track, plans zooms and pacing from that track, and renders the cut. Every editing decision lives in a JSON document, so a fix is an edit and a re-render, never a re-recording.

Everything in this repository is MIT. [vos.so](https://vos.so) is the hosted platform built on it (a studio, version history, cloud rendering); the CLI talks to it when you ask, and works without it.

## Two ways in

### Make product media

```bash
npm i -g @vosjs/cli
vos record --actions actions.json --out take --strict   # drive the page, record it, plan the zooms
vos render take out.webm                                # deterministic render; edit take/doc.json and render again
vos deliver take --to cws,producthunt,og --release v2.1 # the release's assets per channel spec, verified into kit.json
```

The workflows for coding agents (Claude Code, Codex, Cursor and friends) install with `npx skills add vosjs/skills`. The full agent contract is [vos.so/llms.txt](https://vos.so/llms.txt). See the [CLI README](./packages/cli/README.md) for every verb.

### Use the engine

```bash
pnpm add @vosjs/core three gsap
```

```ts
import { compileVosConfig, vosConfigJsonSchema } from '@vosjs/core'
import { generateRenderTemplate } from '@vosjs/core/runtime'

const config = {
  version: 2,
  duration: 3,
  camera: { preset: 'perspective' },
  scene: { background: '#000000' },
  // functions are authored as strings and compiled into executable code
  createContent:
    '(ctx) => { const { THREE, scene } = ctx; const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(m); return { objects: [m], m } }',
  createTimeline:
    '(ctx, content, duration) => ctx.gsap.timeline().to(content.m.rotation, { y: Math.PI, duration })',
}

vosConfigJsonSchema.parse(config) // validate (version, duration and camera are required)
const program = compileVosConfig(config) // an ES module string exporting initVos()
const html = generateRenderTemplate(program, { mode: 'playback' }) // the page that runs it
```

One template powers playback, frame-by-frame video capture and still capture, so what you preview is what you export. `three` and `gsap` are optional peers of the engine: you bring your own versions, and they are never bundled. The [core README](./packages/core/README.md) covers the config shape, the program stack, retiming, audio and the bridge.

## Packages

Bottom layer first. Each package's README is its reference.

| Package                                        | npm                                                                                                             | What it is                                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@vosjs/timeline`](./packages/timeline)       | [![npm](https://img.shields.io/npm/v/%40vosjs%2Ftimeline)](https://www.npmjs.com/package/@vosjs/timeline)       | Pure time math: keyframe sampling, GSAP-compatible easings, source-time remapping across trims and speed changes. No dependencies.                                          |
| [`@vosjs/tween`](./packages/tween)             | [![npm](https://img.shields.io/npm/v/%40vosjs%2Ftween)](https://www.npmjs.com/package/@vosjs/tween)             | Records a GSAP-dialect timeline into a per-target tween IR, samples it deterministically without GSAP, and retimes it live through an edit overlay.                         |
| [`@vosjs/shared`](./packages/shared)           | [![npm](https://img.shields.io/npm/v/%40vosjs%2Fshared)](https://www.npmjs.com/package/@vosjs/shared)           | The font and typeface catalogs, the remix params contract, a frontmatter parser and the timeline-edit wrapper. No dependencies.                                             |
| [`@vosjs/core`](./packages/core)               | [![npm](https://img.shields.io/npm/v/%40vosjs%2Fcore)](https://www.npmjs.com/package/@vosjs/core)               | The engine: the Zod config schema, the compiler, the render template and its bridge protocol, the addon registry, the offline audio renderer and the determinism linters.   |
| [`@vosjs/elements`](./packages/elements)       | [![npm](https://img.shields.io/npm/v/%40vosjs%2Felements)](https://www.npmjs.com/package/@vosjs/elements)       | The element system: text, image, SVG, video and audio elements rendered as Three.js overlays, shipped as a typed factory and as an injectable bundle.                       |
| [`@vosjs/editor`](./packages/editor)           | [![npm](https://img.shields.io/npm/v/%40vosjs%2Feditor)](https://www.npmjs.com/package/@vosjs/editor)           | Headless editor mechanics: a patch-based document store with undo, the live-edit classifier, the editor bridge client, element-edit recipes and timeline view-model math.   |
| [`@vosjs/studio-core`](./packages/studio-core) | [![npm](https://img.shields.io/npm/v/%40vosjs%2Fstudio-core)](https://www.npmjs.com/package/@vosjs/studio-core) | The document model of a screen recording: the `ProjectDoc` schema, the auto-zoom, speed and tilt planners, the digest, and the lowering from a document to a vos program.   |
| [`@vosjs/render-core`](./packages/render-core) | [![npm](https://img.shields.io/npm/v/%40vosjs%2Frender-core)](https://www.npmjs.com/package/@vosjs/render-core) | The render harness: sharding a timeline into parallel chunks and stream-copying the encoded chunks back into one file. Pure Node.                                           |
| [`@vosjs/cli`](./packages/cli)                 | [![npm](https://img.shields.io/npm/v/%40vosjs%2Fcli)](https://www.npmjs.com/package/@vosjs/cli)                 | The `vos` binary: render configs, record the real product, plan and cut as data, deliver a release's media per channel spec, and sync with vos.so. One package, every verb. |

The old package names `@vosso/vos-plugin`, `@vosso/cli` and `@vosso/voila-cli` are deprecated on npm; everything they held now lives in `@vosjs/cli`.

## How the pieces fit

```
                    a config (JSON)                          a recording (footage + cursor track)
                          │                                                  │
   @vosjs/core            │  vosConfigJsonSchema · compileVosConfig          │  @vosjs/studio-core
                          ▼                                                  ▼
                 an ES module program  ◀────── lowerStudioDoc ──────  ProjectDoc (doc.json)
                          │                    constant program              zoom · speed · tilt · overlays · audio
                          │                    + ctx.data                    planned from the cursor track, edited as data
                          ▼
   @vosjs/core/runtime    generateRenderTemplate → one HTML page, three modes: playback · capture-video · capture-thumbnail
                          │            ▲                          ▲
                          │   @vosjs/elements (overlay bundle)    @vosjs/tween + @vosjs/timeline (deterministic seek)
                          ▼
   @vosjs/render-core     planChunks → N browser pages → concatEncodedVideo, packet-identical to a single pass
                          │
   @vosjs/cli             render · still · record · plan · digest · frames · deliver · push · pull
```

Two rules hold the whole thing together:

- **A frame is a pure function of time.** No wall clock, no random, no stateful springs. `@vosjs/core/lint` refuses configs that break it, and `@vosjs/tween` samples a recorded timeline without GSAP present, so a server render and a browser preview agree frame for frame.
- **Editable state travels as data, never as code.** The studio lowers a document to a constant program plus a `ctx.data` payload, and the editor applies a data change to a running player with `SET_DATA` instead of a reload. A program string only changes for a structural edit.

## Documentation

- [Docs](https://vos.so/docs): guides, the CLI reference ([verbs](https://vos.so/docs/cli/verbs), [the take directory](https://vos.so/docs/cli/take-directory), [actions.json](https://vos.so/docs/cli/actions-json), [doc.json](https://vos.so/docs/cli/doc-json)), the [config reference](https://vos.so/docs/api/config) and the platform API.
- [llms.txt](https://vos.so/llms.txt) and [llms-full.txt](https://vos.so/llms-full.txt): the contracts an agent reads.
- [vosjs/skills](https://github.com/vosjs/skills): the workflows (`product-video`, `vos-cut`, `launch-kit`, and more) for coding agents.
- [vosjs/action](https://github.com/vosjs/action): the GitHub Action that runs the release-media loop on every tag.
- The JSON Schemas ship inside `@vosjs/cli`: [`doc.schema.json`](./packages/cli/schema/doc.schema.json), [`actions.schema.json`](./packages/cli/schema/actions.schema.json), [`digest.schema.json`](./packages/cli/schema/digest.schema.json) and [`channel-specs.json`](./packages/cli/schema/channel-specs.json).

## Development

A [pnpm](https://pnpm.io) 9 + [Turborepo](https://turbo.build) monorepo. Node 18, 20 and 22 are tested in CI.

```bash
pnpm install
pnpm build       # every package (the CLI depends on the built dist of the others)
pnpm typecheck
pnpm lint
pnpm test        # vitest, per package
pnpm check       # prettier
```

Each package has a `CHANGELOG.md` written by [Changesets](https://github.com/changesets/changesets). A change that should ship gets a changeset file in the same PR (`pnpm changeset`); merging accumulates a release PR, and merging that publishes to npm. [CONTRIBUTING.md](./CONTRIBUTING.md) has the details, including how to link the packages into an app while working on them.

## Status

Pre-1.0. Minor versions can change APIs; each package's changelog says what moved. The config format has a `version` field for exactly this reason: a stored config declares the engine era it was written for, and the engine refuses one it cannot resolve rather than guessing.

## License

[MIT](./LICENSE) © vosso
