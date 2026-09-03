# @vosjs/cli

## 0.13.0

### Minor Changes

- d4b1f0f: `vos record` and `vos create` read the hosted recording cap live from the platform's public `GET /api/limits` before a take (the caller's own plan when a key resolves), so a change on the platform reaches the next take without a release. The built-in 30 minutes is the offline fallback, said in words when it applies; `--max-duration` overrides either.

## 0.12.0

### Minor Changes

- baaa9c8: `vos record` states the hosted recording cap from its own constant (`--max-duration` still overrides it); the plan table it used to read left `@vosjs/shared`. `vos digest` reports `tokensEstimate` (the old `tokensEstimateClaude` name stays in the JSON for one minor).

### Patch Changes

- Updated dependencies [baaa9c8]
- Updated dependencies [baaa9c8]
  - @vosjs/shared@0.4.0
  - @vosjs/studio-core@0.4.0

## 0.11.1

### Patch Changes

- Updated dependencies [7b25557]
- Updated dependencies [7b25557]
  - @vosjs/render-core@0.2.0
  - @vosjs/shared@0.3.0
  - @vosjs/studio-core@0.3.1

## 0.11.0

### Minor Changes

- 007529f: The backdrop a new take opens on is the host's pick, not the document model's. `@vosjs/studio-core` keeps the mechanism only: `withBackdrop(frame, backdrop)` and `backdropMedia(backdrop)` write a loop and its ground onto a frame, `BASE_FRAME_STYLE` is exported as the frame with no backdrop, `DEFAULT_FRAME_STYLE` is that bare frame, and `projectFromArtifact(artifact, url, { frame })` opens a take on whatever frame the host hands it (the browser bar is still derived from the footage). `DEFAULT_BACKDROP`, `BACKDROP_DEFAULT_ON`, `defaultBackdropMedia` and `withDefaultBackdrop` are removed. The stub compositor tests build on `BASE_FRAME_STYLE`.

  `vos record`, `vos create` and `vos plan` open a fresh take on the platform's house backdrop: the first ready loop of `GET /api/backdrops` (the set the studio publishes), with its poster, period and ground. `--background <slug|url|none>` picks another or none; when the set cannot be read the take opens on the bare frame and the command says so. A `--style` or `--reuse` reference's frame still wins.

### Patch Changes

- Updated dependencies [007529f]
  - @vosjs/studio-core@0.3.0

## 0.10.1

### Patch Changes

- Updated dependencies [a3ab9f8]
  - @vosjs/shared@0.2.0
  - @vosjs/studio-core@0.2.1

## 0.10.0

### Minor Changes

- 14799a9: A deleted planner proposal stays deleted. `doc.rejected` records the lane and the source extent of an `auto` zoom, tilt or speed span that was removed (its step anchor along with it), and every re-plan drops a fresh proposal that lands on it: `vos plan`, `plan --reuse` (which re-times the rejections onto the new footage the way it re-times manual spans) and the studio's re-plans through the new `isRejected` / `withoutRejected` / `rejectSpan` helpers. `vos validate` lints the list; `schema/doc.schema.json` documents it.

### Patch Changes

- Updated dependencies [14799a9]
  - @vosjs/studio-core@0.2.0

## 0.9.2

### Patch Changes

- e2f6b24: A type step takes `focus: false`, and a converted `press Enter` uses it, so the keystroke that submits a field no longer clicks it a second time and rings a click effect on empty space beside the text.

## 0.9.1

### Patch Changes

- e9c403c: The library surface exports the take server (`startTakeServer`, `waitForPageDone`, the `TakeServer` type) and `RECORDING_NAME`, so a script that serves a take directory to a render page the way `vos open` does no longer needs the package's internals.

## 0.9.0

### Minor Changes

- 62ac21e: One package, every verb. The take pipeline and the vos.so verbs that shipped as `@vosso/vos-plugin` (record, plan, digest, frames, deliver, brand, validate, actions, open, fetch, push, pull, login, duplicate, folder, asset, recipe) now live inside `@vosjs/cli`: `npm i -D @vosjs/cli` is the whole install, `vos help` lists them under the engine verbs, and the delegate-on-unknown seam, the plugin manifest handshake and the "install the plugin" error path are gone. The three libraries under them publish as `@vosjs/studio-core`, `@vosjs/render-core` and `@vosjs/shared`. `@vosso/vos-plugin` ships once more as a forwarding shim that says so.

## 0.8.5

### Patch Changes

- f17ca0f: `vos still` refuses a `.png`/`.jpg` output name in words: the capture template writes WebP, and a still named `.png` shipped WebP bytes under a lying extension, which stores refuse as a mislabelled image.

## 0.8.4

### Patch Changes

- Updated dependencies [f02a80f]
  - @vosjs/core@0.23.0
  - @vosjs/tween@0.8.1

## 0.8.3

### Patch Changes

- Updated dependencies [d621857]
- Updated dependencies [d621857]
  - @vosjs/core@0.22.0
  - @vosjs/elements@0.8.0
  - @vosjs/tween@0.8.0

## 0.8.2

### Patch Changes

- Updated dependencies [a165ecb]
- Updated dependencies [cf84b4c]
- Updated dependencies [ab92044]
  - @vosjs/core@0.21.0
  - @vosjs/elements@0.7.1

## 0.8.1

### Patch Changes

- 8b601ec: `VosConfigJson` requires `version` again, and authoring gets its own type.

  The canonical shape is the one that gets stored, served and read back later,
  and it always carries a version. Typing the field optional described the
  exception (a config being written and played right now) as though it were the
  rule, and told every TypeScript author the field was theirs to skip.

  - `VosConfigJson.version` and `VosConfig.version` are required.
  - `AuthoredVosConfigJson` is the new authoring shape: the canonical one with
    `version` optional. `compileVosConfig` takes it, because playing a config is
    transient and watched.
  - `migrateConfig` is the bridge, and its overloads say so: an authored config
    in, a canonical one out. Untrusted JSON in returns untrusted JSON with a
    guaranteed `version` and no claim about the rest.
  - `vosConfigJsonSchema` requires `version` again. Every caller already migrates
    before parsing, so the schema describes the canonical shape and
    `migrateConfig` is the single tolerant door.

- Updated dependencies [8b601ec]
  - @vosjs/core@0.20.0

## 0.8.0

### Minor Changes

- 880b4ee: Config version 2 is the floor. The v1 migration is removed.

  The engine was never public at v1: `migrations.ts` arrived in the first public
  commit already reading `CURRENT_CONFIG_VERSION = 2`, so no config outside
  vos.so was ever authored against v1, and the last v1 artifact there has been
  carried forward.

  - `migrateConfig` refuses a v1 config (`No migration from config version 1 to
2.`) instead of migrating it. The migration map is empty but kept: a future
    v2 to v3 registers there and the loop runs it unchanged.
  - `vos check` reports a v1 config as an error, and now warns when a config
    declares no version at all: it plays locally, but a host that stores configs
    refuses it.

### Patch Changes

- Updated dependencies [1d29a86]
- Updated dependencies [880b4ee]
  - @vosjs/core@0.19.0

## 0.7.1

### Patch Changes

- Updated dependencies [26e8d41]
  - @vosjs/core@0.18.0

## 0.7.0

### Minor Changes

- 2543f59: The CLI is now engine-only: `render` / `still` / `info` / `check` / `preview` / `versions`, local and account-free. The platform verbs (`fetch` / `push` / `pull`) moved to the vos plugin (`@vosso/vos-plugin`, npm), next to the service they talk to — installed plugin verbs surface through `vos <verb>` exactly as before via a new delegate-on-unknown seam, appear in `vos help` through the plugin's manifest, and get a version row in `vos versions`. Existing installs keep working: the earlier plugin package names still resolve as fallbacks, and `vos voila <verb>` remains a hidden alias.

## 0.6.4

### Patch Changes

- Updated dependencies [beb07a0]
  - @vosjs/core@0.17.0
  - @vosjs/elements@0.7.0

## 0.6.3

### Patch Changes

- Updated dependencies [0fb1305]
  - @vosjs/core@0.16.0

## 0.6.2

### Patch Changes

- Updated dependencies [77fa2c8]
  - @vosjs/elements@0.6.0
  - @vosjs/core@0.15.0

## 0.6.1

### Patch Changes

- Updated dependencies [f49ab19]
  - @vosjs/elements@0.5.0
  - @vosjs/core@0.14.0

## 0.6.0

### Minor Changes

- c1bddb3: `config.fonts` — webfonts as first-class config. Declare faces as `fonts: [{ family, url, weight?, style? }]` and the compiled template registers them via the FontFace API and AWAITS them (capped 4s, fail-open) before scene setup and element rendering, so canvas text rasterizes with the real face in preview and in every capture path, including per-chunk fresh pages. Headless render environments have near-zero system fonts, so any non-generic family a text element uses should carry a declaration — the new `lintVosFonts` (exported from `@vosjs/core/lint`, wired into `vos check` as the `fonts` source) warns on undeclared families. Schema keeps the block passthrough (nothing stripped); a declaration without a `url` is rejected.

### Patch Changes

- Updated dependencies [c1bddb3]
  - @vosjs/core@0.13.0

## 0.5.2

### Patch Changes

- Updated dependencies [27264cf]
  - @vosjs/elements@0.4.0
  - @vosjs/core@0.12.0

## 0.5.1

### Patch Changes

- Updated dependencies [25d1d7d]
  - @vosjs/core@0.11.0

## 0.5.0

### Minor Changes

- 9c8b074: `vos pull` — the other half of the iteration loop: fetch the attributed, typed changelog of what changed on vos.so since your base (versions with origin/label/note + semantic summaries + the protected human-edited node set), sync `config.json` to the head (previous copy kept as `config.backup.json`), and repoint the tracked base. `vos push` now tracks its base automatically through `meta.json`, accepts `--label` and `--overrides`, distinguishes stale-base from protected-node 409s, and — like `pull` — delegates take directories to the take pipeline.

## 0.4.0

### Minor Changes

- 61a0e2a: Platform verbs: `vos fetch` (pull a program's config + metadata from vos.so, params preserved), `vos check` (local validation: migrate → schema → syntax → compile → determinism/dialect lints), and `vos push` (create a private remix with lineage, or iterate an existing vos with `--vos`, forwarding `--base`/`--note`). Credentials resolve from `VOS_API_KEY` or `~/.config/vos/credentials` and are never printed; `VOS_ORIGIN` overrides the platform origin.

## 0.3.0

### Minor Changes

- 51b6119: The take pipeline's verbs are promoted to the top level: `vos create / record / plan / frames / open / validate` delegate to the separately installed `@vosso/cli` (previously `@vosso/voila-cli`, which remains an install fallback), and `vos render` is now polymorphic — a take directory (recognized by its `doc.json`) renders through the take pipeline, anything else renders as an engine config. `vos voila <verb>` keeps working as a hidden alias and prints a one-line pointer at the new spelling. The `vos orbit` and `vos riff` stubs are removed: both are unknown commands again (3D showcase renders as a plain vos config; the remix contract stays at vos.so/llms-remix.txt).

## 0.2.2

### Patch Changes

- 76d4f17: Remove the `vos orbit` stub: 3D showcase is part of riff (a showcase program is a plain riff program), so the pointer to the working 3D path — drop a GLB at vos.so/riff, or remix a program from the 3D shelf — now lives in the `vos riff` stub. `vos orbit` is an unknown command again.

## 0.2.1

### Patch Changes

- d6c48db: The `vos orbit` stub now points at what actually works: the 3D showcase programs in the vos.so catalog (params + the documented buildProduct() swap point), the HTTP remix contract, and local `vos render`.

## 0.2.0

### Minor Changes

- 32e0732: Reserve the `vos riff` and `vos orbit` product namespaces. Both are honest stubs for now: they print what works today (riff's HTTP remix contract at vos.so/llms-remix.txt, `vos render` for 3D configs) and exit non-zero so scripts and agents never mistake a stub for a successful run.

## 0.1.3

### Patch Changes

- Updated dependencies [b7b0e7d]
  - @vosjs/core@0.10.0

## 0.1.2

### Patch Changes

- Updated dependencies [32a69a9]
  - @vosjs/core@0.9.0

## 0.1.1

### Patch Changes

- Updated dependencies [c6c5075]
  - @vosjs/core@0.8.0
