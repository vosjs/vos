/**
 * Generate webfont registration for `config.fonts` AND data-carried faces.
 *
 * Two sources feed one dedup'd registrar:
 *  - `config.fonts` — compile-time declarations (unchanged contract).
 *  - `data.fonts`   — the same `{family, url, weight?, style?}` shape carried
 *    in the DATA object, so hosts can register faces without a recompile
 *    (remix font knobs: swapping a family is a pure data edit).
 *
 * Boot faces (both sources) are AWAITED before scene setup and element
 * rendering, so canvas text rasterizes with the real face — in preview and
 * in every capture path, including per-chunk fresh pages. Capped and
 * fail-open: a dead URL degrades to fallback stacks rather than hanging the
 * page. Faces arriving via setData load lazily; the module's setData hooks
 * their completion to re-raster text elements, so the real face replaces
 * the fallback as it lands.
 *
 * Always emitted — data fonts must work on configs that declare none.
 */
export function generateFontsSetup(config: { fonts?: unknown }): string {
  const fonts = config.fonts
  const fontsJson =
    Array.isArray(fonts) && fonts.length > 0
      ? JSON.stringify(fonts, null, 2).replace(/\n/g, '\n  ')
      : '[]'

  return `
  // Webfonts: one dedup'd registrar for config-declared and data-carried
  // faces (data.fonts — font knobs register faces at runtime, no recompile).
  const __vosFontSeen = new Set();
  const __vosRegisterFonts = (list, onLoaded) => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined') return [];
    if (!Array.isArray(list)) return [];
    const loads = [];
    for (const f of list) {
      if (!f || typeof f.family !== 'string' || !f.family || typeof f.url !== 'string' || !f.url) continue;
      const key = f.family + '|' + (f.weight != null ? f.weight : 'normal') + '|' + (f.style || 'normal') + '|' + f.url;
      if (__vosFontSeen.has(key)) continue;
      __vosFontSeen.add(key);
      try {
        const face = new FontFace(f.family, 'url(' + f.url + ')', {
          weight: f.weight != null ? String(f.weight) : 'normal',
          style: f.style || 'normal',
        });
        document.fonts.add(face);
        loads.push(face.load().then(() => { if (onLoaded) onLoaded(f); }).catch(() => {}));
      } catch (e) {}
    }
    return loads;
  };
  const fontFaceDecls = ${fontsJson};
  {
    const bootFontLoads = [
      ...__vosRegisterFonts(fontFaceDecls),
      ...__vosRegisterFonts(__vosData.fonts),
    ];
    if (bootFontLoads.length) {
      await Promise.race([
        Promise.all(bootFontLoads),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
  }
`
}
