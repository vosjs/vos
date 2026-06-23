# Contributing to Vos

Thanks for your interest in improving Vos! This guide covers the basics.

## Development setup

Requires [Node.js](https://nodejs.org) >= 18 and [pnpm](https://pnpm.io) 9.

```bash
git clone https://github.com/vosjs/vos.git
cd vos
pnpm install
pnpm build
pnpm test
```

## Project layout

- `packages/core` — `@vosjs/core`, the engine (compiler, schema, runtime, addons, types).
- `packages/elements` — `@vosjs/elements`, the overlay element system.

The core is intentionally **pure** — no DOM/browser globals — so it can run in the browser, Node, and Workers. Please keep browser-only code out of `@vosjs/core`.

## Making a change

1. Create a branch off `main`.
2. Make your change. Keep the existing code style (no semicolons, single quotes, trailing commas — enforced by Prettier).
3. Run `pnpm typecheck && pnpm lint && pnpm test`.
4. Add a changeset describing your change:
   ```bash
   pnpm changeset
   ```
   Choose the affected packages and a semver bump (patch / minor / major), write a short summary, and commit the generated `.changeset/*.md` file with your PR.
5. Open a pull request.

## Commit / PR conventions

- Keep PRs focused and reviewable.
- Reference any related issue.
- CI must pass (typecheck, lint, test, build).

## Releasing (maintainers)

Merging PRs with changesets accumulates a "Version Packages" PR. Merging that PR publishes the updated packages to npm with provenance via GitHub Actions.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
