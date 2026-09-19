import { findFontFamily } from '@vosjs/shared'

/**
 * The name a family goes by in the hosted catalog, when a site's own CSS
 * name for it differs only by the `Variable` suffix.
 *
 * A site ships `Inter Variable` or `Lexend Variable` (the fontsource names),
 * and that is what a page's computed style reports. The catalog hosts the
 * same family as `Inter` or `Lexend`, and a render page registers the face
 * under THAT name, so CSS written with the site's name matches nothing and
 * falls back to a system stack, silently on the fleet. The name is corrected
 * where it is WRITTEN (the brand kit, the composed callout), never at the
 * lookup: a lookup that forgave the suffix would find the face and still
 * leave the CSS asking for a family nobody registered.
 *
 * A family the catalog does not host is returned untouched.
 */
export function catalogFamily(family: string): string {
  const name = family.trim()
  if (findFontFamily(name)) return name
  const base = name.replace(/\s+Variable$/i, '')
  if (base !== name) {
    const hit = findFontFamily(base)
    if (hit) return hit.family
  }
  return family
}
