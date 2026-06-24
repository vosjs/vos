import { defineConfig } from 'tsup'

/**
 * Build config for the publishable Vos engine.
 *
 * Each subpath export gets its own entry so consumers can import
 * `@vosjs/core/runtime`, `@vosjs/core/compiler`, etc. from compiled output.
 * three/gsap are optional peers and zod is a runtime dep — all kept external
 * (never bundled) so consumers dedupe their own copies.
 */
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/types/index.ts',
    'src/compiler/index.ts',
    'src/runtime/index.ts',
    'src/addons/index.ts',
    'src/schema/index.ts',
    'src/extract/index.ts',
    'src/lint/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // Library deps/peers are resolved by the consumer, not bundled.
  external: ['three', 'gsap', 'zod'],
})
