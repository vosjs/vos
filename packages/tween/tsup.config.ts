import { defineConfig } from 'tsup'

/**
 * Build config for @vosjs/tween. The recorder + extractor are pure logic; the only
 * dependency is @vosjs/timeline's value types (bundled by consumers). No runtime
 * GSAP dependency — a backend is injected by the caller when live delegation is
 * wanted, and is unused for host-side extraction.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
})
