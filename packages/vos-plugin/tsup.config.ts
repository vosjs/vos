import { defineConfig } from 'tsup'

/**
 * Build config for @vosso/vos-plugin. `@vosso/studio-core` and
 * `@vosso/render-core` are private, in-source workspace packages — they get
 * BUNDLED into dist (noExternal) so the published plugin is self-contained;
 * the public @vosjs/* packages and mediabunny stay external runtime deps.
 * dist/cli.js has no npm bin entry (verbs surface through `vos`) but stays
 * built for in-repo automation: node packages/vos-plugin/dist/cli.js
 */
export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  target: 'es2022',
  platform: 'node',
  banner: { js: '#!/usr/bin/env node' },
  noExternal: ['@vosso/studio-core', '@vosso/render-core', '@vosso/shared'],
})
