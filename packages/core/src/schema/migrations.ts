/**
 * Config version migration system.
 *
 * Applies sequential migrations (v1 → v2 → ... → current) to bring
 * old VosConfigJson objects up to the latest schema version.
 */

export const CURRENT_CONFIG_VERSION = 2

type Migration = (config: Record<string, unknown>) => Record<string, unknown>

/**
 * v1 → v2: Remove `repeat` field (now always hardcoded to -1).
 */
const migrateV1toV2: Migration = (config) => {
  const { repeat: _repeat, ...rest } = config
  return { ...rest, version: 2 }
}

const migrations: Record<number, Migration> = {
  1: migrateV1toV2,
}

/**
 * Migrate a config object to the current schema version.
 * Missing version is treated as v1.
 */
export function migrateConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  let version = typeof config.version === 'number' ? config.version : 1
  let current = { ...config }

  while (version < CURRENT_CONFIG_VERSION) {
    const migrate = migrations[version] as Migration | undefined
    if (!migrate) {
      throw new Error(`No migration for config version ${version}`)
    }
    current = migrate(current)
    version = current.version as number
  }

  return current
}
