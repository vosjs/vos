import { defineConfig } from 'tsup'

/** @vosjs/render-core: one ESM entry with types; mediabunny stays external. */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  platform: 'node',
})
