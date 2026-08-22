/**
 * Config version migration system.
 *
 * Applies sequential migrations (v1 → v2 → ... → current) to bring
 * old VosConfigJson objects up to the latest schema version.
 *
 * `version` says which schema era a config was written against. Nothing in
 * the compiler or the runtime reads it: it exists so a config whose MEANING
 * changed while its SHAPE did not (a unit, a default, a reinterpreted
 * field) can still be read correctly years later, which no amount of
 * structural sniffing can recover after the fact.
 *
 * It is therefore required to STORE a config and optional to compile one.
 * The schema leaves it optional so playing a config costs no ceremony; a
 * host that persists configs enforces it at that boundary.
 */

export const CURRENT_CONFIG_VERSION = 2

type Migration = (config: Record<string, unknown>) => Record<string, unknown>

/**
 * Version 2 is the FLOOR: the engine has never been public at v1, so no
 * config outside vos.so was ever authored against it, and the last v1
 * artifact there has been carried forward. A v1 config is therefore refused
 * rather than migrated, which is the honest answer for a schema era this
 * engine no longer knows how to read.
 *
 * A future v2 → v3 registers here as `{ 2: migrateV2toV3 }` and the loop
 * below runs it. The map is empty, not absent, because the machinery is
 * what makes the version number worth stamping.
 */
const migrations: Record<number, Migration> = {}

/**
 * Migrate a config object to the current schema version, stamping
 * `version` on the way out.
 *
 * An ABSENT version is read as the CURRENT one so that a config scribbled
 * by hand still compiles and plays without ceremony. That is a convenience
 * for TRANSIENT work, not a claim about when the config was written:
 * nothing in a config says that, and a file can sit in a repository for
 * years before anyone runs it.
 *
 * So anything that makes a config DURABLE must require a version of its
 * own accord rather than lean on this default. A wrong reading of a config
 * you are watching corrects itself; a wrong reading of one you stored does
 * not, and that is the whole reason the number exists.
 *
 * A version NEWER than this engine understands throws instead of being
 * waved through: the fields it is about to ignore are the whole reason the
 * number exists.
 */
export function migrateConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const declared = config.version

  if (declared !== undefined) {
    if (
      typeof declared !== 'number' ||
      !Number.isInteger(declared) ||
      declared < 1
    ) {
      throw new Error(
        `Invalid config version: ${JSON.stringify(declared)} (expected a positive integer)`,
      )
    }
    if (declared > CURRENT_CONFIG_VERSION) {
      throw new Error(
        `Config version ${declared} was made by a newer vos. This engine reads up to version ${CURRENT_CONFIG_VERSION}. Upgrade @vosjs/core.`,
      )
    }
  }

  let version = typeof declared === 'number' ? declared : CURRENT_CONFIG_VERSION
  let current: Record<string, unknown> = { ...config, version }

  while (version < CURRENT_CONFIG_VERSION) {
    const migrate = migrations[version] as Migration | undefined
    if (!migrate) {
      throw new Error(
        `No migration from config version ${version} to ${CURRENT_CONFIG_VERSION}.`,
      )
    }
    current = migrate(current)
    version = current.version as number
  }

  return current
}
