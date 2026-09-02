# The mirrored packages

Four packages in this repo are a **read-only mirror** of the same directories in vosso's private monorepo, synced at every plugin release:

- `packages/vos-plugin` (`@vosso/vos-plugin`, published to npm from vosso)
- `packages/studio-core`, `packages/render-core`, `packages/shared` (private, bundled into the plugin at build)

They are MIT, like everything else here. What the mirror means today:

- **Issues are welcome here.** Bugs, asks and questions about the take pipeline, the planner, `vos deliver`, the schemas: open them on this repo.
- **Pull requests against these four directories are ported, not merged in place.** The next sync would overwrite an in-place merge, so a maintainer applies the change in the source of truth and it comes back with the next sync, with your authorship credited in the commit. Every other package in this repo takes pull requests directly.
- **Publishing stays with vosso for now.** Changesets ignores `@vosso/vos-plugin` here; the version on npm is the one vosso's release workflow publishes.

The source of truth moves into this repo the day the first outside contribution to these packages lands, at which point this file goes away and the four packages join changesets like the rest.
