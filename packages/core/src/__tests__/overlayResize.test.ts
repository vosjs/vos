import { describe, expect, it } from 'vitest'
import { generateResizeHandler } from '../compiler/generators/generateResizeHandler'
import type { VosConfig } from '../types'

// Runs the generated resize handler against stubs: the canvas laid out at
// 1920×1080 is then resized, and the overlay frustum must keep the world the
// elements were placed in, or they keep their old pixel size in a smaller
// frame and are cropped.
function resizeTo(preset: string, w: number, h: number) {
  const cam = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    aspect: 1,
    updateProjectionMatrix() {},
  }
  const overlayCamera = { ...cam }
  let handler: (() => void) | null = null
  const win = {
    innerWidth: w,
    innerHeight: h,
    addEventListener: (_: string, fn: () => void) => (handler = fn),
  }
  const renderer = {
    setSize() {},
    capabilities: { getMaxAnisotropy: () => 1, maxTextureSize: 4096 },
  }
  const code = generateResizeHandler({
    camera: { preset },
  } as unknown as VosConfig)
  new Function(
    'window',
    'container',
    'renderer',
    'camera',
    'overlayCamera',
    'pixelRatio',
    'width',
    'height',
    'elements',
    'content',
    code,
  )(
    win,
    { clientWidth: w, clientHeight: h },
    renderer,
    cam,
    overlayCamera,
    1,
    1920,
    1080,
    new Map(),
    null,
  )
  handler!()
  return overlayCamera
}

describe('overlay camera on resize', () => {
  for (const preset of ['fullscreen', 'perspective', 'orthographic']) {
    it(`${preset}: holds the layout frame at the same aspect`, () => {
      const c = resizeTo(preset, 960, 540)
      expect([c.left, c.right, c.top, c.bottom]).toEqual([-960, 960, 540, -540])
    })
  }

  it('keeps the layout height and follows a new aspect, centred', () => {
    const c = resizeTo('fullscreen', 1000, 1000)
    expect([c.left, c.right, c.top, c.bottom]).toEqual([-540, 540, 540, -540])
  })
})
