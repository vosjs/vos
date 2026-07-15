import { defineConfig } from 'tsup'

/**
 * Build config for @vosjs/cli. Two entries: the executable (`vos` bin) and the
 * library surface (render/still as functions, for programmatic use and future
 * MCP wrappers). Node-only — the browser work happens inside pages generated
 * by @vosjs/core's render template.
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
})
