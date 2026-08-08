import { describe, expect, it } from 'vitest'
import {
  clampRasterScale,
  graphemes,
  layoutSplitUnits,
  lineMetricsFrom,
  lineWidthWithSpacing,
  rasterScaleFor,
  segmentText,
  type LineMetrics,
} from '../textLayout'

// Stub measurer: every grapheme (including whitespace) advances 10 design px.
const measure = (t: string) => graphemes(t).length * 10

const METRICS: LineMetrics = { ascent: 20, descent: 5, advance: 30 }

describe('rasterScaleFor', () => {
  it('is 1 at the 1080p design baseline', () => {
    expect(rasterScaleFor({ height: 1080, drawingBufferHeight: 1080 })).toBe(1)
  })

  it('follows the drawing buffer, not the CSS size (4K export = 2×)', () => {
    expect(rasterScaleFor({ height: 2160, drawingBufferHeight: 2160 })).toBe(2)
  })

  it('derives the buffer from pixelRatio when no buffer size is given', () => {
    expect(rasterScaleFor({ height: 1080, pixelRatio: 2 })).toBe(2)
  })

  it('defaults to 1 on missing or degenerate input', () => {
    expect(rasterScaleFor(undefined)).toBe(1)
    expect(rasterScaleFor({ height: 0, pixelRatio: 0 })).toBe(1)
  })

  it('clamps to sane bounds', () => {
    expect(rasterScaleFor({ drawingBufferHeight: 40 })).toBe(0.25)
    expect(rasterScaleFor({ drawingBufferHeight: 1080 * 100 })).toBe(8)
  })
})

describe('clampRasterScale', () => {
  it('limits the scale so the canvas fits the texture budget', () => {
    // 3000 design px at 2× would be 6000 > 4096 default limit.
    expect(clampRasterScale(2, 3000, 100)).toBeCloseTo(4096 / 3000)
  })

  it('respects an explicit GPU limit', () => {
    expect(clampRasterScale(2, 3000, 100, 8192)).toBe(2)
  })

  it('leaves small canvases alone', () => {
    expect(clampRasterScale(2, 200, 100)).toBe(2)
  })
})

describe('lineMetricsFrom', () => {
  it('uses font bounding box metrics when present', () => {
    const m = lineMetricsFrom(
      { fontBoundingBoxAscent: 30, fontBoundingBoxDescent: 8 },
      24,
      1.2,
    )
    expect(m).toEqual({ ascent: 30, descent: 8, advance: 24 * 1.2 })
  })

  it('falls back to em approximations', () => {
    const m = lineMetricsFrom(null, 24, 1.5)
    expect(m.ascent).toBeCloseTo(19.2)
    expect(m.descent).toBeCloseTo(6)
    expect(m.advance).toBeCloseTo(36)
  })
})

describe('graphemes', () => {
  it('keeps emoji and modifier sequences whole', () => {
    expect(graphemes('👍🏽ab')).toEqual(['👍🏽', 'a', 'b'])
  })
})

describe('segmentText', () => {
  it('chars: one unit per grapheme with char offsets, skipping spaces', () => {
    const { units } = segmentText('a b', 'chars')
    expect(units).toEqual([
      { text: 'a', lineIndex: 0, charOffset: 0 },
      { text: 'b', lineIndex: 0, charOffset: 2 },
    ])
  })

  it('words: keeps real offsets across runs of whitespace', () => {
    const { units } = segmentText('  hi   there', 'words')
    expect(units).toEqual([
      { text: 'hi', lineIndex: 0, charOffset: 2 },
      { text: 'there', lineIndex: 0, charOffset: 7 },
    ])
  })

  it('keeps the line structure for multi-line content', () => {
    const { lines, units } = segmentText('ab\ncd', 'chars')
    expect(lines).toEqual(['ab', 'cd'])
    expect(units.map((u) => u.lineIndex)).toEqual([0, 0, 1, 1])
  })

  it('lines: one unit per non-empty line', () => {
    const { units } = segmentText('one\n\ntwo', 'lines')
    expect(units).toEqual([
      { text: 'one', lineIndex: 0, charOffset: 0 },
      { text: 'two', lineIndex: 2, charOffset: 0 },
    ])
  })
})

describe('lineWidthWithSpacing', () => {
  it('adds spacing between grapheme clusters only', () => {
    expect(lineWidthWithSpacing('abc', 2, measure)).toBe(34)
    expect(lineWidthWithSpacing('a', 2, measure)).toBe(10)
    expect(lineWidthWithSpacing('', 2, measure)).toBe(0)
  })
})

describe('layoutSplitUnits', () => {
  it('centers a spaced chars split symmetrically', () => {
    const { units, width } = layoutSplitUnits(
      'abc',
      'chars',
      { letterSpacing: 2, align: 'left', metrics: METRICS },
      measure,
    )
    expect(width).toBe(34)
    // Middle grapheme of an odd count sits exactly at block center.
    expect(units[1].offsetX).toBeCloseTo(0)
    expect(units[0].offsetX).toBeCloseTo(-12)
    expect(units[2].offsetX).toBeCloseTo(12)
  })

  it('words: real whitespace advances survive (no synthetic space width)', () => {
    const { units, width } = layoutSplitUnits(
      'hi there',
      'words',
      { letterSpacing: 0, align: 'left', metrics: METRICS },
      measure,
    )
    // 'hi there' = 8 graphemes × 10.
    expect(width).toBe(80)
    expect(units[0].offsetX).toBeCloseTo(-40 + 10) // 'hi' center
    expect(units[1].offsetX).toBeCloseTo(-40 + 30 + 25) // after 'hi '
  })

  it('lines stack vertically, not horizontally', () => {
    const { units, width, height } = layoutSplitUnits(
      'one\ntwo',
      'lines',
      { letterSpacing: 0, align: 'left', metrics: METRICS },
      measure,
    )
    expect(width).toBe(30)
    expect(height).toBe(30 + 20 + 5) // (lines-1)*advance + ascent + descent
    expect(units[0].offsetX).toBeCloseTo(units[1].offsetX)
    expect(units[0].offsetY).toBeGreaterThan(units[1].offsetY)
    // Line 0 center sits above block center by half the advance.
    expect(units[0].offsetY - units[1].offsetY).toBeCloseTo(30)
  })

  it('honors align for ragged lines', () => {
    const right = layoutSplitUnits(
      'a\nabc',
      'lines',
      { letterSpacing: 0, align: 'right', metrics: METRICS },
      measure,
    )
    // Right edge of both lines at blockWidth/2.
    expect(right.units[0].offsetX + 5).toBeCloseTo(15)
    expect(right.units[1].offsetX + 15).toBeCloseTo(15)

    const center = layoutSplitUnits(
      'a\nabc',
      'lines',
      { letterSpacing: 0, align: 'center', metrics: METRICS },
      measure,
    )
    expect(center.units[0].offsetX).toBeCloseTo(0)
    expect(center.units[1].offsetX).toBeCloseTo(0)
  })

  it('multi-line chars split keeps per-line rows', () => {
    const { units } = layoutSplitUnits(
      'ab\ncd',
      'chars',
      { letterSpacing: 0, align: 'left', metrics: METRICS },
      measure,
    )
    const rows = new Set(units.map((u) => u.offsetY))
    expect(rows.size).toBe(2)
  })
})
