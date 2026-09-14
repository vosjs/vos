/**
 * Hosted-doc schema versioning: the scoped reversal of "ProjectDocs
 * are never persisted" is hosted versions only, and every persisted doc is
 * stamped `docSchemaVersion` from day one so the migration obligation the
 * old rule avoided stays bounded to one seam — migrate-on-read, here.
 *
 * Local studio sessions still never persist docs; CLI take dirs carry
 * doc.json under `schema/doc.schema.json` (which tolerates the stamp via
 * additionalProperties). Both hydration paths (studio handback, `vos
 * pull`) run through migrateHostedDoc before trusting a hosted doc.
 */
import { migrateMotion } from './lower/motion'
import { RETIRED_ZOOM_STYLES } from './zoomStyle'
import type { ProjectDoc } from './types'

/**
 * 5 = the six-style era: the retired camera styles `keynote` and `drift`
 * are read into their live style plus the tilt intensity the name carried
 * (`glide` + medium, `cinema` + subtle; an explicit `tiltStyle` wins). The
 * spans are untouched: a migration never re-plans.
 * 4 = the freeze era: a segment's `hold` is read into `doc.freeze` (a
 * freeze at that segment's end), the retime primitive beside speed spans.
 * 3 = the one-vocabulary era: a recording document's `frame.entrance`,
 * `endCard`, clip `enter`/`exit`/`fx` and prop `animation` are read into
 * `anim` (and the end card into clips after the footage plus a card exit).
 * 2 = the document FAMILY era (a recording document, or a program
 * document); a v1 doc IS a recording document, so 1 → 2 was a stamp, and
 * 0 → 1 was a stamp too.
 */
export const DOC_SCHEMA_VERSION = 5

/**
 * Upgrade a hosted doc.json payload to the current schema version.
 * Unstamped docs are v0 — the pre-stamp era. v0 → v2 were stamps; v2 → v3
 * rewrites a recording document's motion spellings into the vocabulary,
 * and v3 → v4 its segment holds into freezes (one rewrite, `migrateMotion`,
 * idempotent, so both steps are one call); v4 → v5 rewrites a retired
 * camera style name (`migrateZoomStyle`); a program document is left as
 * it was (its layers migrate the same way when they carry the old
 * spellings). A real shape change chains its step here.
 */
export function migrateHostedDoc(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const version =
    typeof raw.docSchemaVersion === 'number' ? raw.docSchemaVersion : 0
  if (version >= DOC_SCHEMA_VERSION) return raw
  let doc = raw
  if (version < 4 && doc.source && typeof doc.source === 'object') {
    doc = migrateMotion(doc as unknown as ProjectDoc) as unknown as Record<
      string,
      unknown
    >
  }
  if (version < 5) doc = migrateZoomStyle(doc)
  return { ...doc, docSchemaVersion: DOC_SCHEMA_VERSION }
}

/**
 * A retired camera style name becomes its live style plus the tilt
 * intensity the name carried, unless the document already says how far it
 * leans. Idempotent; a document on a live name is returned as it was.
 */
export function migrateZoomStyle(
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const name = doc.zoomStyle
  if (typeof name !== 'string') return doc
  const retired = RETIRED_ZOOM_STYLES[name]
  if (!retired) return doc
  return {
    ...doc,
    zoomStyle: retired.style,
    tiltStyle: doc.tiltStyle ?? retired.tilt,
  }
}
