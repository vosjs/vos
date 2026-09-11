/**
 * The house starters are shipped source: every one must pass the gate it
 * would hold a user's layer to, with no problem and no warning, and land at
 * its design size with its faces found from its own CSS.
 */
import { describe, expect, it } from 'vitest'
import {
  htmlLayerFaces,
  htmlLayerLabel,
  htmlLayerPictureBox,
  htmlLayerProblems,
} from '../htmlLayer'
import { HTML_STARTERS, htmlStarterClip } from '../htmlStarters'

describe('the html starters', () => {
  it('are five, each a distinct id and name', () => {
    expect(HTML_STARTERS.map((s) => s.id)).toEqual([
      'callout',
      'code',
      'terminal',
      'keys',
      'badge',
    ])
    expect(new Set(HTML_STARTERS.map((s) => s.name)).size).toBe(5)
  })

  for (const starter of HTML_STARTERS) {
    it(`${starter.name} passes the gate with nothing to say`, () => {
      const clip = htmlStarterClip(starter, 'h0', 0, 4)
      expect(htmlLayerProblems(clip as never)).toEqual([])
    })

    it(`${starter.name} finds its faces from its CSS and leaves room for its shadow`, () => {
      const clip = htmlStarterClip(starter, 'h0', 0, 4)
      const faces = htmlLayerFaces(clip)
      expect(faces.length).toBeGreaterThan(0)
      for (const f of faces)
        expect(f.url).toMatch(/^https:\/\/assets\.vos\.so\//)
      expect(htmlLayerPictureBox(clip).bleed).toBeGreaterThan(0)
      expect(htmlLayerLabel(clip)).not.toBe('HTML')
    })
  }

  it('a deliberately malformed starter would fail the gate (the control)', () => {
    const bad = { ...HTML_STARTERS[0], html: '<div>a<br>b & c</div>' }
    const codes = htmlLayerProblems(htmlStarterClip(bad, 'h0', 0, 4) as never)
      .map((p) => p.code)
      .sort()
    expect(codes).toEqual(['bare-ampersand', 'unclosed-void'])
  })

  it('mints a clip at a moment with the design-size default and a centred transform', () => {
    const clip = htmlStarterClip(HTML_STARTERS[0], 'h7', 2.5, 4)
    expect(clip).toMatchObject({
      id: 'h7',
      kind: 'html',
      start: 2.5,
      duration: 4,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    })
    expect(clip.width).toBeUndefined()
    expect(clip.bleed).toBeUndefined()
  })
})
