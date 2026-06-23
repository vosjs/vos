import { ADDON_REGISTRY } from '../addons/registry'

/**
 * Transform compiled vos module code for different execution targets.
 *
 * - `server`: For server-side rendering in a browser context where THREE/gsap
 *   are loaded via importmap. Strips THREE/gsap imports, converts three/addons
 *   imports to dynamic imports, wraps in async IIFE that exposes `initVos` globally.
 *
 * - `client`: For client-side export where THREE/gsap/addons are injected via
 *   `globalThis.__vos__.__export` namespace. Strips ALL imports, prepends namespace
 *   reads, appends `export { initVos }`.
 */
export function transformModuleCode(
  code: string,
  target: 'server' | 'client' = 'server',
): string {
  if (target === 'server') {
    return transformForServer(code)
  }
  return transformForClient(code)
}

/**
 * Server target: THREE/gsap available globally via importmap.
 * Three/addons imports converted to dynamic imports.
 * External package imports converted to dynamic imports.
 * Wrapped in async IIFE exposing initVos on window.
 */
function transformForServer(code: string): string {
  const transformed = code
    // Remove THREE imports (available globally)
    .replace(/import\s+\*\s+as\s+THREE\s+from\s+['"]three['"];?\s*/g, '')
    .replace(/import\s+THREE\s+from\s+['"]three['"];?\s*/g, '')
    // Remove gsap imports (available globally)
    .replace(/import\s+gsap\s+from\s+['"]gsap['"];?\s*/g, '')
    .replace(
      /import\s+{\s*default\s+as\s+gsap\s*}\s+from\s+['"]gsap['"];?\s*/g,
      '',
    )
    // Convert three/addons imports to dynamic imports
    .replace(
      /import\s+{\s*([^}]+)\s*}\s+from\s+['"]three\/addons\/([^'"]+)['"];?\s*/g,
      (_, imports, path) => {
        const importList = (imports as string)
          .split(',')
          .map((s: string) => s.trim())
        return `const { ${importList.join(', ')} } = await import('three/addons/${path}');\n`
      },
    )
    // Convert non-three/non-gsap imports to dynamic imports
    // (e.g., external packages like @sparkjsdev/spark)
    .replace(
      /import\s+{\s*([^}]+)\s*}\s+from\s+['"]([^'"]+)['"];?\s*/g,
      (match, imports, specifier) => {
        // Skip if it looks like a three or gsap import that wasn't caught above
        if ((specifier as string).startsWith('three') || specifier === 'gsap') {
          return match
        }
        const importList = (imports as string)
          .split(',')
          .map((s: string) => s.trim())
        return `const { ${importList.join(', ')} } = await import('${specifier}');\n`
      },
    )
    // Remove export keywords (keep declarations)
    // Use [ \t]+ instead of \s+ to avoid matching across newlines
    // (e.g. a comment ending in "...export\n" followed by "const ...")
    .replace(/export[ \t]+const[ \t]+/g, 'const ')
    .replace(/export[ \t]+function[ \t]+/g, 'function ')
    .replace(/export[ \t]+async[ \t]+function[ \t]+/g, 'async function ')
    .replace(/export[ \t]+default[ \t]+/g, '')

  // Wrap in async IIFE to support dynamic imports
  return `
(async () => {
  ${transformed}
  // Expose the init function globally
  if (typeof initVos !== 'undefined') window.initVos = initVos;
  if (typeof initAnimation !== 'undefined') window.initAnimation = initAnimation;
})();
`
}

/**
 * Client target: ALL imports removed, deps read from __vos__.__export namespace.
 * Exports initVos as ES module export.
 */
function transformForClient(code: string): string {
  const addonNames = Object.keys(ADDON_REGISTRY)

  const transformed = code
    // Remove any import statement
    .replace(/import\s+.*?from\s+['"][^'"]+['"];?\s*/g, '')
    // Remove 'export' keyword (but keep the rest of the declaration)
    // Use [ \t]+ instead of \s+ to avoid matching across newlines
    .replace(/export[ \t]+const[ \t]+/g, 'const ')
    .replace(/export[ \t]+function[ \t]+/g, 'function ')
    .replace(/export[ \t]+async[ \t]+function[ \t]+/g, 'async function ')
    .replace(/export[ \t]+default[ \t]+/g, '')

  // Wrap as ES module that reads deps from __vos__ namespace
  return `
const THREE = globalThis.__vos__.__export.THREE;
const gsap = globalThis.__vos__.__export.gsap;
const { ${addonNames.join(', ')} } = globalThis.__vos__.__export.addons;

${transformed}

export { initVos };
`
}
