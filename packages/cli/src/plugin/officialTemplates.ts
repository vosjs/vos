/**
 * The official templates on vos.so, found by TITLE on the official shelf
 * (`GET /api/vos/official`): the platform's `Templates` project, promoted,
 * is the registry, so a template is a document anyone can read and the
 * CLI carries no numbers of its own. A ref that is neither a file nor a
 * vos id resolves here (`--with "End card"`, `--style "Split cover,
 * landscape"`, `--style split-cover-square`: the match ignores case,
 * spaces and punctuation), and the end card `plan` proposes when the
 * recipe says `on` (or nothing) is the official `End card`; the house
 * clips in `motionPlan.ts` survive as the offline fallback only.
 */

/** The official end card's title. */
export const OFFICIAL_END_CARD_TITLE = 'End card'

/** The official split cover's title per aspect class. */
export const OFFICIAL_POSTER_TITLES = {
  landscape: 'Split cover, landscape',
  square: 'Split cover, square',
  portrait: 'Split cover, portrait',
  tile: 'Split cover, tile',
} as const

/** A title or a ref reduced to what identifies it: lowercase, letters and digits only. */
export function templateKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export interface OfficialRow {
  id: string
  title: string
  slug?: string
}

/**
 * The official vos a ref names, by its title (or its slug), or null. The
 * first match in the shelf's own order wins, so a duplicate title on the
 * gallery resolves to the one the founder sorted first.
 */
export function findOfficialByRef(
  rows: readonly OfficialRow[],
  ref: string,
): OfficialRow | null {
  const key = templateKey(ref)
  if (!key) return null
  for (const row of rows) {
    if (templateKey(row.title) === key) return row
    if (row.slug && templateKey(row.slug) === key) return row
  }
  return null
}
