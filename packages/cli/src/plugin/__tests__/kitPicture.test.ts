import { describe, expect, it } from 'vitest'
import {
  apcaContrast,
  duplicateFindings,
  stillFindings,
} from '../kitPicture'
import { differenceHash, measureStill } from '../picture'
import type { PictureAsset } from '../kitPicture'
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

function rect(img: Rgba, x: number, y: number, w: number, h: number, c: [number, number, number]) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue
      const o = (yy * img.w + xx) * 4
      img.data[o] = c[0]
      img.data[o + 1] = c[1]
      img.data[o + 2] = c[2]
    }
}

/** Dense "UI" inside a rect: enough ink to read as a populated page. */
function populate(img: Rgba, x: number, y: number, w: number, h: number) {
  for (let i = 0; i < 160; i++) {
    const rx = x + ((i * 37) % Math.max(1, w - 24))
    const ry = y + ((i * 53) % Math.max(1, h - 14))
    rect(img, rx, ry, 18, 8, i % 3 ? [40, 40, 40] : [60, 120, 220])
  }
}

const SAFE = { x: 0.05, y: 0.08, w: 0.9, h: 0.84 }
const card = (over: Partial<PictureAsset> = {}): PictureAsset => ({
  destination: 'og-card',
  path: 'og-card.png',
  file: '/x/og-card.png',
  spec: { genre: 'card', kind: 'still', text: 'expected', safe: SAFE, px: { w: 600, h: 315 } },
  ...over,
})

/** A soft shadow under a card: the delta from the ground fades over `len` rows. */
function shadowBand(img: Rgba, x: number, y: number, w: number, len: number, ground: [number, number, number]) {
  for (let i = 0; i < len; i++) {
    const k = Math.round(50 * (1 - i / len))
    rect(img, x, y + i, w, 1, [ground[0] - k, ground[1] - k, ground[2] - k])
  }
}

/** The plate look: a populated card at 80% on a cream ground with a soft shadow. */
function goodCard(): Rgba {
  const img = raster(600, 315, [240, 242, 244])
  rect(img, 60, 40, 480, 240, [255, 255, 255])
  shadowBand(img, 60, 280, 480, 24, [240, 242, 244])
  populate(img, 70, 50, 460, 220)
  return img
}

describe('stillFindings on a card', () => {
  it('a card in the band, populated and separated, has no finding', () => {
    const img = goodCard()
    expect(stillFindings(card(), img, measureStill(img))).toEqual([])
  })

  it('a crop on all four sides is a subject finding; a wallpaper is blank too', () => {
    const img = raster(600, 315, [4, 6, 60])
    for (let i = 0; i < 30; i++) rect(img, (i * 41) % 590, (i * 67) % 305, 3, 3, [230, 230, 255])
    rect(img, 0, 0, 3, 3, [230, 230, 255])
    rect(img, 597, 312, 3, 3, [230, 230, 255])
    const codes = stillFindings(card(), img, measureStill(img)).map((f) => f.code)
    expect(codes).toContain('subject')
    expect(codes).toContain('blank')
  })

  it('a light card on a light ground with no shadow dissolves: separation', () => {
    const img = raster(600, 315, [240, 238, 229])
    rect(img, 60, 40, 480, 240, [246, 245, 240])
    populate(img, 70, 50, 460, 220)
    const f = stillFindings(card(), img, measureStill(img))
    expect(f.map((x) => x.code)).toContain('separation')
    expect(f.find((x) => x.code === 'separation')!.fixHint).toMatch(/contact shadow/)
  })

  it('a card off the band is a subject finding with its width in the message', () => {
    const img = raster(600, 315, [240, 242, 244])
    rect(img, 210, 100, 180, 100, [255, 255, 255])
    populate(img, 215, 105, 170, 90)
    const f = stillFindings(card(), img, measureStill(img)).find((x) => x.code === 'subject')
    expect(f).toBeDefined()
    expect(f!.message).toMatch(/the card is (2\d|30)% of the width/)
  })

  it('a composed screenshot is a subject finding; the picture alone never says so', () => {
    const img = goodCard()
    const spec = { genre: 'screenshot' as const, kind: 'still-set' as const, text: 'none' as const, safe: { x: 0, y: 0, w: 1, h: 1 }, px: { w: 600, h: 315 } }
    const composed = card({ destination: 'cws-screenshot', spec, composed: true })
    expect(stillFindings(composed, img, measureStill(img)).map((f) => f.code)).toContain('subject')
    const plain = card({ destination: 'cws-screenshot', spec })
    expect(stillFindings(plain, img, measureStill(img)).map((f) => f.code)).not.toContain('subject')
  })
})

describe('text boxes', () => {
  it('sliced, outside the safe rect, and low contrast are each named', () => {
    const img = goodCard()
    rect(img, 0, 250, 600, 65, [250, 250, 250]) // a light strip the text sits on
    const f = stillFindings(
      card({
        text: [
          { x: 0.7, y: 0.85, w: 0.5, h: 0.1, label: 'Ship v2', color: '#111111' },
          { x: 0.02, y: 0.85, w: 0.3, h: 0.1, label: 'kicker', color: '#dddddd' },
        ],
      }),
      img,
      measureStill(img),
    )
    const codes = f.map((x) => `${x.code}:${x.message.split('"')[1]}`)
    expect(codes).toContain('sliced:Ship v2')
    expect(codes).toContain('safe:kicker')
    expect(codes).toContain('contrast:kicker')
    expect(codes).not.toContain('contrast:Ship v2')
  })

  it('a destination that wants no text and got some is said', () => {
    const img = goodCard()
    const tile = card({
      destination: 'cws-small-promo-tile',
      spec: { genre: 'card', kind: 'still', text: 'none', safe: { x: 0, y: 0, w: 1, h: 1 }, px: { w: 600, h: 315 } },
      text: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }],
    })
    expect(stillFindings(tile, img, measureStill(img)).some((f) => f.code === 'safe' && /wants no text/.test(f.message))).toBe(true)
  })
})

describe('duplicates and APCA', () => {
  it('stills that hash alike form one duplicate group naming every member', () => {
    const a = goodCard()
    const b = goodCard()
    const c = raster(600, 315, [240, 242, 244])
    populate(c, 0, 0, 600, 315)
    const f = duplicateFindings([
      { destination: 'og-card', hash: differenceHash(a), time: 4.4, genre: 'card' },
      { destination: 'x-feed-image', hash: differenceHash(b), time: 4.4, genre: 'card' },
      { destination: 'linkedin-feed-image', hash: differenceHash(c), time: 9, genre: 'card' },
      { destination: 'cws-screenshot', hash: differenceHash(a), time: 4.4, genre: 'screenshot' },
      { destination: 'producthunt-gallery', hash: differenceHash(a), time: 4.4, genre: 'screenshot' },
    ])
    expect(f).toHaveLength(1)
    expect(f[0].asset).toBe('og-card, x-feed-image')
    expect(f[0].severity).toBe('warning')
    expect(f[0].message).toMatch(/2 assets share one frame \(4.40s\)/)
    const three = duplicateFindings([
      { destination: 'og-card', hash: differenceHash(a), time: 4.4, genre: 'card' },
      { destination: 'x-feed-image', hash: differenceHash(b), time: 4.4, genre: 'card' },
      { destination: 'cws-marquee', hash: differenceHash(a), time: 4.4, genre: 'card' },
    ])
    expect(three[0].severity).toBe('error')
  })

  it('APCA reads black on white near 106 and grey on grey near nothing', () => {
    expect(apcaContrast([0, 0, 0], [255, 255, 255])).toBeGreaterThan(100)
    expect(apcaContrast([255, 255, 255], [0, 0, 0])).toBeGreaterThan(100)
    expect(apcaContrast([200, 200, 200], [220, 220, 220])).toBeLessThan(15)
    expect(apcaContrast([17, 17, 17], [240, 242, 244])).toBeGreaterThan(90)
  })
})
