import { POSTPROCESSING_REGISTRY } from '../../addons/registry'
import type { PostprocessingEntry } from '../../addons/registry'
import type { VosConfig } from '../../types'

/**
 * Generate global composer setup code.
 *
 * When multiple 3D render groups exist, redirects all rendering into a
 * composite WebGLRenderTarget and applies global postprocessing effects
 * via a dedicated EffectComposer with TexturePass input.
 *
 * Single-group optimization: when only one 3D group exists, the primary
 * composer (Phase 3a) handles everything directly — no overhead.
 */
export function generateGlobalComposerSetup(config: VosConfig): string {
  if (!config.postprocessing?.length) return ''

  const effectPasses = config.postprocessing
    .map((e) => {
      const entry = POSTPROCESSING_REGISTRY[e.type as string] as
        | PostprocessingEntry
        | undefined
      if (!entry) return ''
      return entry.generate(e).replace(/composer\./g, 'globalComposer.')
    })
    .filter(Boolean)
    .join('\n      ')

  return `
  // Global effects — activate composite path when multiple 3D groups exist
  const __multiGroup = renderGroups.filter(g => g.type === '3d').length > 1;
  if (__multiGroup) {
    __useGlobalPath = true;

    compositeTarget = new THREE.WebGLRenderTarget(
      drawingBufferWidth, drawingBufferHeight,
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
    );

    globalComposer = new EffectComposer(renderer);
    globalComposer.addPass(new TexturePass(compositeTarget.texture));
    {
      ${effectPasses}
    }
    globalComposer.renderToScreen = true;
  }`
}
