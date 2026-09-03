# Contributing to vos

Thanks for helping. This guide covers setup, the layout, how a change ships, and the few rules that keep the engine deterministic.

## Setup

Requires [Node.js](https://nodejs.org) 18 or newer and [pnpm](https://pnpm.io) 9 (`corepack enable` picks the pinned version from `package.json`).

```bash
git clone https://github.com/vosjs/vos.git
cd vos
pnpm install
pnpm build
pnpm test
```

`pnpm build` matters before anything else: packages resolve each other through their built `dist/`, so a fresh clone with no build fails typecheck in the packages that import a sibling.

The CLI's tests and verbs need a Chromium-family browser. A system Chrome is used when present; otherwise run `npx playwright install chromium` once, or point `VOS_BROWSER_PATH` at a binary.

## Layout

```
packages/
  timeline/     @vosjs/timeline     pure time math (keyframes, easings, source-time remap)
  tween/        @vosjs/tween        GSAP-dialect recorder, tween IR, deterministic sampler
  shared/       @vosjs/shared       font/typeface catalogs, params, frontmatter, timeline edits
  core/         @vosjs/core         schema, compiler, render template + bridge, addons, audio, lint
  elements/     @vosjs/elements     text/image/svg/video/audio overlay renderers (+ IIFE bundle)
  editor/       @vosjs/editor       patch store, edit classifier, bridge client, view-model math
  studio-core/  @vosjs/studio-core  ProjectDoc, planners, digest, lowering to a vos program
  render-core/  @vosjs/render-core  chunk planning + stream-copy concat (Node)
  cli/          @vosjs/cli          the vos binary; src/plugin/ holds the take pipeline and the vos.so verbs
```

Dependencies point downward in that list. `core` depends on `tween`; `tween` on `timeline`; `studio-core` on `editor`, `shared` and `timeline` (with `core` as a peer); `cli` on everything. `three` and `gsap` are peers, never dependencies.

Every package has the same scripts: `build` (tsup), `typecheck`, `lint`, `test` (vitest). Run one package with `pnpm --filter @vosjs/core test`.

## Rules that keep it working

- **`@vosjs/core` stays pure.** No DOM or browser globals in the engine; it runs in browsers, Node and Workers. Browser-only code belongs in the render template string, in `@vosjs/elements`, or in the CLI.
- **A frame is a pure function of time.** Nothing in a compiled program may read the wall clock, a random source or a stateful spring. `@vosjs/core/lint` encodes the rule; extend the lint when you add a new way to break it.
- **Editable state is data, not code.** The studio lowering emits a constant program and puts every editable value in `ctx.data`, which is what lets an editor apply changes live. Never bake a document value into a function string.
- **The engine carries no product.** The open packages hold what a local render or a lowering reads and what a second host would take unchanged. Anything one platform decides (quotas, wire types of a hosted endpoint, a hosted service's pages) lives in that host, not here. The one place this repo knows vos.so exists is `packages/cli/src/plugin/`, plus the asset base URL in the catalogs.
- **Keep bundles in sync with their sources.** `@vosjs/timeline`, `@vosjs/tween` and `@vosjs/elements` each ship an IIFE bundle that the render template inlines; they are built from the same sources by `bundle.mjs`, so a new export needs adding to the runtime entry to reach a running program.

## Making a change

1. Branch off `main`.
2. Make the change. Prettier owns formatting (no semicolons, single quotes, trailing commas); `pnpm check` must pass.
3. Add or extend tests. Contract invariants (geometry, byte parity, determinism) are unit tests beside the code.
4. Run `pnpm typecheck && pnpm lint && pnpm test`.
5. Add a changeset:
   ```bash
   pnpm changeset
   ```
   Pick the affected packages and a bump (patch, minor, major), write one line on what changed from a user's point of view, and commit the generated `.changeset/*.md` with your PR. A change that touches only tests or tooling needs no changeset.
6. Open a pull request. CI runs build, typecheck, lint and tests on Node 18, 20 and 22.

Keep PRs focused. Describe designs in the PR itself; a reviewer should not need any other document to follow it.

## Working on the packages from an app

Consumers that develop against a local checkout use `link:` specifiers in their `package.json` (for example `"@vosjs/core": "link:../vos/packages/core"`), run `pnpm build` here first (links resolve to `dist/`), and link the dependents too when a transitively-used package changes, so that a stale npm copy cannot win the dedupe. Revert to semver ranges before publishing the app.

## Releasing (maintainers)

Merging PRs that carry changesets accumulates a "Version Packages" pull request. Merging that PR runs `release.yml`, which builds and publishes every bumped package to npm through OIDC trusted publishing (no token is stored in the repo). Two things to know:

- A brand-new package name needs one manual `npm publish` from a logged-in terminal before OIDC can publish it, then a Trusted Publisher entry on npmjs.com pointing at this repository's `release.yml`.
- The release PR is opened by a bot token, and GitHub does not run CI on it; push an empty commit to the `changeset-release/main` branch to trigger the checks before merging.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
