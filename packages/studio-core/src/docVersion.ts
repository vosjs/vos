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
import type { ProjectDoc } from './types'

/**
 * 3 = the one-vocabulary era: a recording document's `frame.entrance`,
 * `endCard`, clip `enter`/`exit`/`fx` and prop `animation` are read into
 * `anim` (and the end card into clips after the footage plus a card exit).
 * 2 = the document FAMILY era (a recording document, or a program
 * document); a v1 doc IS a recording document, so 1 → 2 was a stamp, and
 * 0 → 1 was a stamp too.
 */
export const DOC_SCHEMA_VERSION = 3

/**
 * Upgrade a hosted doc.json payload to the current schema version.
 * Unstamped docs are v0 — the pre-stamp era. v0 → v2 were stamps; v2 → v3
 * rewrites a recording document's motion spellings into the vocabulary,
 * and leaves a program document as it was (its layers migrate the same
 * way when they carry the old spellings). A real shape change chains its
 * step here.
 */
export function migrateHostedDoc(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const version =
    typeof raw.docSchemaVersion === 'number' ? raw.docSchemaVersion : 0
  if (version >= DOC_SCHEMA_VERSION) return raw
  let doc = raw
  if (version < 3 && doc.source && typeof doc.source === 'object') {
    doc = migrateMotion(doc as unknown as ProjectDoc) as unknown as Record<
      string,
      unknown
    >
  }
  return { ...doc, docSchemaVersion: DOC_SCHEMA_VERSION }
}
