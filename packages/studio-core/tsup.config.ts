import { defineConfig } from 'tsup'

/**
 * @vosjs/studio-core: one ESM entry with types; every dependency stays
 * external but ONE. The engine's styled-text modules (`@vosjs/elements/text`)
 * are BUILT IN: the layout this package's painter runs on the page is
 * generated from that source at build time (`richText/layoutCode.ts`), and
 * the layout a host picks and measures with must be the same build, never
 * whatever version of the engine an install resolves beside it. The package
 * stays a dependency for its TYPES alone, which the declarations import.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  noExternal: [/^@vosjs\/elements/],
  clean: true,
  sourcemap: true,
  target: 'es2022',
})
