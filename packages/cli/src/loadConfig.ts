import { readFile } from 'node:fs/promises'
import { CURRENT_CONFIG_VERSION, migrateConfig, vosConfigJsonSchema } from '@vosjs/core'
import { UsageError } from './args'

export interface LoadedConfig {
  config: Record<string, unknown>
  warnings: string[]
}

/**
 * Load a VosConfigJson from a file path or http(s) URL, unwrap API `{ config }`
 * envelopes, migrate old versions, and validate against the schema.
 */
export async function loadVosConfig(source: string): Promise<LoadedConfig> {
  const warnings: string[] = []
  let raw: string
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`fetch ${source} → ${res.status}`)
    raw = await res.text()
  } else {
    raw = await readFile(source, 'utf8')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new UsageError(`${source} is not valid JSON: ${(e as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new UsageError(`${source} does not contain a JSON object`)
  }

  // API endpoints wrap the config: { config: {...} }.
  let obj = parsed as Record<string, unknown>
  if (
    typeof obj.config === 'object' &&
    obj.config !== null &&
    !('createTimeline' in obj)
  ) {
    obj = obj.config as Record<string, unknown>
    warnings.push('unwrapped { config } envelope')
  }

  const version = obj.version
  const migrated = migrateConfig(obj)
  if (version !== CURRENT_CONFIG_VERSION) {
    warnings.push(`migrated config v${String(version ?? 1)} → v${CURRENT_CONFIG_VERSION}`)
  }

  const check = vosConfigJsonSchema.safeParse(migrated)
  if (!check.success) {
    const issues = check.error.issues
      .slice(0, 5)
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new UsageError(`invalid vos config:\n${issues}`)
  }

  return { config: migrated, warnings }
}

/** Best-effort duration from the config (seconds). */
export function configDuration(config: Record<string, unknown>): number | undefined {
  const d = config.duration
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : undefined
}
