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
  it('first delivery is a LOAD carrying the data', () => {
    const next = lowered()
    expect(classifyEdit(null, next, false)).toEqual([
      { type: 'LOAD', code: 'PROGRAM_A', data: next.data },
    ])
  })

  it('program change is a warm LOAD (T3), regardless of data/duration', () => {
    const next = lowered({ program: 'PROGRAM_B', data: { padding: 99 }, duration: 9 })
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
