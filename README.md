<p align="center">
  <a href="https://vos.so/engine">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/lockup-dark.svg">
      <img alt="vos" src=".github/assets/lockup-light.svg" height="56">
    </picture>
  </a>
</p>

<h3 align="center">Video as a program.</h3>

<p align="center">
  An open-source engine where every frame is a pure function of time.<br>
  Deterministic, resolution-independent, rendered anywhere a browser runs.
</p>

<p align="center">
  <a href="https://vos.so/engine">Website</a>
  &nbsp;·&nbsp;
  <a href="https://vos.so/docs">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://vos.so/gallery">Gallery</a>
  &nbsp;·&nbsp;
  <a href="https://vos.so/agents">For agents</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vosjs/cli"><img alt="npm" src="https://img.shields.io/npm/v/%40vosjs%2Fcli?style=flat&color=0b0b0d&label=%40vosjs%2Fcli"></a>
  <a href="https://github.com/vosjs/vos/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/vosjs/vos/ci.yml?branch=main&style=flat&color=0b0b0d&label=ci"></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-0b0b0d?style=flat"></a>
</p>

<br>

<a href="https://vos.so/vos/vos-make-video-from-a-document">
  <img alt="A JSON document compiles into a program, four layers close into one frame, and the frame takes new data." src=".github/assets/hero.webp" width="100%">
</a>

<p align="center"><sub>This film is a vos program. <a href="https://vos.so/vos/vos-make-video-from-a-document">Watch it with sound</a>.</sub></p>

<br>

## Quick start

Describe a scene as JSON. Functions are strings, so the whole video is data you can store, diff and change.

```json
{
  "version": 2,
  "duration": 3,
  "camera": { "preset": "perspective", "position": [0, 0, 4] },
  "createContent": "(ctx) => { const { THREE, scene } = ctx; const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()); m.rotation.x = 0.5; scene.add(m); return { objects: [m], m } }",
  "createTimeline": "(ctx, content, duration) => ctx.gsap.timeline().to(content.m.rotation, { y: Math.PI, duration })"
}
```

```bash
npm i -D @vosjs/cli
npx vos render scene.json scene.webm
```

Same document, same frames, on any machine. Change a number and render again.

## Record your product

The same engine cuts screen recordings. The CLI drives a browser through your real product, records it with an exact cursor track, plans the zooms from that track, and keeps every editing decision in `doc.json`.

```bash
npx vos record --actions actions.json --out take   # drive the app, record it, plan the zooms
npx vos render take demo.mp4                       # edit take/doc.json, render again
```

A fix is an edit and a re-render, never a re-recording. Or hand the whole job to your coding agent:

```text
Record a demo video of this app with vosso. The steps are at https://vos.so/agent.md. Give me the vos.so link when it's done.
```

## Use it as a library

```bash
npm i @vosjs/core three
```

```ts
import { compileVosConfig, vosConfigJsonSchema } from '@vosjs/core'
import { generateRenderTemplate } from '@vosjs/core/runtime'
import config from './scene.json' with { type: 'json' }

vosConfigJsonSchema.parse(config) // validate
const program = compileVosConfig(config) // an ES module exporting initVos()
const html = generateRenderTemplate(program, { mode: 'playback' })
```

One template serves playback, frame-by-frame capture and stills, so the preview is the export. `three` is a peer you bring. GSAP is an authoring dialect, not a dependency: `ctx.gsap` records the timeline and `@vosjs/tween` samples it without GSAP present.

## Why vos

- **Deterministic.** No wall clock, no random, no stateful springs. A server render and a browser preview agree frame for frame, so a render can be sharded, cached and retimed.
- **Data, not code.** Editable state travels in `ctx.data`. An edit reaches a running player as data, with no reload and no re-record.
- **Mixed media.** Three.js 3D, 2D elements, HTML, video and audio in one frame, at any resolution.
- **Made for agents.** Results on stdout, `--json` everywhere, and every decision in a file an agent can read and change.

## Packages

| Package                                        |                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [`@vosjs/cli`](./packages/cli)                 | The `vos` binary: render, record, plan, cut, deliver and sync.      |
| [`@vosjs/core`](./packages/core)               | The engine: config schema, compiler, render template and bridge.    |
| [`@vosjs/elements`](./packages/elements)       | Text, image, SVG, video and audio elements over Three.js.           |
| [`@vosjs/studio-core`](./packages/studio-core) | The screen-recording document: planners, digest and lowering.       |
| [`@vosjs/render-core`](./packages/render-core) | Shard a render across pages and join it back into one file.         |
| [`@vosjs/editor`](./packages/editor)           | Headless editing: a patch store with undo and the live-edit bridge. |
| [`@vosjs/tween`](./packages/tween)             | Record a GSAP-dialect timeline and sample it without GSAP.          |
| [`@vosjs/timeline`](./packages/timeline)       | Pure time math: keyframes, easings and retiming.                    |
| [`@vosjs/shared`](./packages/shared)           | Font and typeface catalogs, params and frontmatter.                 |

Each package's README is its reference.

<details>
<summary><b>How the pieces fit</b></summary>

<br>

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

</details>

## Learn more

- [Docs](https://vos.so/docs): guides, the [CLI verbs](https://vos.so/docs/cli/verbs), [`doc.json`](https://vos.so/docs/cli/doc-json), [`actions.json`](https://vos.so/docs/cli/actions-json) and the [config reference](https://vos.so/docs/api/config)
- [llms.txt](https://vos.so/llms.txt): the contract an agent reads
- [vosjs/skills](https://github.com/vosjs/skills): the workflows for coding agents
- [vosjs/action](https://github.com/vosjs/action): release media on every pull request
- [vosjs/driver](https://github.com/vosjs/driver): record a Mac app's window

## Contributing

vos is pre-1.0: a minor version can change an API, and each package's changelog says what moved. [CONTRIBUTING.md](./CONTRIBUTING.md) covers building, testing and changesets.

## License

[MIT](./LICENSE) © vosso
