/**
 * A LOOK is how the card is presented: the ground it sits on, how much of
 * the frame it takes, the shadow that makes it an object, the stroke that
 * separates a light card from a light ground. Three house looks cover the
 * feature-clip and poster grammar the premium tools default to (a cream
 * plate with a soft wide shadow; a warm gradient; a near-black plate with a
 * light streak and a glow), and a maker's brand kit resolves to one of them
 * with its own colours. Pure: a look resolves to `FrameStyle` fields, so
 * every renderer and every still reads the same placement.
 */
import type { FrameStyle } from './types'

export type LookKind = 'plate' | 'gradient' | 'dark'

/**
 * Where the card goes. `hero` is the feature-clip grammar: the card at
 * ~84% of the width with headroom above and its bottom edge running off
 * the frame ("this continues"). `card` is the poster grammar: the card
 * centred on the ground with even room around it; on a frame too wide to
 * hold the whole card it falls back to `hero`.
 */
export type LookPlacement = 'hero' | 'card'

export interface Look {
  kind: LookKind
  /** CSS ground painted under the card (a colour or a gradient). */
  ground: string
  /** The card's width as a fraction of the frame. */
  cardWidth: number
  /** Room above the card in the hero placement, a fraction of the height. */
  headroom: number
  /** Corner radius in design px. */
  radius: number
  /** Ambient shadow 0..1. */
  shadow: number
  /** Contact shadow 0..1. */
  shadowContact: number
  /** `#rrggbb`; absent = black. */
  shadowColor?: string
  /** Hairline stroke alpha 0..1 (0 = none). */
  border: number
  borderColor?: string
}

/** The frontmatter roles a brand kit carries that a look reads. */
export interface LookBrand {
  look?: string | null
  ground?: string | null
  bgA?: string | null
  bgB?: string | null
  bgC?: string | null
  accent?: string | null
  ink?: string | null
}

/** The house coral, the ground every take opened on before looks existed. */
export const HOUSE_GRADIENT = 'linear-gradient(135deg, #ff5148, #ffb03a)'

/** The Chrome feature-clip plate, measured on three clips. */
export const PLATE_GROUND = '#f0f2f4'

/** Near-black with a warm light streak from the top right. */
export const DARK_GROUND =
  'radial-gradient(ellipse at 82% 0%, #2a1d16, #07080b)'

const LOOKS: Record<LookKind, Look> = {
  plate: {
    kind: 'plate',
    ground: PLATE_GROUND,
    cardWidth: 0.84,
    headroom: 0.16,
    radius: 12,
    shadow: 0.42,
    shadowContact: 0,
    border: 0.08,
    borderColor: '#000000',
  },
  gradient: {
    kind: 'gradient',
    ground: HOUSE_GRADIENT,
    cardWidth: 0.84,
    headroom: 0.16,
    radius: 12,
    shadow: 0.5,
    shadowContact: 0,
    border: 0,
  },
  dark: {
    kind: 'dark',
    ground: DARK_GROUND,
    cardWidth: 0.86,
    headroom: 0.14,
    radius: 12,
    shadow: 0.7,
    shadowContact: 0,
    shadowColor: '#000000',
    border: 0.12,
    borderColor: '#ffffff',
  },
}

export const LOOK_KINDS: LookKind[] = ['plate', 'gradient', 'dark']

export function isLookKind(v: unknown): v is LookKind {
  return typeof v === 'string' && (LOOK_KINDS as string[]).includes(v)
}

/** One of the three house looks, copied. */
export function houseLook(kind: LookKind): Look {
  return { ...LOOKS[kind] }
}

const HEX = /^#([0-9a-f]{6})$/i

function luma(hex: string): number | null {
  const m = HEX.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Which house look a site's own ground asks for: a paper site is a plate, a
 * dark site is dark, anything else takes the gradient. What `vos brand`
 * writes as the `look` role, so an outside maker never gets the house coral
 * by accident.
 */
export function lookKindForGround(bgA: string | null | undefined): LookKind {
  const l = bgA ? luma(bgA) : null
  if (l === null) return 'gradient'
  if (l >= 0.85) return 'plate'
  if (l <= 0.2) return 'dark'
  return 'gradient'
}

/**
 * Resolve a brand kit to a look: the `look` role picks the kind (else the
 * site's ground decides), `ground` overrides the ground outright, and the
 * kit's colours colour the house look (plate = bgB, gradient = accent →
 * bgC, dark = bgA with a lifted shadow). A kit with none of them is the
 * house look unchanged.
 */
export function lookFromBrand(brand: LookBrand | null | undefined): Look {
  const b = brand ?? {}
  const kind = isLookKind(b.look) ? b.look : lookKindForGround(b.bgA)
  const look = houseLook(kind)
  if (kind === 'plate' && b.bgB && HEX.test(b.bgB)) look.ground = b.bgB
  if (kind === 'gradient' && b.accent && b.bgC && HEX.test(b.accent)) {
    look.ground = `linear-gradient(135deg, ${b.accent}, ${b.bgC})`
  }
  if (kind === 'dark' && b.bgA && HEX.test(b.bgA)) {
    look.ground = `radial-gradient(ellipse at 82% 0%, ${mix(b.bgA, b.accent ?? '#ffffff', 0.18)}, ${b.bgA})`
  }
  if (b.ground && b.ground.trim()) look.ground = b.ground.trim()
  return look
}

function mix(a: string, b: string, t: number): string {
  const pa = HEX.exec(a)
  const pb = HEX.exec(b)
  if (!pa || !pb) return a
  const na = parseInt(pa[1], 16)
  const nb = parseInt(pb[1], 16)
  const ch = (sh: number) => {
    const x = (na >> sh) & 255
    const y = (nb >> sh) & 255
    return Math.round(x + (y - x) * t)
  }
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

/**
 * The card's per-side inset for a frame of `frameW:frameH` holding footage
 * of `videoW:videoH` under contain fit, as fractions of the frame. Card
 * height follows from the width (contain keeps the footage aspect): a card
 * that fits is centred (`card`) or given headroom (`hero`); one taller than
 * the frame bleeds off the bottom by at least 2%, the feature-clip cue.
 */
export function cardInset(
  look: Pick<Look, 'cardWidth' | 'headroom'>,
  frame: { w: number; h: number },
  video: { w: number; h: number },
  placement: LookPlacement,
): NonNullable<FrameStyle['inset']> {
  const R = frame.w / Math.max(1, frame.h)
  const V = video.w / Math.max(1, video.h)
  const cw = look.cardWidth
  const ch = (cw * R) / V
  const side = (1 - cw) / 2
  if (placement === 'card' && ch <= 1 - look.headroom) {
    const v = (1 - ch) / 2
    return { left: side, right: side, top: v, bottom: v }
  }
  const top = look.headroom
  const bottom = Math.min(-0.02, 1 - top - ch)
  return { left: side, right: side, top, bottom }
}

/**
 * Apply a look to a frame for one output size and placement: the ground,
 * the inset, the radius, both shadow layers and the hairline. The bar and
 * the media layer are the document's own (a look presents the card, it
 * does not decide what chrome the card wears). `fit` is forced to contain,
 * because the card IS the footage's aspect under a look.
 */
export function applyLook(
  frame: FrameStyle,
  look: Look,
  size: { w: number; h: number },
  video: { w: number; h: number },
  placement: LookPlacement,
): FrameStyle {
  const out: FrameStyle = {
    ...frame,
    background: look.ground,
    fit: 'contain',
    inset: cardInset(look, size, video, placement),
    radius: look.radius,
    shadow: look.shadow,
    shadowContact: look.shadowContact,
    border: look.border,
  }
  delete out.focus
  if (look.shadowColor) out.shadowColor = look.shadowColor
  else delete out.shadowColor
  if (look.border > 0) {
    out.borderWidth = 1
    out.borderColor = look.borderColor ?? '#000000'
  }
  return out
}
