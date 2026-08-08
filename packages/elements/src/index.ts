import { renderElements } from './renderElements'
import type * as THREE_NS from 'three'

export interface VosElements {
  renderElements: (
    elementsConfig: any[],
    overlayScenes: Record<number, THREE_NS.Scene>,
    resolution: any,
    THREE?: typeof THREE_NS,
    data?: Record<string, unknown> | null,
  ) => Promise<Map<string, any>>
  disposeElements: (elementMap: Map<string, any>) => void
  /**
   * Re-rasterize canvas-backed element textures (text, SVG) for a new output
   * resolution — the host's resize path calls this so quality tracks the
   * drawing buffer. Returns true when any texture was rebuilt.
   */
  updateResolution: (elementMap: Map<string, any>, resolution: any) => boolean
  /**
   * Re-resolve `{$data: key}`-bound element props against fresh data — the
   * compiled module's setData calls this so bound text re-rasters in place.
   * Returns true when any element picked up a change.
   */
  updateData: (
    elementMap: Map<string, any>,
    data: Record<string, unknown> | null | undefined,
  ) => boolean
}

/**
 * Factory: create the Vos element system bound to a THREE instance.
 */
export function createVosElements(THREE: typeof THREE_NS): VosElements {
  return {
    // Position 4 is the legacy THREE slot (older compiled artifacts still
    // pass it; the factory's binding wins) — data rides position 5.
    renderElements: (
      elementsConfig: any[],
      overlayScenes: Record<number, THREE_NS.Scene>,
      resolution: any,
      _THREE?: typeof THREE_NS,
      data?: Record<string, unknown> | null,
    ) => renderElements(elementsConfig, overlayScenes, resolution, THREE, data),
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
    updateData: (
      elementMap: Map<string, any>,
      data: Record<string, unknown> | null | undefined,
    ) => {
      let changed = false
      elementMap.forEach((instance) => {
        if (instance.updateData?.(data)) changed = true
      })
      return changed
    },
  }
}

export { renderElements } from './renderElements'
export {
  extractTextBindings,
  isDataRef,
  resolveTextElement,
} from './dataBinding'
export type { DataRef, TextBindings } from './dataBinding'
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
