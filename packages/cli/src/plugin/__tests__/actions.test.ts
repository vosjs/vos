import { describe, expect, it } from 'vitest'
import { validateActions } from '../actions'

describe('validateActions', () => {
  it('accepts a full-vocabulary script', () => {
    expect(
      validateActions({
        url: 'https://example.com',
        viewport: { width: 1280, height: 720 },
        steps: [
          { do: 'wait', ms: 500 },
          { do: 'hover', selector: 'a', ms: 700 },
          { do: 'click', selector: 'button' },
          { do: 'type', selector: 'input', text: 'hi' },
          { do: 'scroll', dy: 400 },
          { do: 'move', x: 100, y: 200 },
        ],
      }),
    ).toEqual([])
  })

  it('rejects unknown verbs and missing fields with positions', () => {
    const errors = validateActions({
      steps: [{ do: 'fly' }, { do: 'click' }, { do: 'wait' }],
    })
    expect(errors.some((e) => e.includes('steps[0]'))).toBe(true)
    expect(
      errors.some((e) => e.includes('steps[1]') && e.includes('selector')),
    ).toBe(true)
    expect(errors.some((e) => e.includes('steps[2]') && e.includes('ms'))).toBe(
      true,
    )
  })

  it('rejects empty steps and non-objects', () => {
    expect(validateActions(null)).toHaveLength(1)
    expect(validateActions({ steps: [] })).toEqual([
      'steps must be a non-empty array',
    ])
  })

  // A step id is an anchor's identity — optional, but when present it
  // must be a real string and unique, or a re-anchor cannot tell steps apart.
  it('accepts unique step ids and rejects empty or duplicate ones', () => {
    expect(
      validateActions({
        steps: [
          { do: 'wait', ms: 100, id: 'settle' },
          { do: 'click', selector: '#go', id: 'cta' },
        ],
      }),
    ).toEqual([])
    const bad = validateActions({
      steps: [
        { do: 'wait', ms: 100, id: '' },
        { do: 'click', selector: '#a', id: 'cta' },
        { do: 'click', selector: '#b', id: 'cta' },
      ],
    })
    expect(bad.some((e) => e.includes('steps[0]') && e.includes('id'))).toBe(
      true,
    )
    expect(
      bad.some((e) => e.includes('steps[2]') && e.includes('duplicate')),
    ).toBe(true)
  })
})
