# @vosjs/cli

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
