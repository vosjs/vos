import { describe, expect, it } from 'vitest'
import { calculatePosition } from '../renderElements'

const RES = { width: 1920, height: 1080 }

describe('calculatePosition', () => {
  it('reads an {x, y} position as the box top-left when no anchor is set', () => {
    expect(calculatePosition({ x: '50%', y: '80%' }, RES, 400, 40)).toEqual({
      x: 960,
      y: 864,
    })
  })

  it('centres the box on the point when anchor is center', () => {
    expect(
      calculatePosition({ x: '50%', y: '80%' }, RES, 400, 40, 'center'),
    ).toEqual({ x: 760, y: 844 })
  })

  it('puts the named corner or edge on the point', () => {
    const at = { x: 1000, y: 500 }
    expect(calculatePosition(at, RES, 200, 100, 'bottom-right')).toEqual({
      x: 800,
      y: 400,
    })
    expect(calculatePosition(at, RES, 200, 100, 'top')).toEqual({
      x: 900,
      y: 500,
    })
    expect(calculatePosition(at, RES, 200, 100, 'left')).toEqual({
      x: 1000,
      y: 450,
    })
  })

  it('leaves a preset alone: it already places the whole box', () => {
    expect(calculatePosition('center', RES, 200, 100, 'top-left')).toEqual(
      calculatePosition('center', RES, 200, 100),
    )
  })
})
