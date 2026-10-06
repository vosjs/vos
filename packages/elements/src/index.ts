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
  /**
   * Re-raster every canvas-backed text element with UNCHANGED values — the
   * late-webfont hook: a face registered after first paint (data.fonts via
   * setData) re-draws over the fallback stack once it lands.
   */
  rerasterAll: (elementMap: Map<string, any>) => boolean
  /**
   * After updateData: did any element REBUILD its units (a bound split text
   * whose words changed)? Its `segments` and `props` are new objects, so the
   * host rebuilds the timeline that tweens them. Reading clears the flags.
   */
  takeStructural: (elementMap: Map<string, any>) => boolean
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
    rerasterAll: (elementMap: Map<string, any>) => {
      let changed = false
      elementMap.forEach((instance) => {
        if (instance.refreshRaster?.()) changed = true
      })
      return changed
    },
    takeStructural: (elementMap: Map<string, any>) => {
      let structural = false
      elementMap.forEach((instance) => {
        if (instance.structural) {
          instance.structural = false
          structural = true
        }
      })
      return structural
    },
  }
}

export { renderElements } from './renderElements'
export {
  extractTextBindings,
  isDataRef,
  resolveBoundRuns,
  resolveTextElement,
} from './dataBinding'
export type { DataRef, TextBindings } from './dataBinding'
export {
  clampRasterScale,
  graphemes,
  layoutSplitUnits,
  layoutTextBlock,
  lineMetricsFrom,
  lineWidthWithSpacing,
  middleAboveBaseline,
  plainLines,
  rasterScaleFor,
  segmentText,
  spacedAdvance,
  DESIGN_HEIGHT,
} from './textLayout'
export type {
  BlockLine,
  LineMetrics,
  SplitLayout,
  TextBlockLayout,
  UnitPlacement,
} from './textLayout'
// Styled text (runs, layout, caret) is at `@vosjs/elements/text`, the pure
// entry a host imports without the renderers; this entry is also the
// bundle a render page carries, and stays the renderer alone.
