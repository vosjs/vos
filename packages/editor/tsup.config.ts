import { defineConfig } from 'tsup'

/**
 * Build config for @vosjs/editor. immer is a runtime dependency and
 * @vosjs/core a peer (types for the bridge protocol) — both stay external.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['immer', '@vosjs/core'],
})
