import { renderElements } from './renderElements'
import type * as THREE_NS from 'three'

export interface VosElements {
  renderElements: (
    elementsConfig: any[],
    overlayScenes: Record<number, THREE_NS.Scene>,
    resolution: any,
    THREE: typeof THREE_NS,
  ) => Promise<Map<string, any>>
  disposeElements: (elementMap: Map<string, any>) => void
  /**
   * Re-rasterize canvas-backed element textures (text, SVG) for a new output
   * resolution — the host's resize path calls this so quality tracks the
   * drawing buffer. Returns true when any texture was rebuilt.
   */
  updateResolution: (elementMap: Map<string, any>, resolution: any) => boolean
}

/**
 * Factory: create the Vos element system bound to a THREE instance.
 */
export function createVosElements(THREE: typeof THREE_NS): VosElements {
  return {
    renderElements: (
      elementsConfig: any[],
      overlayScenes: Record<number, THREE_NS.Scene>,
      resolution: any,
    ) => renderElements(elementsConfig, overlayScenes, resolution, THREE),
    disposeElements: (elementMap: Map<string, any>) => {
      elementMap.forEach((instance) => instance.destroy?.())
      elementMap.clear()
    },
    updateResolution: (elementMap: Map<string, any>, resolution: any) => {
      let changed = false
      elementMap.forEach((instance) => {
        if (instance.updateResolution?.(resolution)) changed = true
      })
      return changed
    },
  }
}

export { renderElements } from './renderElements'
export {
  clampRasterScale,
  graphemes,
  layoutSplitUnits,
  lineMetricsFrom,
  lineWidthWithSpacing,
  rasterScaleFor,
  segmentText,
  DESIGN_HEIGHT,
} from './textLayout'
