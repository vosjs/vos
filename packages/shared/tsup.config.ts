import { defineConfig } from 'tsup'

/**
 * @vosjs/shared: the root plus every subpath the package.json exports map
 * names, so `@vosjs/shared/diff` resolves to `dist/diff/index.js` the way
 * the in-source workspace export resolved to `src/diff/index.ts`.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'types/index': 'src/types/index.ts',
    'utils/index': 'src/utils/index.ts',
    'diff/index': 'src/diff/index.ts',
    frontmatter: 'src/frontmatter.ts',
    params: 'src/params.ts',
    limits: 'src/limits.ts',
    acquisition: 'src/acquisition.ts',
    backdrops: 'src/backdrops.ts',
    timelineEdits: 'src/timelineEdits.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
})
