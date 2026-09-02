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

/**
 * 2 = the document FAMILY era: a doc is a recording document (`source`)
 * or a program document (`program.config`). A v1 doc IS a recording document,
 * field for field, so 1 → 2 is a stamp; 0 → 1 was a stamp too.
 */
export const DOC_SCHEMA_VERSION = 2

/**
 * Upgrade a hosted doc.json payload to the current schema version.
 * Unstamped docs are v0 — the pre-stamp era. Every step so far is a stamp
 * (a post-v1 doc field is optional by doctrine, and v2 only widened the
 * family), so migration is structural identity. A real shape change chains
 * its step here.
 */
export function migrateHostedDoc(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const version =
    typeof raw.docSchemaVersion === 'number' ? raw.docSchemaVersion : 0
  if (version >= DOC_SCHEMA_VERSION) return raw
  // v0 → v1 → v2: stamp only.
  return { ...raw, docSchemaVersion: DOC_SCHEMA_VERSION }
}
