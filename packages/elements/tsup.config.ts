import { defineConfig } from 'tsup'

/**
 * Builds the typed ESM API of the element system (the `.` export) and the
 * pure styled-text modules (`./text`: runs, layout, caret; no DOM, no three).
 * The injectable IIFE string (`./bundle`) is produced separately by
 * bundle.mjs, which runs after tsup in the `build` script.
 *
 * THREE is provided at runtime via createVosElements(THREE), so `three`
 * is only a type import here and stays external.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/text/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['three'],
})
