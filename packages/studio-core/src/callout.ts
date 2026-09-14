/**
 * The callout grammar — three shapes a viewer learns once, composed from the
 * product's own register so the card is unmistakably the video's and still
 * the product's.
 *
 * The rule set (the distinguishability principle: share the product's hue
 * and type, contrast in value, elevation, scale and place):
 *  - VALUE INVERSION: a light app gets a dark card in the product's hue, a
 *    dark app a light one; the accent is kept for the kicker and the dot.
 *  - ELEVATION: a real shadow plus a hairline of light on the edge.
 *  - SCALE: the title is set for the render, CALLOUT_TYPE_RATIO times the
 *    app's body as it appears on screen at the layer's start (the camera
 *    scales the app, so the caller passes that scale), never the app's own
 *    size.
 *  - MOTION: a rise in, a fade out.
 *  - PLACE is the pin's (lower/pin.ts), not the card's.
 *
 * Pure: hex in, markup and CSS out. The starters are this grammar in the
 * house register; `vos callout` is it in the take's BRAND.md.
 */
import type { HtmlOverlayClip, OverlayPin } from './types'

export type CalloutShape = 'tag' | 'note' | 'code'
export const CALLOUT_SHAPES: readonly CalloutShape[] = ['tag', 'note', 'code']

/** The title's size over the app's body size as seen on screen. */
export const CALLOUT_TYPE_RATIO = 1.35
/** The app's body size when nothing says otherwise (CSS px at the viewport). */
export const CALLOUT_DEFAULT_BODY_PX = 14

/** The product's register: what a card shares with the app. */
export interface CalloutRegister {
  /** The app's ground (its page background), a hex. Decides the inversion. */
  ground: string
  /** The product's accent, a hex: the kicker, the dot, the bar. */
  accent: string
  /** The words face: a hosted catalog family or a system stack. */
  face?: string
  /** The code face. */
  mono?: string
  /** The app's body type size in CSS px at the recorded viewport. */
  body?: number
}

export interface CalloutWords {
  /** A short label above the title, set in the accent (a tag is only this). */
  kicker?: string
  title?: string
  /** One or two lines under the title. */
  body?: string
  /** The payload, kept as typed (lines break on \n). */
  code?: string
}

/** The resolved look: colours and sizes in design px. */
export interface CalloutLook {
  light: boolean
  cardGround: string
  cardInk: string
  cardMuted: string
  hairline: string
  accent: string
  shadow: string
  face: string
  mono: string
  kickerPx: number
  titlePx: number
  bodyPx: number
  codePx: number
  radius: number
  padX: number
  padY: number
}

export const HOUSE_REGISTER: CalloutRegister = {
  ground: '#ffffff',
  accent: '#7c3aed',
}

const DEFAULT_FACE = "'Inter',-apple-system,system-ui,sans-serif"
const DEFAULT_MONO = "'JetBrains Mono',ui-monospace,monospace"

/**
 * Resolve a register into a look. `scale` is design px per CSS px of the
 * app as it appears at the layer's start (the card's footage scale times
 * the camera's level); 1 when unknown.
 */
export function calloutLook(register: CalloutRegister, scale = 1): CalloutLook {
  const ground = hexToRgb(register.ground) ?? [255, 255, 255]
  const accent = hexToRgb(register.accent) ?? [124, 58, 237]
  const light = relativeLuminance(ground) > 0.4
  const [h, s] = rgbToHsl(accent)
  // The card takes the product's hue at the opposite value: near-black or
  // near-white, tinted just enough to belong to the app.
  const cardGround = light
    ? hslToHex(h, Math.min(0.35, s * 0.6), 0.07)
    : hslToHex(h, Math.min(0.25, s * 0.35), 0.97)
  const bodyPx = register.body ?? CALLOUT_DEFAULT_BODY_PX
  const titlePx = Math.max(20, Math.round(CALLOUT_TYPE_RATIO * bodyPx * scale))
  return {
    light,
    cardGround,
    cardInk: light ? '#fafafa' : '#101012',
    cardMuted: light ? 'rgba(255,255,255,0.64)' : 'rgba(16,16,18,0.6)',
    hairline: light ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
    accent: rgbToHex(accent),
    shadow: '0 24px 60px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.16)',
    face: register.face ? quoteFamily(register.face) : DEFAULT_FACE,
    mono: register.mono ? quoteFamily(register.mono) : DEFAULT_MONO,
    kickerPx: Math.max(11, Math.round(titlePx * 0.55)),
    titlePx,
    bodyPx: Math.max(15, Math.round(titlePx * 0.75)),
    codePx: Math.max(14, Math.round(titlePx * 0.68)),
    radius: 16,
    padX: 24,
    padY: 20,
  }
}

export interface CalloutBox {
  width: number
  height: number
}

/**
 * The design box a shape needs for its words: one line for a tag, the
 * kicker, title and wrapped body for a note, the lines for code. Widths
 * estimate glyphs at 0.56 em for words and 0.62 em for mono.
 */
export function calloutBox(
  shape: CalloutShape,
  look: CalloutLook,
  words: CalloutWords,
): CalloutBox {
  const em = (px: number, chars: number, adv: number) =>
    Math.ceil(px * adv * chars)
  if (shape === 'tag') {
    const text = words.kicker ?? words.title ?? ''
    const w = em(look.kickerPx * 1.1, text.length, 0.62) + 14 + 18 * 2
    return {
      width: clamp(w, 120, 720),
      height: Math.max(36, Math.round(look.kickerPx * 1.1 * 2.6)),
    }
  }
  if (shape === 'code') {
    const lines = (words.code ?? '').split('\n')
    const longest = Math.max(1, ...lines.map((l) => l.length))
    const lineH = Math.round(look.codePx * 1.7)
    const w = em(look.codePx, longest, 0.62) + look.padX * 2
    const h =
      lines.length * lineH +
      look.padY * 2 +
      (words.kicker ? look.kickerPx * 2 : 0)
    return { width: clamp(w, 360, 820), height: clamp(h, 72, 640) }
  }
  const title = words.title ?? ''
  const body = words.body ?? ''
  const titleW = em(look.titlePx, title.length, 0.56)
  const width = clamp(Math.max(titleW, 320) + look.padX * 2, 360, 640)
  const inner = width - look.padX * 2
  const bodyLines = body
    ? Math.max(1, Math.ceil(em(look.bodyPx, body.length, 0.54) / inner))
    : 0
  const titleLines = Math.max(1, Math.ceil(titleW / inner))
  const height =
    look.padY * 2 +
    (words.kicker ? Math.round(look.kickerPx * 1.6) : 0) +
    titleLines * Math.round(look.titlePx * 1.25) +
    (bodyLines ? 8 + bodyLines * Math.round(look.bodyPx * 1.5) : 0)
  return { width, height: clamp(height, 64, 480) }
}

/** The markup and CSS for a shape in a look, sized to a box. */
export function calloutSource(
  shape: CalloutShape,
  look: CalloutLook,
  words: CalloutWords,
  box: CalloutBox,
): { html: string; css: string } {
  const base =
    `box-sizing:border-box;width:${box.width}px;height:${box.height}px;` +
    `background:${look.cardGround};color:${look.cardInk};` +
    `border:1px solid ${look.hairline};border-radius:${look.radius}px;` +
    `box-shadow:${look.shadow};-webkit-font-smoothing:antialiased;`
  if (shape === 'tag') {
    const text = esc(words.kicker ?? words.title ?? '')
    return {
      html: `<div class="tag"><span class="dot"></span><span class="t">${text}</span></div>`,
      css:
        `.tag{font-family:${look.face};display:flex;align-items:center;gap:10px;${base}border-radius:999px;padding:0 18px;background:${look.accent};color:#fff;border-color:rgba(255,255,255,0.18);font-size:${Math.round(look.kickerPx * 1.1)}px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;white-space:nowrap}` +
        `.dot{width:8px;height:8px;border-radius:99px;background:#fff;opacity:0.9;flex:none}`,
    }
  }
  if (shape === 'code') {
    const lines = (words.code ?? '')
      .split('\n')
      .map((l) =>
        /^\s*(\/\/|#|\$)/.test(l)
          ? `<span class="mut">${esc(l)}</span>`
          : esc(l),
      )
      .join('\n')
    const kicker = words.kicker
      ? `<div class="k">${esc(words.kicker)}</div>`
      : ''
    return {
      html: `<div class="code">${kicker}<pre class="p">${lines}</pre></div>`,
      css:
        `.code{font-family:${look.mono};${base}padding:${look.padY}px ${look.padX}px;font-size:${look.codePx}px;line-height:1.7;letter-spacing:-0.01em}` +
        `.k{font-family:${look.face};font-size:${look.kickerPx}px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${look.accent};margin:0 0 ${Math.round(look.kickerPx * 0.9)}px}` +
        `.p{margin:0;white-space:pre;font:inherit}` +
        `.mut{color:${look.cardMuted}}`,
    }
  }
  const kicker = words.kicker
    ? `<div class="k"><span class="dot"></span>${esc(words.kicker)}</div>`
    : ''
  const body = words.body ? `<div class="b">${esc(words.body)}</div>` : ''
  return {
    html: `<div class="note">${kicker}<div class="t">${esc(words.title ?? '')}</div>${body}</div>`,
    css:
      `.note{font-family:${look.face};${base}padding:${look.padY}px ${look.padX}px;display:flex;flex-direction:column;justify-content:center}` +
      `.k{display:flex;align-items:center;gap:8px;font-size:${look.kickerPx}px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${look.accent};margin-bottom:${Math.round(look.kickerPx * 0.6)}px}` +
      `.dot{width:7px;height:7px;border-radius:99px;background:${look.accent};box-shadow:0 0 10px ${look.accent}}` +
      `.t{font-size:${look.titlePx}px;font-weight:600;line-height:1.25;letter-spacing:-0.01em}` +
      `.b{margin-top:8px;font-size:${look.bodyPx}px;line-height:1.5;color:${look.cardMuted}}`,
  }
}

export interface CalloutClipOptions {
  id: string
  /** OUTPUT seconds. */
  start: number
  duration: number
  /** Design px per CSS px of the app on screen at `start` (1 = unknown). */
  scale?: number
  pin?: OverlayPin
  /** The fallback place when the pin cannot resolve (frame fractions). */
  at?: { x: number; y: number }
}

/** A callout as an html overlay clip: the grammar applied to a register. */
export function calloutClip(
  shape: CalloutShape,
  register: CalloutRegister,
  words: CalloutWords,
  opts: CalloutClipOptions,
): HtmlOverlayClip {
  const look = calloutLook(register, opts.scale ?? 1)
  const box = calloutBox(shape, look, words)
  const { html, css } = calloutSource(shape, look, words, box)
  return {
    id: opts.id,
    kind: 'html',
    start: opts.start,
    duration: opts.duration,
    html,
    css,
    box,
    transform: {
      x: opts.at?.x ?? 0.5,
      y: opts.at?.y ?? 0.5,
      scale: 1,
      rotation: 0,
    },
    anim: { enter: 'rise', exit: 'fade' },
    ...(opts.pin ? { pin: opts.pin } : {}),
  }
}

/**
 * The card's ground as its CSS declares it (the root rule's background),
 * for the picture check that compares it with the footage it covers. Null
 * when the CSS names none in a form a hex can be read from.
 */
export function calloutGroundOf(css: string): string | null {
  const m =
    /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/.exec(css)
  if (!m) return null
  const rgb = parseCssColour(m[1])
  return rgb ? rgbToHex(rgb) : null
}

// --- colour ---------------------------------------------------------------

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function parseCssColour(s: string): Rgb | null {
  const hex = hexToRgb(s)
  if (hex) return hex
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0)
  else if (max === gg) h = (bb - rr) / d + 2
  else h = (rr - gg) / d + 4
  return [h / 6, s, l]
}

export function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255])
}

/** CIE76 colour difference between two sRGB colours. */
export function deltaE(a: Rgb, b: Rgb): number {
  const la = rgbToLab(a)
  const lb = rgbToLab(b)
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

export function rgbToLab([r, g, b]: Rgb): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

function quoteFamily(family: string): string {
  const first = family
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '')
  const rest = family.includes(',')
    ? family.slice(family.indexOf(',') + 1).trim()
    : /mono/i.test(first)
      ? 'ui-monospace,monospace'
      : '-apple-system,system-ui,sans-serif'
  return /^[a-z-]+$/i.test(first) &&
    /^(ui-|system-ui|sans-serif|serif|monospace)/.test(first)
    ? `${first},${rest}`
    : `'${first}',${rest}`
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
