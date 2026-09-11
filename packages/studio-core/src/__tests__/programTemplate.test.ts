/**
 * A template may be a PROGRAM document: a one-layer member on the shelf (a
 * callout, a code pane) with no footage at all. `applyTemplate` used to read
 * the template's segments, audio and frame as a recording's and threw on
 * the first; a component on the shelf is exactly what `--with` should lay.
 */
import { describe, expect, it } from 'vitest'
import { applyTemplate } from '../digest/style'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

function take(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20000,
        width: 1920,
        height: 1080,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 20 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

/** A one-layer program document, as the shelf holds a component. */
const member = {
  program: { config: { version: 2, duration: 4 } },
  audio: [],
  overlays: [
    {
      id: 'callout',
      kind: 'html' as const,
      start: 0,
      duration: 4,
      html: '<div class="c">Title</div>',
      css: '.c{color:#fff}',
      box: { width: 420, height: 132 },
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    },
  ],
} as unknown as ProjectDoc

describe('applyTemplate with a program document', () => {
  it('lays its layer at the anchor, stamped from, and touches nothing else', () => {
    const out = applyTemplate(member, take(), { at: 6, from: 'vos-callout' })
    const clip = out.doc.overlays?.find((o) => o.id === 'callout')
    expect(clip).toMatchObject({ kind: 'html', start: 6, from: 'vos-callout' })
    expect(out.doc.segments).toEqual([{ in: 0, out: 20 }])
    expect(out.doc.audio).toEqual([])
    expect(out.doc.frame).toEqual(DEFAULT_FRAME_STYLE)
    expect(out.notes).toEqual([])
  })

  it('at the end, lays it relative to the footage end without a freeze', () => {
    const out = applyTemplate(member, take(), {
      at: 'end',
      from: 'vos-callout',
    })
    const clip = out.doc.overlays?.find((o) => o.id === 'callout')
    expect(clip).toBeDefined()
    expect(out.doc.freeze ?? []).toEqual([])
  })
})
