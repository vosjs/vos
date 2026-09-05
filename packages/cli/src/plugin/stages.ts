/**
 * A STAGE template composes a card from the take itself: the recording's
 * card is already a perspective plane with real chrome, a radius, two
 * shadow layers and a cover crop, so the split cover's shot is the window
 * leaning in a tilt pose on the brand's ground, bled off the right and the
 * bottom, with the headline column as text overlays at left. Everything
 * is a doc override for one still, and the picture checks read the shot
 * rect and the text boxes it reports. Pure.
 */
import type { TextBox } from './kitPicture'

export interface StageInput {
  /** The destination's pixels. */
  size: { w: number; h: number }
  /** The words and the brand's roles (posterValues' output). */
  values: Record<string, unknown>
  /** The take's source seconds, so the tilt pose spans the whole cut. */
  sourceSeconds: number
  /** The cut's output seconds, so the words span the whole cut. */
  outputSeconds: number
  /**
   * The destination's text policy: a destination that wants NO words (a
   * thumbnail the picture carries alone) gets the crop only, larger.
   */
  text?: 'none' | 'allowed' | 'expected'
  /** The footage's aspect (width over height; 16:9 when unknown), so a tile's crop box matches it and cover crops nothing it meant to show. */
  footageAspect?: number
}

export interface StageResult {
  set: string[]
  text: TextBox[]
  /** Where the card sits, fractions of the frame (a bleed runs past 1). */
  shot: { x: number; y: number; w: number; h: number }
}

const str = (v: unknown, fallback: string) =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback

/** The stack's first family name, for an overlay clip's `family`. */
const firstFamily = (stack: string) =>
  stack.split(',')[0].replace(/['"]/g, '').trim()

/**
 * The split cover as a stage. Landscape: the card at 60% of the width in
 * the right column, leaning (top edge and left edge toward the camera),
 * bled off the right and the bottom (the card layer overscans by what a
 * lean can show, so the lean never reveals the texture's edge),
 * cover-cropped to the page's top-left; the kicker, the headline (the
 * brand's display face) and the wordmark at 7%. Square and portrait:
 * the words above, the card below, bled off the bottom.
 */
export function stageSplitCover(input: StageInput): StageResult {
  const R = input.size.w / Math.max(1, input.size.h)
  const portrait = R < 0.87
  const square = !portrait && R <= 1.15
  const v = input.values
  const ground = `linear-gradient(135deg, ${str(v.bgA, '#8a3d2a')}, ${str(v.bgC, str(v.bgB, '#5c5a2e'))})`
  const ink = str(v.ink, '#fff6ec')
  const inkSoft = str(v.inkSoft, ink)
  const display = firstFamily(str(v.fontDisplay, 'Lexend'))
  const body = firstFamily(str(v.fontBody, 'Lexend'))
  const headline = str(v.headline, '')
  const kicker = str(v.kicker, '')
  const brand = str(v.brand, '')

  const inset = portrait
    ? { left: 0.08, right: -0.08, top: 0.44, bottom: -0.1 }
    : square
      ? { left: 0.1, right: -0.1, top: 0.5, bottom: -0.12 }
      : { left: 0.44, right: -0.06, top: 0.3, bottom: -0.12 }
  const shot = {
    x: inset.left,
    y: inset.top,
    w: 1 - inset.left - inset.right,
    h: 1 - inset.top - inset.bottom,
  }
  const set: string[] = [
    `frame.background=${JSON.stringify(ground)}`,
    'frame.backgroundMedia=null',
    'frame.fit=cover',
    `frame.inset=${JSON.stringify(inset)}`,
    'frame.focus={"cx":0,"cy":0}',
    'frame.radius=16',
    'frame.shadow=0.5',
    'frame.shadowContact=0',
    'frame.border=0',
    'zoom=[]',
    `tilt=[{"id":"stage","in":0,"out":${input.sourceSeconds.toFixed(3)},"rx":3,"ry":${portrait || square ? 0 : 10}}]`,
    'cursor.visible=false',
    'cursor.clickFx.style=none',
  ]

  // The words: overlays centred at x, so a left column's centre is its
  // left edge plus half its widest line (estimated from the glyph count).
  const designW = (1080 * input.size.w) / input.size.h
  const boxes: TextBox[] = []
  const clips: Record<string, unknown>[] = []
  const column = portrait || square ? 0.84 : 0.36
  const left = portrait || square ? 0.08 : 0.07
  const size = portrait ? 60 : square ? 68 : 84
  const word = (
    id: string,
    text: string,
    preset: 'title' | 'caption' | 'label',
    family: string,
    px: number,
    y: number,
    color: string,
    extra: Record<string, unknown>,
    role: TextBox['role'],
    x0 = left,
  ) => {
    if (!text) return
    const lines = text.split('\n')
    const longest = Math.max(...lines.map((l) => l.length))
    const widest = Math.min(
      column,
      (longest * px * (preset === 'title' ? 0.5 : 0.62)) / designW,
    )
    const lh = preset === 'title' ? 1.05 : 1.2
    const h = (lines.length * px * lh) / 1080
    clips.push({
      id,
      kind: 'text',
      text,
      preset,
      family,
      size: px,
      color,
      align: 'left',
      maxWidth: column,
      lineHeight: lh,
      transform: { x: x0 + widest / 2, y, scale: 1, rotation: 0 },
      // Words on the ground carry no footage shadow: a drop shadow under a
      // headline on a plate is the old-web tell.
      shadow: 0,
      start: 0,
      duration: +input.outputSeconds.toFixed(3),
      enter: 'none',
      exit: 'none',
      ...extra,
    })
    boxes.push({
      x: x0,
      y: y - h / 2,
      w: widest,
      h,
      color,
      role,
      label: text.length > 24 ? `${text.slice(0, 24)}…` : text,
    })
  }
  // The brand's MARK as an image beside the wordmark (the site's own
  // lockup: the mark at 1.3 times the word's size, a gap of half the
  // size); a wide mark (a stylised wordmark asset) is the wordmark.
  const markKey = str(v.logoKey, '')
  const markAspect =
    typeof v.logoAspect === 'number' && v.logoAspect > 0 ? v.logoAspect : 1
  const wideMark = !!markKey && markAspect > 2.2
  const lockup = (px: number, y: number): number => {
    if (!markKey) return left
    const hPx = wideMark ? px * 1.6 : px * 1.3
    const w = Math.min(column, (hPx * markAspect) / designW)
    clips.push({
      id: 'stage-mark',
      kind: 'image',
      key: markKey,
      width: +w.toFixed(4),
      radius: 0,
      shadow: 'none',
      transform: { x: left + w / 2, y, scale: 1, rotation: 0 },
      start: 0,
      duration: +input.outputSeconds.toFixed(3),
      enter: 'none',
      exit: 'none',
    })
    return left + w + (px * 0.5) / designW
  }
  const kickerY = portrait ? 0.1 : square ? 0.12 : 0.24
  const titleY = portrait ? 0.24 : square ? 0.28 : 0.46
  const brandY = portrait ? 0.94 : square ? 0.94 : 0.86
  word(
    'stage-kicker',
    kicker,
    'label',
    'JetBrains Mono',
    19,
    kickerY,
    inkSoft,
    { letterSpacing: 6, weight: 400 },
    'body',
  )
  // The headline is the brand's DISPLAY face, set tight (-2% tracking at
  // display sizes, the modern grotesk convention).
  word(
    'stage-title',
    headline,
    'title',
    display,
    size,
    titleY,
    ink,
    { weight: 600, letterSpacing: -Math.round(size * 0.02) },
    'headline',
  )
  const brandX = lockup(25, brandY)
  if (!wideMark)
    word(
      'stage-brand',
      brand,
      'label',
      body,
      25,
      brandY,
      ink,
      { weight: 700, letterSpacing: 1 },
      'body',
      brandX,
    )
  set.push(`overlays=${JSON.stringify(clips)}`)
  return { set, text: boxes, shot }
}

/**
 * A destination whose long side is under this many pixels is a TILE (the
 * store's 440x280 small promo tile, a 240x240 thumbnail): it renders as
 * a headline over a CLOSE CROP of the page's hero, never the whole page,
 * because a 1280-wide page in a 370 px card is unreadable by
 * construction, however well it is resampled.
 */
export const TILE_MAX_PX = 700

export function isTileSize(size: { w: number; h: number }): boolean {
  return Math.max(size.w, size.h) < TILE_MAX_PX
}

/**
 * The tile stage: the headline (or the wordmark when there is none) large
 * across the top, the card below it bled off the right and the bottom at
 * about one and a half times the frame's width, cover-cropped to the
 * page's top-left, so the hero the page opens on reads at a legible size.
 * No lean: a tile is read at a glance.
 */
export function stageTile(input: StageInput): StageResult {
  const R = input.size.w / Math.max(1, input.size.h)
  const square = R <= 1.15
  const v = input.values
  const ground = `linear-gradient(135deg, ${str(v.bgA, '#8a3d2a')}, ${str(v.bgC, str(v.bgB, '#5c5a2e'))})`
  const ink = str(v.ink, '#fff6ec')
  const display = firstFamily(str(v.fontDisplay, 'Lexend'))
  const headline = str(v.headline, '') || str(v.brand, 'Release')
  const wordless = input.text === 'none'
  // The crop box is the FOOTAGE's aspect, so cover crops nothing the box
  // meant to show, and its width is set by how much of the page should be
  // visible: wordless, the page's own hero is the words, so about four
  // fifths of it (two thirds on a square); under a headline, less.
  const aspect =
    input.footageAspect && input.footageAspect > 0
      ? input.footageAspect
      : 16 / 9
  const left = square ? 0.08 : 0.07
  const top = wordless ? (square ? 0.1 : 0.12) : square ? 0.42 : 0.47
  const visible = wordless ? (square ? 0.66 : 0.8) : square ? 0.56 : 0.62
  const cardW = (1 - left) / visible
  const cardH = (cardW * R) / aspect
  const inset = {
    left,
    right: +(1 - left - cardW).toFixed(4),
    top,
    bottom: +(1 - top - cardH).toFixed(4),
  }
  const shot = {
    x: inset.left,
    y: inset.top,
    w: 1 - inset.left - inset.right,
    h: 1 - inset.top - inset.bottom,
  }
  const set: string[] = [
    `frame.background=${JSON.stringify(ground)}`,
    'frame.backgroundMedia=null',
    'frame.fit=cover',
    `frame.inset=${JSON.stringify(inset)}`,
    'frame.focus={"cx":0,"cy":0}',
    'frame.radius=24',
    'frame.shadow=0.5',
    'frame.shadowContact=0',
    'frame.border=0',
    'zoom=[]',
    'tilt=[]',
    'cursor.visible=false',
    'cursor.clickFx.style=none',
  ]
  const designW = (1080 * input.size.w) / input.size.h
  const column = square ? 0.84 : 0.86
  const px = square ? 96 : 108
  const lines = headline.split('\n')
  const longest = Math.max(...lines.map((l) => l.length))
  const widest = Math.min(column, (longest * px * 0.5) / designW)
  const lh = 1.05
  const h = (lines.length * px * lh) / 1080
  const y = square ? 0.2 : 0.24
  const clip = {
    id: 'stage-title',
    kind: 'text',
    text: headline,
    preset: 'title',
    family: display,
    size: px,
    color: ink,
    align: 'left',
    maxWidth: column,
    lineHeight: lh,
    weight: 600,
    letterSpacing: -Math.round(px * 0.02),
    transform: { x: left + widest / 2, y, scale: 1, rotation: 0 },
    shadow: 0,
    start: 0,
    duration: +input.outputSeconds.toFixed(3),
    enter: 'none',
    exit: 'none',
  }
  if (wordless) {
    // A mark is not text: the wordless tile carries the brand's mark alone
    // in the band above the crop, at half the band's height.
    const markKey = str(v.logoKey, '')
    const markAspect =
      typeof v.logoAspect === 'number' && v.logoAspect > 0 ? v.logoAspect : 1
    if (markKey) {
      const hFrac = top * 0.5
      const w = Math.min(
        0.8,
        (hFrac * input.size.h * markAspect) / input.size.w,
      )
      set.push(
        `overlays=${JSON.stringify([
          {
            id: 'stage-mark',
            kind: 'image',
            key: markKey,
            width: +w.toFixed(4),
            radius: 0,
            shadow: 'none',
            transform: { x: left + w / 2, y: top / 2, scale: 1, rotation: 0 },
            start: 0,
            duration: +input.outputSeconds.toFixed(3),
            enter: 'none',
            exit: 'none',
          },
        ])}`,
      )
    } else set.push('overlays=[]')
    return { set, text: [], shot }
  }
  set.push(`overlays=${JSON.stringify([clip])}`)
  const text: TextBox[] = [
    {
      x: left,
      y: y - h / 2,
      w: widest,
      h,
      color: ink,
      role: 'headline',
      label: headline.length > 24 ? `${headline.slice(0, 24)}…` : headline,
    },
  ]
  return { set, text, shot }
}
