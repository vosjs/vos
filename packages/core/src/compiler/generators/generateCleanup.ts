import type { VosConfig } from '../../types'

/**
 * Generate cleanup function code.
 * Disposes all tracked resources: elements, composer, renderer, and globals.
 */
export function generateCleanup(config: VosConfig): string {
  const hasComposer = !!config.postprocessing?.length
  const hasElements = !!config.elements?.length
  const hasPerLayer = !!config.perLayerEffects?.length

  const perLayerCleanup = hasPerLayer
    ? `// Dispose per-layer composers
      for (const g of renderGroups) {
        if (g.composer) { g.composer.renderTarget1.dispose(); g.composer.renderTarget2.dispose(); }
      }
      blitMaterial.dispose();`
    : ''

  const globalCleanup = hasComposer
    ? `// Dispose global composite resources
      if (compositeTarget) compositeTarget.dispose();
      if (globalComposer) { globalComposer.renderTarget1.dispose(); globalComposer.renderTarget2.dispose(); }`
    : ''

  return `() => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      tl.kill();
      if (content.dispose) content.dispose();
      ${
        hasElements
          ? `// Dispose elements and their textures/geometries
      if (window.__vos__?.elements) {
        window.__vos__.elements.disposeElements(elements);
      }`
          : ''
      }
      ${
        hasComposer
          ? `// Dispose composer render targets
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();`
          : ''
      }
      ${perLayerCleanup}
      ${globalCleanup}
      // Dispose renderer and remove canvas
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      // Cleanup globals
      if (window.__vos__) {
        window.__vos__.videoCallbacks?.clear();
        window.__vos__.pendingDecodes?.clear();
        delete window.__vos__;
      }
    }`
}
