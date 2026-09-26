import { defineConfig } from 'tsup'

/** @vosjs/render-core: one ESM entry with types; mediabunny stays external. */
export default defineConfig({
  // Two entries: the render harness, and `./record` (the recorder's
  // mechanism, AN4), so a host that only records does not load the concat.
  entry: { index: 'src/index.ts', 'record/index': 'src/record/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  platform: 'node',
})
