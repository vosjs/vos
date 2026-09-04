import { describe, expect, it } from 'vitest'
import { composeSheet, resample, rolesFor, winRate } from '../judge'
import type { Rgba } from '../picture'

function raster(w: number, h: number, fill: [number, number, number]): Rgba {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = 255
  }
  return { w, h, data }
}

describe('the judge sheet', () => {
  it('sits two pictures at one height with a gutter and marks the order', () => {
    const left = raster(1400, 560, [10, 10, 10])
    const right = raster(1266, 692, [250, 250, 250])
    const sheet = composeSheet(left, right, 300, 20)
    const lw = Math.round((1400 * 300) / 560)
    const rw = Math.round((1266 * 300) / 692)
    expect(sheet.w).toBe(24 * 2 + lw + 20 + rw)
    expect(sheet.h).toBe(24 * 2 + 300 + 8 + 6)
    const px = (x: number, y: number) => sheet.data[(y * sheet.w + x) * 4]
    expect(px(24 + 10, 24 + 10)).toBe(10) // the left picture
    expect(px(24 + lw + 20 + 10, 24 + 10)).toBe(250) // the right picture
    expect(px(24 + lw + 10, 24 + 10)).toBe(240) // the gutter is the plate
    expect(px(24 + 10, 24 + 300 + 8)).toBe(40) // the dark band under the left
    expect(px(24 + lw + 20 + 10, 24 + 300 + 8)).toBe(200) // the light band under the right
  })

  it('resample box-filters a downscale', () => {
    const img = raster(4, 2, [0, 0, 0])
    img.data[0] = 200 // one bright pixel top-left
    const small = resample(img, 2, 1)
    expect(small.w).toBe(2)
    expect(small.data[0]).toBe(50) // (200 + 0 + 0 + 0) / 4
  })
})

describe('roles and the win rate', () => {
  it('a template card matches its family; a video its clip references; a take card the scene layouts', () => {
    expect(rolesFor({ destination: 'og-card', source: 'poster', template: 'split-cover', path: 'og-card.png' })).toEqual(['split-cover'])
    expect(rolesFor({ destination: 'x-feed-cut', path: 'x-feed-cut.mp4' })).toContain('feature-clip')
    expect(rolesFor({ destination: 'shorts-linkedin-vertical-cut', path: 'v.mp4' })).not.toContain('feature-clip-dark')
    expect(rolesFor({ destination: 'cws-marquee', path: 'cws-marquee.png' })).toContain('window-in-scene')
    expect(rolesFor({ destination: 'cws-screenshot', path: 'x.png' })).toContain('framed-screenshot')
  })

  it('the win rate counts judged pairs only', () => {
    expect(winRate([{ win: true }, { win: false }, { win: null }, { win: true }])).toEqual({ wins: 2, judged: 3, rate: 2 / 3 })
    expect(winRate([{ win: null }])).toEqual({ wins: 0, judged: 0, rate: null })
  })
})
