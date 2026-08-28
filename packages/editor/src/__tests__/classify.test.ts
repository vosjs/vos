import { describe, expect, it } from 'vitest'
import { classifyEdit } from '../classify'
import type { LoweredProgram } from '../classify'

const lowered = (over: Partial<LoweredProgram> = {}): LoweredProgram => ({
  program: 'PROGRAM_A',
  data: { padding: 10 },
  duration: 5,
  ...over,
})

describe('classifyEdit', () => {
  it('a tween-timing overlay rides the LOAD and retimes live afterwards', () => {
    const edits = [{ index: 0, startTime: 1 }]
    const prev = lowered({ tweenEdits: edits })
    expect(classifyEdit(null, prev, false)).toEqual([
      { type: 'LOAD', code: 'PROGRAM_A', data: prev.data, tweenEdits: edits },
    ])
    const next = lowered({
      data: prev.data,
      tweenEdits: [{ index: 0, startTime: 2 }],
    })
    expect(classifyEdit(prev, next, false)).toEqual([
      { type: 'SET_TWEEN_EDITS', edits: next.tweenEdits },
    ])
    // Dropping the overlay is an edit too (the recording comes back).
    expect(classifyEdit(next, lowered({ data: next.data }), false)).toEqual([
      { type: 'SET_TWEEN_EDITS', edits: [] },
    ])
    // Same reference: nothing to send.
    expect(
      classifyEdit(
        next,
        lowered({ data: next.data, tweenEdits: next.tweenEdits }),
        false,
      ),
    ).toEqual([])
  })

  it('a stack rides the LOAD, and an entry whose data changed gets its own SET_DATA', () => {
    const hud = { text: 'a' }
    const prev = lowered({ stack: { hud, sub: { on: true } } })
    expect(classifyEdit(null, prev, false)).toEqual([
      { type: 'LOAD', code: 'PROGRAM_A', data: prev.data, stack: prev.stack },
    ])
    const next = lowered({
      data: prev.data,
      stack: { hud, sub: { on: false } },
    })
    expect(classifyEdit(prev, next, false)).toEqual([
      { type: 'SET_DATA', data: { on: false }, target: 'sub' },
    ])
    // Untouched entries and untouched main data send nothing.
    expect(
      classifyEdit(
        next,
        lowered({ data: next.data, stack: next.stack }),
        false,
      ),
    ).toEqual([])
  })

  it('first delivery is a LOAD carrying the data', () => {
    const next = lowered()
    expect(classifyEdit(null, next, false)).toEqual([
      { type: 'LOAD', code: 'PROGRAM_A', data: next.data },
    ])
  })

  it('program change is a warm LOAD (T3), regardless of data/duration', () => {
    const next = lowered({
      program: 'PROGRAM_B',
      data: { padding: 99 },
      duration: 9,
    })
    expect(classifyEdit(lowered(), next, true)).toEqual([
      { type: 'LOAD', code: 'PROGRAM_B', data: next.data },
    ])
  })

  it('data-only change is a live SET_DATA (T2)', () => {
    const next = lowered({ data: { padding: 20 } })
    expect(classifyEdit(lowered(), next, false)).toEqual([
      { type: 'SET_DATA', data: next.data },
    ])
  })

  it('identical delivery is a no-op', () => {
    const prev = lowered()
    expect(classifyEdit(prev, prev, true)).toEqual([])
  })

  it('trim = SET_DATA then SET_DURATION when the program supports it (T2.5)', () => {
    const next = lowered({ data: { padding: 10 }, duration: 3 })
    expect(classifyEdit(lowered(), next, true)).toEqual([
      { type: 'SET_DATA', data: next.data },
      { type: 'SET_DURATION', value: 3 },
    ])
  })

  it('duration change without setDuration support falls back to one warm LOAD', () => {
    const next = lowered({ duration: 3 })
    expect(classifyEdit(lowered(), next, false)).toEqual([
      { type: 'LOAD', code: 'PROGRAM_A', data: next.data },
    ])
  })

  it('ignores duration when either side does not manage it', () => {
    const prev = lowered({ duration: undefined })
    const next = lowered({ duration: 3, data: prev.data })
    expect(classifyEdit(prev, next, true)).toEqual([])
  })

  it('tolerates float noise in duration', () => {
    const prev = lowered()
    const next = { ...prev, duration: 5 + 1e-9 }
    expect(classifyEdit(prev, next, true)).toEqual([])
  })
})
