import { POSTPROCESSING_REGISTRY } from '../../addons/registry'
import type { PostprocessingEntry } from '../../addons/registry'
import type { PostprocessingEffect } from '../../types'

/**
 * Generate postprocessing setup code using the effect registry.
 */
export function generatePostprocessingSetup(
  effects?: PostprocessingEffect[],
): string {
  if (!effects?.length) {
    return ''
  }

  const lines = [
    'const composer = new EffectComposer(renderer);',
    'composer.addPass(new RenderPass(scene, camera));',
  ]

  for (const effect of effects) {
    const entry = POSTPROCESSING_REGISTRY[effect.type as string] as
      | PostprocessingEntry
      | undefined
    if (entry) {
      lines.push(entry.generate(effect))
    } else {
      console.warn(`[vos] Unknown postprocessing effect: ${effect.type}`)
    }
  }

  // Global composite variables — activated by generateGlobalComposerSetup
  // when multiple 3D render groups exist
  lines.push(
    'let __useGlobalPath = false;',
    'let compositeTarget = null;',
    'let globalComposer = null;',
  )

  return lines.join('\n  ')
}
