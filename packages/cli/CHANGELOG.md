# @vosjs/cli

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
