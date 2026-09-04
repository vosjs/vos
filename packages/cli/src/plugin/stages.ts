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
}

export interface StageResult {
  set: string[]
  text: TextBox[]
  /** Where the card sits, fractions of the frame (a bleed runs past 1). */
  shot: { x: number; y: number; w: number; h: number }
}

/** The house serif the split cover's headline takes when the brand has none. */
export const HOUSE_SERIF = 'Fraunces'

const str = (v: unknown, fallback: string) =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback

/** The stack's first family name, for an overlay clip's `family`. */
const firstFamily = (stack: string) =>
  stack.split(',')[0].replace(/['"]/g, '').trim()

/**
 * The split cover as a stage. Landscape: the card at 60% of the width in
 * the right column, leaning (top edge and left edge toward the camera),
 * bled off the right and the bottom, cover-cropped to the page's top-left;
 * the kicker, the headline and the wordmark at 7%. Square and portrait:
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
  const serif = firstFamily(str(v.fontDisplay, HOUSE_SERIF))
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
    'frame.shadow=0.45',
    'frame.shadowContact=0.25',
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
  ) => {
    if (!text) return
    const lines = text.split('\n')
    const longest = Math.max(...lines.map((l) => l.length))
    const widest = Math.min(column, (longest * px * (preset === 'title' ? 0.5 : 0.62)) / designW)
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
      transform: { x: left + widest / 2, y, scale: 1, rotation: 0 },
      shadow: 'none',
      start: 0,
      duration: +input.outputSeconds.toFixed(3),
      enter: 'none',
      exit: 'none',
      ...extra,
    })
    boxes.push({ x: left, y: y - h / 2, w: widest, h, color, role, label: text.length > 24 ? `${text.slice(0, 24)}…` : text })
  }
  const kickerY = portrait ? 0.1 : square ? 0.12 : 0.24
  const titleY = portrait ? 0.24 : square ? 0.28 : 0.46
  const brandY = portrait ? 0.94 : square ? 0.94 : 0.86
  word('stage-kicker', kicker, 'label', 'JetBrains Mono', 19, kickerY, inkSoft, { letterSpacing: 6, weight: 400 }, 'body')
  word('stage-title', headline, 'title', serif, size, titleY, ink, { weight: 600 }, 'headline')
  word('stage-brand', brand, 'label', body, 25, brandY, ink, { weight: 700, letterSpacing: 1 }, 'body')
  set.push(`overlays=${JSON.stringify(clips)}`)
  return { set, text: boxes, shot }
}
