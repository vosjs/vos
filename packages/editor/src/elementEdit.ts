/**
 * Element-edit commit helpers: turn an on-canvas drag (viewport CSS px) into a
 * durable VosConfigJson patch. The two-phase model: the drag previews live via
 * the bridge's ephemeral SET_ELEMENT_PROPS; on release the host commits ONE
 * patch to `config.elements[i].transform.translate*` and warm-reloads — same
 * final pixels, now baked into the program's base layout.
 *
 * Units: element `transform.translateX/Y` are DESIGN pixels (the element
 * renderer scales them by `viewportHeight / 1080`), so a CSS-px drag delta
 * converts by the inverse factor.
 */
import type { Recipe } from './store'

export const DESIGN_HEIGHT = 1080

/** Convert a viewport CSS-px drag delta into design-px (config transform units). */
export function cssDeltaToDesign(
  dxCss: number,
  dyCss: number,
  viewportCssHeight: number,
): { dx: number; dy: number } {
  const k = DESIGN_HEIGHT / Math.max(1, viewportCssHeight)
  return { dx: round(dxCss * k), dy: round(dyCss * k) }
}

/**
 * The id an element answers to on the editor bridge: its config `id`, or the
 * renderer's positional fallback (`element_{index}`).
 */
export function elementConfigId(entry: Record<string, unknown>, index: number): string {
  return typeof entry.id === 'string' ? entry.id : `element_${index}`
}

interface ConfigWithElements {
  elements?: Record<string, unknown>[]
}

/**
 * Recipe: nudge an element's transform.translate by a design-px delta.
 * Returns null when the config has no matching element (nothing to commit).
 * Runs through the patch store, so element drags are undoable like any edit.
 */
export function nudgeElementRecipe(
  config: ConfigWithElements,
  elementId: string,
  deltaDesign: { dx: number; dy: number },
): Recipe<ConfigWithElements> | null {
  const elements = config.elements
  if (!Array.isArray(elements)) return null
  const index = elements.findIndex((e, i) => elementConfigId(e, i) === elementId)
  if (index < 0) return null

  return (draft) => {
    const el = draft.elements![index]
    const transform = (el.transform ?? {}) as Record<string, unknown>
    const tx = typeof transform.translateX === 'number' ? transform.translateX : 0
    const ty = typeof transform.translateY === 'number' ? transform.translateY : 0
    el.transform = {
      ...transform,
      translateX: round(tx + deltaDesign.dx),
      translateY: round(ty + deltaDesign.dy),
    }
  }
}

/**
 * Element props-space position for a target rect center. The element props
 * proxy positions meshes in a CENTERED viewport-CSS-px space (x right-positive,
 * y down-positive, origin at the viewport center), so an ephemeral drag preview
 * is `setElementProps(id, propsForRectCenter(grabCx + dx, grabCy + dy, W, H))`.
 */
export function propsForRectCenter(
  cx: number,
  cy: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  return { x: round(cx - viewportW / 2), y: round(cy - viewportH / 2) }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
