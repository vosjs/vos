/**
 * Generate webfont registration for `config.fonts`.
 *
 * Declared faces register via the FontFace API and are AWAITED before scene
 * setup and element rendering, so canvas text (elements, user setup code)
 * rasterizes with the real face — in preview and in every capture path,
 * including per-chunk fresh pages. Capped and fail-open: a dead URL degrades
 * to fallback stacks rather than hanging the page.
 */
export function generateFontsSetup(config: { fonts?: unknown }): string {
  const fonts = config.fonts
  if (!Array.isArray(fonts) || fonts.length === 0) return ''
  const fontsJson = JSON.stringify(fonts, null, 2).replace(/\n/g, '\n  ')

  return `
  // Webfonts: register declared faces and await them (capped, fail-open)
  const fontFaceDecls = ${fontsJson};
  if (typeof document !== 'undefined' && typeof FontFace !== 'undefined') {
    await Promise.race([
      Promise.all(fontFaceDecls.map((f) => {
        try {
          const face = new FontFace(f.family, 'url(' + f.url + ')', {
            weight: f.weight != null ? String(f.weight) : 'normal',
            style: f.style || 'normal',
          });
          document.fonts.add(face);
          return face.load().catch(() => {});
        } catch (e) {
          return Promise.resolve();
        }
      })),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  }
`
}
