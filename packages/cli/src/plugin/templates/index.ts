/**
 * The poster family that ships with the CLI, by name: generic layouts
 * with every word, colour and face bound to data, so a brand kit and a
 * release fill them and the filler places the shot per aspect. A maker's
 * own template (a config.json, or a hosted vos id) takes the same
 * contract through `--poster`.
 */
import { cardOnGradient } from './cardOnGradient'
import { splitCover } from './splitCover'

export const TEMPLATES: Record<string, () => Record<string, unknown>> = {
  'split-cover': splitCover,
  'card-on-gradient': cardOnGradient,
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES)

/** A fresh copy of a bundled template, or null when the name is unknown. */
export function templateByName(name: string): Record<string, unknown> | null {
  const make = TEMPLATES[name]
  return make ? make() : null
}
