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
 * Recipe: scale an element by a factor (corner-handle resize). Folds into
 * `transform.scale`, which the renderer bakes into the mesh's base scale —
 * the ephemeral preview (`props.scale = factor`) multiplies that same base,
 * so preview and committed state land on identical pixels.
 * Returns null when nothing matches. Factor is clamped to keep the element
 * recoverable (never scaled below 5%).
 */
export function scaleElementRecipe(
  config: ConfigWithElements,
  elementId: string,
  factor: number,
): Recipe<ConfigWithElements> | null {
  const elements = config.elements
  if (!Array.isArray(elements) || !Number.isFinite(factor) || factor <= 0) return null
  const index = elements.findIndex((e, i) => elementConfigId(e, i) === elementId)
  if (index < 0) return null

  return (draft) => {
    const el = draft.elements![index]
    const transform = (el.transform ?? {}) as Record<string, unknown>
    const current = typeof transform.scale === 'number' ? transform.scale : 1
    el.transform = {
      ...transform,
      scale: Math.max(0.05, round(current * factor)),
    }
  }
}

/**
 * Recipe: rotate an element by a delta in degrees (rotate-handle drag).
 * Writes the canonical `rotation` key and folds any `rotateZ` alias into it
 * (the renderer prefers `rotateZ` when both exist). Normalized to (-180, 180].
 */
export function rotateElementRecipe(
  config: ConfigWithElements,
  elementId: string,
  deltaDeg: number,
): Recipe<ConfigWithElements> | null {
  const elements = config.elements
  if (!Array.isArray(elements) || !Number.isFinite(deltaDeg)) return null
  const index = elements.findIndex((e, i) => elementConfigId(e, i) === elementId)
  if (index < 0) return null

  return (draft) => {
    const el = draft.elements![index]
    const { rotateZ, rotation, ...rest } = (el.transform ?? {}) as Record<string, unknown>
    const base =
      typeof rotateZ === 'number' ? rotateZ : typeof rotation === 'number' ? rotation : 0
    el.transform = { ...rest, rotation: round(normalizeDeg(base + deltaDeg)) }
  }
}

/**
 * The element's committed rotation in degrees (`rotateZ` alias respected).
 * Hosts need this for ephemeral rotate previews: the props proxy's `rotation`
 * is ABSOLUTE (it overwrites the mesh), so a drag previews
 * `setElementProps(id, { rotation: base + delta })`.
 */
export function elementBaseRotation(
  config: ConfigWithElements,
  elementId: string,
): number {
  const elements = config.elements
  if (!Array.isArray(elements)) return 0
  const index = elements.findIndex((e, i) => elementConfigId(e, i) === elementId)
  if (index < 0) return 0
  const transform = (elements[index].transform ?? {}) as Record<string, unknown>
  const rz = transform.rotateZ
  const r = transform.rotation
  return typeof rz === 'number' ? rz : typeof r === 'number' ? r : 0
}

function normalizeDeg(deg: number): number {
  let d = ((deg % 360) + 360) % 360
  if (d > 180) d -= 360
  return d
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
