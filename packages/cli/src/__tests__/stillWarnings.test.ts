import { describe, expect, it } from 'vitest'
import { stillWarnings } from '../render'

describe('a still is checked before anyone looks at it', () => {
  it('says a fully transparent frame, naming alpha as the likely cause', () => {
    const w = stillWarnings({ transparent: true, flat: true }, [])
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/fully transparent/)
    expect(w[0]).toMatch(/blend/)
  })

  it('says a flat frame that is not transparent', () => {
    const w = stillWarnings({ transparent: false, flat: true }, [])
    expect(w).toEqual([expect.stringMatching(/single flat colour/)])
  })

  it('passes a picture, and says what the page threw', () => {
    expect(stillWarnings({ transparent: false, flat: false }, [])).toEqual([])
    const w = stillWarnings({ transparent: false, flat: false }, [
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
    expect(w).toEqual([
      'the page threw: a',
      'the page threw: b',
      'the page threw: c',
      'the page threw 2 more errors',
    ])
  })
})
