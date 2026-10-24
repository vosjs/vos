import { describe, expect, it } from 'vitest'
import { fitCaptions, readingSeconds } from '../captionFit'

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

  it('leaves when its step ends, unless its words take longer to read', () => {
    const fit = fitCaptions(
      [
        { start: 1, end: 30, until: 3.2, text: 'Press Create key' },
        {
          start: 5,
          end: 30,
          until: 5.3,
          text: 'Name it for where it will live',
        },
        { start: 9, end: 30, until: 20, text: 'Done' },
      ],
      (s) => s,
    )
    // Its step ends at 3.2 (2.2 s), longer than its words take (1.2 s).
    expect(fit.kept[0].duration).toBe(2.2)
    // A 0.3 s step, 30 characters: up for the 1.765 s they take to read,
    // and held 1.46 s past the step.
    expect(fit.kept[1].duration).toBe(1.765)
    expect(fit.kept[1].held).toBe(1.46)
    expect(fit.kept[0].held).toBeUndefined()
    // An 11 s step stops at the longest a caption stays.
    expect(fit.kept[2].duration).toBe(3)
  })

  it('still gives way to the next caption and its clip when its step runs on', () => {
    const fit = fitCaptions(
      [
        { start: 1, end: 30, until: 6, text: 'Open the panel' },
        { start: 2.5, end: 3.9, until: 8, text: 'Then the field' },
      ],
      (s) => s,
    )
    expect(fit.kept.map((k) => k.duration)).toEqual([1.4, 1.4])
  })

  it('reading time is 17 characters a second, within the bounds', () => {
    expect(readingSeconds('Go')).toBe(1.2)
    expect(readingSeconds('Copy it: the secret is shown once')).toBeCloseTo(
      33 / 17,
      6,
    )
    expect(readingSeconds('  Copy   the  secret  ')).toBe(1.2)
    expect(
      readingSeconds(
        'Open the settings, then the keys page, then press Create key',
      ),
    ).toBe(3)
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
