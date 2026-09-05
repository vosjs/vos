import { describe, expect, it } from 'vitest'
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Vector2,
} from 'three'
import {
  BACKGROUND_Z,
  CARD_FOV,
  CARD_OVERSCAN_MAX,
  CARD_OVERSCAN_STEP,
  CARD_Z,
  OVERLAY_Z,
  cardOverscanFor,
  cardPointToScreen,
  cardVisibleExtent,
  planeSizeAtDepth,
  quantiseOverscan,
} from '../stage'
import type { CardPose } from '../stage'
import { lerpArray, sample } from '@vosjs/timeline'
import { cardPoseTrack, entranceTiltKeyframes } from '../lower/motion'

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

/**
 * The frame's four corners, raycast through a real three.js perspective
 * camera onto a real posed plane mesh, read back in the plane's local
 * units: the ground truth `cardVisibleExtent` must reproduce.
 */
function raycastExtent(pose: CardPose, aspect: number) {
  const cam = new PerspectiveCamera(CARD_FOV, aspect, 0.1, 100)
  cam.position.set(0, 0, 0)
  cam.updateMatrixWorld()
  const { width, height } = planeSizeAtDepth(CARD_Z, CARD_FOV, aspect)
  // A plane far larger than the frame, so every corner ray that points at
  // the plane meets it; only a ray that never does comes back as a miss.
  const mesh = new Mesh(new PlaneGeometry(1e6, 1e6), new MeshBasicMaterial())
  const sc = pose.scale ?? 1
  mesh.position.set(0, (pose.dy ?? 0) * height, CARD_Z)
  mesh.rotation.set((pose.rx * Math.PI) / 180, (pose.ry * Math.PI) / 180, 0)
  mesh.scale.set(sc, sc, 1)
  mesh.updateMatrixWorld()
  const ray = new Raycaster()
  let left = 0
  let right = 0
  let top = 0
  let bottom = 0
  for (const kx of [-1, 1]) {
    for (const ky of [-1, 1]) {
      ray.setFromCamera(new Vector2(kx, ky), cam)
      const hit = ray.intersectObject(mesh)[0]
      if (!hit) {
        left = right = top = bottom = CARD_OVERSCAN_MAX
        continue
      }
      const local = mesh.worldToLocal(hit.point.clone())
      left = Math.max(left, -local.x / (width / 2))
      right = Math.max(right, local.x / (width / 2))
      top = Math.max(top, local.y / (height / 2))
      bottom = Math.max(bottom, -local.y / (height / 2))
    }
  }
  return { left, right, top, bottom }
}

const POSES: CardPose[] = [
  { rx: 0, ry: 0 },
  { rx: 6, ry: -9 },
  { rx: -9, ry: 14 },
  { rx: 20, ry: 0 },
  { rx: 0, ry: -30 },
  { rx: 12, ry: 12, scale: 0.9, dy: -0.02 },
  { rx: 0, ry: 0, scale: 0.94, dy: 0.05 },
  { rx: 45, ry: 45 },
]

describe('cardVisibleExtent (the card layer overscan geometry)', () => {
  it('is the identity for a card at rest', () => {
    expect(cardVisibleExtent({ rx: 0, ry: 0 }, 16 / 9)).toEqual({
      left: 1,
      right: 1,
      top: 1,
      bottom: 1,
    })
  })

  it.each(POSES)(
    'reproduces a three.js raycast onto the posed plane: %o',
    (pose) => {
      for (const aspect of [16 / 9, 1, 9 / 16, 21 / 9]) {
        const want = raycastExtent(pose, aspect)
        const got = cardVisibleExtent(pose, aspect)
        for (const side of ['left', 'right', 'top', 'bottom'] as const)
          expect(got[side]).toBeCloseTo(
            Math.min(CARD_OVERSCAN_MAX, want[side]),
            6,
          )
      }
    },
  )

  it('shows more plane on the receding side and less on the approaching one', () => {
    // +ry brings the LEFT edge toward the camera: the right side recedes.
    const e = cardVisibleExtent({ rx: 0, ry: 9 }, 16 / 9)
    expect(e.right).toBeGreaterThan(1)
    expect(e.left).toBeLessThan(1)
    expect(e.top).toBeGreaterThan(1) // the receding corner sits past the top too
    // 9° on a 16:9 frame at the stage's FOV: about 9% past the edge.
    expect(e.right).toBeCloseTo(1.095, 2)
  })

  it('grows with the lean, with a smaller card and with a rise', () => {
    const at = (p: CardPose) => cardVisibleExtent(p, 16 / 9)
    expect(at({ rx: 0, ry: 18 }).right).toBeGreaterThan(
      at({ rx: 0, ry: 9 }).right,
    )
    expect(at({ rx: 0, ry: 0, scale: 0.9 }).right).toBeCloseTo(1 / 0.9, 6)
    expect(at({ rx: 0, ry: 0, dy: 0.05 }).bottom).toBeCloseTo(1.1, 6)
  })

  it('caps a corner whose ray never meets the plane', () => {
    const e = cardVisibleExtent({ rx: 0, ry: 89 }, 21 / 9)
    expect(e.right).toBe(CARD_OVERSCAN_MAX)
  })
})

describe('cardOverscanFor (the budget over the two tracks)', () => {
  it('is [1, 1] for a card that never moves', () => {
    expect(cardOverscanFor(undefined, undefined, 16 / 9)).toEqual([1, 1])
    expect(
      cardOverscanFor({ keyframes: [{ value: [0, 0] }] }, null, 16 / 9),
    ).toEqual([1, 1])
  })

  it('quantises up in steps and never below 1', () => {
    expect(quantiseOverscan(1)).toBe(1)
    expect(quantiseOverscan(0.5)).toBe(1)
    expect(quantiseOverscan(1.001)).toBe(1.05)
    expect(quantiseOverscan(1.095)).toBe(1.1)
    expect(quantiseOverscan(1.1)).toBe(1.15) // a hair over the step lands above
    expect(quantiseOverscan(99)).toBe(CARD_OVERSCAN_MAX)
    expect(CARD_OVERSCAN_STEP).toBe(0.05)
  })

  it('covers the reported case: a 6°/-9° lean on a 16:9 frame', () => {
    const tilt = {
      keyframes: [{ value: [0, 0] }, { value: [6, -9] }, { value: [0, 0] }],
    }
    const [kx, ky] = cardOverscanFor(tilt, null, 16 / 9)
    // The corner that recedes on BOTH axes sits farther from the camera,
    // so each axis compounds the other's: past 1.1 wide, past 1.15 tall.
    expect(kx).toBe(1.15)
    expect(ky).toBe(1.2)
    const e = cardVisibleExtent({ rx: 6, ry: -9 }, 16 / 9)
    expect(Math.max(e.left, e.right)).toBeLessThanOrEqual(kx)
    expect(Math.max(e.top, e.bottom)).toBeLessThanOrEqual(ky)
  })

  it('bounds every interpolated frame of real entrance + end-card tracks', () => {
    const tilt = { keyframes: entranceTiltKeyframes({ kind: 'tilt-in' }) }
    const pose = cardPoseTrack({ kind: 'rise' }, 5, 2.5)!
    for (const aspect of [16 / 9, 1, 9 / 16]) {
      const [kx, ky] = cardOverscanFor(tilt, pose, aspect)
      for (let t = 0; t <= 8; t += 0.02) {
        const tv = sample(tilt, t, lerpArray)
        const pv = sample(pose, t, lerpArray)
        const e = cardVisibleExtent(
          { rx: tv[0], ry: tv[1], scale: pv[0], dy: pv[1] },
          aspect,
        )
        expect(Math.max(e.left, e.right)).toBeLessThanOrEqual(kx)
        expect(Math.max(e.top, e.bottom)).toBeLessThanOrEqual(ky)
      }
    }
  })
})
