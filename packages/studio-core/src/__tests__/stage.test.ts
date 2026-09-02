import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_Z,
  CARD_FOV,
  CARD_Z,
  OVERLAY_Z,
  cardPointToScreen,
  planeSizeAtDepth,
} from '../stage'

describe('stage geometry (compositor v2 V0 world-unit basis)', () => {
  it('plane height subtends the full vertical FOV at the given depth', () => {
    // height = 2 · |d| · tan(fov/2). At fov 30°, d 4 → 2·4·tan(15°).
    const { height } = planeSizeAtDepth(CARD_Z, CARD_FOV, 16 / 9)
    expect(height).toBeCloseTo(2 * 4 * Math.tan((15 * Math.PI) / 180), 6)
  })

  it('width follows the viewport aspect', () => {
    const { width, height } = planeSizeAtDepth(CARD_Z, CARD_FOV, 16 / 9)
    expect(width / height).toBeCloseTo(16 / 9, 9)
  })

  it('a square viewport gives a square plane', () => {
    const { width, height } = planeSizeAtDepth(-3, 45, 1)
    expect(width).toBeCloseTo(height, 9)
  })

  it('size scales linearly with depth (so every layer fills the frustum)', () => {
    const near = planeSizeAtDepth(OVERLAY_Z, CARD_FOV, 16 / 9) // -2
    const far = planeSizeAtDepth(BACKGROUND_Z, CARD_FOV, 16 / 9) // -6
    // A plane 3× farther is 3× larger → both subtend the identical screen rect.
    expect(far.height / near.height).toBeCloseTo(BACKGROUND_Z / OVERLAY_Z, 9)
    expect(far.width / near.width).toBeCloseTo(3, 9)
  })

  it('treats depth sign-agnostically (|distance|)', () => {
    expect(planeSizeAtDepth(4, CARD_FOV, 1.5)).toEqual(
      planeSizeAtDepth(-4, CARD_FOV, 1.5),
    )
  })

  it('layer order is background behind, card between, overlay in front', () => {
    // Camera at origin looks down −z: a MORE-negative z is farther away.
    expect(BACKGROUND_Z).toBeLessThan(CARD_Z)
    expect(CARD_Z).toBeLessThan(OVERLAY_Z)
    expect(OVERLAY_Z).toBeLessThan(0)
  })

  it('card projection is the identity at tilt 0 (fills the viewport)', () => {
    expect(cardPointToScreen(0, 0)).toEqual({ sx: 0, sy: 0 })
    expect(cardPointToScreen(0.5, 0.5)).toEqual({ sx: 0.5, sy: 0.5 })
    expect(cardPointToScreen(1, 1)).toEqual({ sx: 1, sy: 1 })
  })
})
