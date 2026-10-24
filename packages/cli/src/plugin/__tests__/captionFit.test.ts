import { describe, expect, it } from 'vitest'
import { fitCaptions } from '../captionFit'

const at = (start: number, end = 30) => ({ start, end })

describe('fitCaptions (no two captions on screen at once)', () => {
  it('gives each caption the room up to the next one, less the gap, up to the longest', () => {
    const fit = fitCaptions([at(1), at(3), at(10)], (s) => s)
    expect(fit.kept.map((k) => k.duration)).toEqual([1.9, 3, 3])
    expect(fit.dropped).toEqual([])
  })

  it('drops a caption the next one follows too soon, and the earlier one gives way to the next KEPT caption', () => {
    const fit = fitCaptions([at(1), at(4), at(4.5), at(9)], (s) => s)
    expect(fit.kept.map((k) => k.item.start)).toEqual([1, 4.5, 9])
    // 1 s gives way to 4.5 (the one at 4 is gone), not to 4.
    expect(fit.kept[0].duration).toBe(3)
    expect(fit.kept[1].duration).toBe(3)
    expect(fit.dropped).toHaveLength(1)
    expect(fit.dropped[0].item.start).toBe(4)
    expect(fit.dropped[0].why).toMatch(/next caption starts 0\.50s after it/)
  })

  it('ends with the clip it starts in, and drops one that would be too short to read there', () => {
    const fit = fitCaptions([at(8, 10), at(9.5, 10)], (s) => s)
    // The one at 9.5 is dropped, so the one at 8 runs to its clip's end.
    expect(fit.kept).toEqual([{ item: at(8, 10), duration: 2 }])
    expect(fit.dropped[0].why).toMatch(/last 0\.50s of its clip/)
  })

  it('reads the input in playing order and never mutates it', () => {
    const items = [at(9), at(1)]
    const fit = fitCaptions(items, (s) => s)
    expect(fit.kept.map((k) => k.item.start)).toEqual([1, 9])
    expect(items.map((s) => s.start)).toEqual([9, 1])
  })

  it('keeps every interval apart by at least the gap', () => {
    const starts = [0, 0.4, 1.3, 2.9, 3.0, 4.6, 7, 7.5, 12]
    const fit = fitCaptions(
      starts.map((s) => at(s, 13)),
      (s) => s,
    )
    for (let i = 1; i < fit.kept.length; i++) {
      const prev = fit.kept[i - 1]
      expect(prev.item.start + prev.duration).toBeLessThanOrEqual(
        fit.kept[i].item.start - 0.1 + 1e-9,
      )
    }
    for (const k of fit.kept) expect(k.duration).toBeGreaterThanOrEqual(1.2)
  })
})
