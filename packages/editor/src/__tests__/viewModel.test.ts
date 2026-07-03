import { describe, expect, it } from 'vitest'
import { formatTime, rulerTicks, snapTime, toPx, toTime } from '../viewModel'

const viewport = { t0: 0, t1: 10 }

describe('viewModel math', () => {
  it('px↔time round-trips across the viewport', () => {
    expect(toPx(0, viewport, 800)).toBe(0)
    expect(toPx(10, viewport, 800)).toBe(800)
    expect(toPx(2.5, viewport, 800)).toBe(200)
    for (const t of [0, 1.234, 5, 9.99]) {
      expect(toTime(toPx(t, viewport, 800), viewport, 800)).toBeCloseTo(t, 9)
    }
  })

  it('rulerTicks picks a nice step and labels majors', () => {
    const ticks = rulerTicks(viewport, 800)
    expect(ticks.length).toBeGreaterThan(4)
    const majors = ticks.filter((t) => t.major)
    expect(majors.every((t) => t.label !== undefined)).toBe(true)
    expect(ticks.filter((t) => !t.major).every((t) => t.label === undefined)).toBe(true)
    // majors land on the step grid
    const step = majors[1].t - majors[0].t
    for (let i = 1; i < majors.length; i++) {
      expect(majors[i].t - majors[i - 1].t).toBeCloseTo(step, 6)
    }
  })

  it('rulerTicks degrades gracefully on empty input', () => {
    expect(rulerTicks({ t0: 0, t1: 0 }, 800)).toEqual([])
    expect(rulerTicks(viewport, 0)).toEqual([])
  })

  it('formatTime renders mm:ss (and tenths for fractional times)', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(2.5)).toBe('0:02.5')
  })

  it('snapTime magnetizes within the px threshold only', () => {
    const opts = { viewport, widthPx: 800, magnets: [5], thresholdPx: 8 }
    // 8px @ 800px/10s = 0.1s radius
    expect(snapTime(5.05, opts)).toBe(5)
    expect(snapTime(5.2, opts)).toBe(5.2)
    expect(snapTime(4.99, { ...opts, magnets: [] })).toBe(4.99)
  })
})
