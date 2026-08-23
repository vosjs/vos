import type { VosConfigJson } from '../types/vosConfigJson'

/**
 * Validates that a VosConfigJson has all required fields.
 * Does not validate function string syntax.
 */
export function isValidVosConfigJson(config: unknown): config is VosConfigJson {
  if (typeof config !== 'object' || config === null) return false

  const c = config as Record<string, unknown>

  return (
    typeof c.version === 'number' &&
    typeof c.duration === 'number' &&
    typeof c.camera === 'object' &&
    typeof c.createContent === 'string' &&
    typeof c.createTimeline === 'string' &&
    (c.setup === undefined || typeof c.setup === 'string') &&
    (c.onFrame === undefined || typeof c.onFrame === 'string')
  )
}
