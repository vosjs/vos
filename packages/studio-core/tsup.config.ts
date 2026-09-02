import { defineConfig } from 'tsup'

/** @vosjs/studio-core: one ESM entry with types; every dependency stays external. */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
})
