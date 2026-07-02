import { defineConfig } from 'tsup'

/**
 * Build config for @vosjs/timeline. Zero runtime dependencies — the package is
 * pure math. The injectable runtime string (dist/bundle.js) is produced by
 * bundle.mjs after this build, mirroring @vosjs/elements.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
})
