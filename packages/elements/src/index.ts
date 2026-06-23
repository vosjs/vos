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
  }
}

export { renderElements } from './renderElements'
