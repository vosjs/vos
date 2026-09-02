/**
 * Style as DATA: the fields of a signed-off take's doc that ARE its
 * style — camera, speed, tilt personality, frame, cursor, cam bubble, export.
 * `copyStyle` carries them onto another take deterministically, so a series
 * shares them by construction and the recipe (CUT.md) only has to say what a
 * number cannot. Never the spans, overlays or audio: those are the cut.
 */
import type { ProjectDoc } from '../types'

export const STYLE_FIELDS = [
  'zoomStyle',
  'zoomParams',
  'speedParams',
  'tiltStyle',
  'frame',
  'cursor',
  'cam',
  'export',
] as const satisfies readonly (keyof ProjectDoc)[]

export type StyleField = (typeof STYLE_FIELDS)[number]

/** The style fields present on a doc, deep-cloned. */
export function pickStyle(
  doc: ProjectDoc,
): Partial<Pick<ProjectDoc, StyleField>> {
  const out: Record<string, unknown> = {}
  for (const k of STYLE_FIELDS) {
    const v: unknown = doc[k]
    if (v !== undefined) out[k] = structuredClone(v)
  }
  return out as Partial<Pick<ProjectDoc, StyleField>>
}

/**
 * A new doc: `to` with `from`'s style fields. A field absent on `from` is
 * removed from the result (the seed's absence is a choice — the default).
 */
export function copyStyle(from: ProjectDoc, to: ProjectDoc): ProjectDoc {
  const next = structuredClone(to) as unknown as Record<string, unknown>
  const style = pickStyle(from) as Record<string, unknown>
  for (const k of STYLE_FIELDS) {
    if (k in style) next[k] = style[k]
    else delete next[k]
  }
  return next as unknown as ProjectDoc
}
