import { generateAddonImports, getRequiredAddons } from '../../addons/registry'
import type { VosConfig } from '../../types'

/**
 * Generate import statements based on config.
 * Uses the addon registry to determine which addons to import.
 *
 * When `overrideAddons` is provided, uses that list instead of
 * calling getRequiredAddons() — this enables the smart detection path.
 */
export function generateImports(
  config: VosConfig,
  overrideAddons?: string[],
): string {
  const imports = [
    "import * as THREE from 'three';",
    "import gsap from 'gsap';",
  ]

  const required = overrideAddons ?? getRequiredAddons(config)
  imports.push(...generateAddonImports(required))

  return imports.join('\n')
}
