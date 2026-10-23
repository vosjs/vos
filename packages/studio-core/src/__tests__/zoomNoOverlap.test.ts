/**
 * The planner's spans never overlap, so the linter never refuses the
 * planner's own output. A real canvas take (shapes dragged into place,
 * labels typed between the drags) planned drag spans that a typing span
 * and a click span ran into: a fresh plan the linter rejected with "zoom
 * gN overlaps zoom kN", and a render that drew it anyway.
 */
import { describe, expect, it } from 'vitest'
import { planAutoZoom } from '../planner/autoZoom'
import { ZOOM_STYLES } from '../zoomStyle'
import { CANVAS_LABELS_SIZE, CANVAS_LABELS_TRACK } from './canvasLabelsTrack'
import type { ZoomSpan } from '../types'
import type { ZoomStyleName } from '../zoomStyle'

function overlaps(spans: ZoomSpan[]): string[] {
  const sorted = [...spans].sort((a, b) => a.in - b.in)
  const out: string[] = []
  for (let i = 0; i + 1 < sorted.length; i++)
    if (sorted[i].out > sorted[i + 1].in)
      out.push(`${sorted[i].id} overlaps ${sorted[i + 1].id}`)
  return out
}

describe('a canvas take of drags with labels typed between them', () => {
  it('plans drags, typing and clicks, and no two of them overlap', () => {
    const spans = planAutoZoom(CANVAS_LABELS_TRACK, CANVAS_LABELS_SIZE)
    const kinds = new Set(spans.map((s) => s.id[0]))
    // every origin the take has is still planned
    expect(kinds).toContain('g')
    expect(kinds).toContain('k')
    expect(kinds).toContain('z')
    expect(overlaps(spans)).toEqual([])
    for (const s of spans) expect(s.out - s.in).toBeGreaterThanOrEqual(0.3)
  })

  it('holds under every camera style', () => {
    for (const style of Object.keys(ZOOM_STYLES) as ZoomStyleName[]) {
      const spans = planAutoZoom(CANVAS_LABELS_TRACK, {
        ...CANVAS_LABELS_SIZE,
        style,
      })
      expect({ style, overlaps: overlaps(spans) }).toEqual({
        style,
        overlaps: [],
      })
    }
  })
})
