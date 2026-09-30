import { describe, expect, it } from 'vitest'
import { programStillTime } from '../lower/lowerStudioDoc'
import type { ProgramAnchorDoc } from '../doc/studioDoc'

// A program document declares its cover the way a take does, in output
// seconds; without one the host keeps its own default.

const prog = (still?: number, speed?: ProgramAnchorDoc['speed']) =>
  ({
    program: { config: { version: 2, duration: 4 } },
    audio: [],
    ...(still === undefined ? {} : { still }),
    ...(speed ? { speed } : {}),
  }) as ProgramAnchorDoc

describe('programStillTime', () => {
  it('reads the declared second, clamped to the program', () => {
    expect(programStillTime(prog(1.5))).toBe(1.5)
    expect(programStillTime(prog(9))).toBe(4)
    expect(programStillTime(prog(-1))).toBe(0)
  })

  it('clamps to the OUTPUT length once the program is retimed', () => {
    // The whole 4 s program at double speed plays in 2 s.
    const fast = prog(3, [{ id: 's', in: 0, out: 4, rate: 2 }] as never)
    expect(programStillTime(fast)).toBe(2)
  })

  it('says nothing when none is declared, so the host keeps its default', () => {
    expect(programStillTime(prog())).toBeNull()
  })
})
