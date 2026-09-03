import { defineConfig } from 'tsup'

/**
 * @vosjs/shared: the root plus every subpath the package.json exports map
 * names, so `@vosjs/shared/params` resolves to `dist/params.js` the way
 * the in-source workspace export resolved to `src/params.ts`.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    frontmatter: 'src/frontmatter.ts',
    params: 'src/params.ts',
    timelineEdits: 'src/timelineEdits.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
})
