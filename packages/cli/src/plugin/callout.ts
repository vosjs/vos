/**
 * `vos callout` — a callout in the grammar, from the take's register.
 *
 * The agent names the shape, the words and the step the layer is about;
 * the verb reads the product's register from `BRAND.md` beside the take
 * (or the flags), takes the type scale from the camera at the layer's
 * start (the app's body as it appears on screen), places the window from
 * the step's output extent, writes the clip pinned to that step and lints
 * the document. What a hand would have to get right in CSS is a computation
 * here, so the card is the video's and the product's at once.
 *
 * `validate <take> --picture` has its eyes here too: each html layer's
 * ground against the footage it covers, as the camera shows it at the
 * layer's start, in CIE76 ΔE — a card within a few ΔE of what it covers
 * reads as one more panel.
 */
import { catalogFamily } from './fontName'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lerpArray, sample } from '@vosjs/timeline'
import {
  CALLOUT_DEFAULT_BODY_PX,
  CALLOUT_SHAPES,
  calloutClip,
  calloutLook,
  calloutGroundOf,
  cameraModel,
  deltaE,
  docCardLayout,
  docZoomTrack,
  hexToRgb,
  parseCssColour,
  pinBox,
  ratedSegments,
  resolvePins,
  spanOutputExtent,
} from '@vosjs/studio-core'
import { decodePng, medianColour } from './picture'
import type { Browser } from 'playwright'
import type {
  CalloutRegister,
  CalloutShape,
  CalloutWords,
  HtmlOverlayClip,
  OverlayClip,
  OverlayPin,
  PinMark,
  PinSide,
  ProjectDoc,
} from '@vosjs/studio-core'
import type { Rgba } from './picture'

/** How long a callout stays up when nothing says otherwise. */
export const CALLOUT_DEFAULT_SECONDS = 3
/** The card opens this long after the step's press lands on screen. */
export const CALLOUT_LEAD_SECONDS = 0.2
/** ΔE under which the card's ground is the footage's: a problem. */
export const CALLOUT_DELTA_E_PROBLEM = 8
/** ΔE under which the card only just separates: a warning. */
export const CALLOUT_DELTA_E_WARNING = 16

/**
 * The register from BRAND.md's roles (`bgA`, `accent`, `fontBody`) and the
 * flags that override them. Null when neither names a ground and an
 * accent.
 *
 * A kit may name a `callout` role, and it wins over `accent`: some brands
 * RESERVE their accent. A recorder's red marks time and nothing else, so a
 * note kicker in it breaks the brand's own rule, twice over when the
 * product's playhead is in the same frame. The composer cannot know what a
 * brand reserves; a role is how the kit says it.
 */
export function registerFrom(
  roles: Record<string, string> | null,
  flags: {
    ground?: string
    accent?: string
    face?: string
    mono?: string
    body?: number
  },
): CalloutRegister | null {
  const ground = flags.ground ?? roles?.bgA
  const accent = flags.accent ?? roles?.callout ?? roles?.accent
  if (!ground || !accent) return null
  if (!hexToRgb(ground) || !hexToRgb(accent)) return null
  // The catalog's name for the face, or the CSS asks for a family no
  // render page registers (fontName.ts).
  const named = flags.face ?? roles?.fontBody
  const face = named ? catalogFamily(named) : named
  return {
    ground,
    accent,
    ...(face && !/^ui-sans-serif$|^system-ui$/.test(face) ? { face } : {}),
    ...(flags.mono ? { mono: flags.mono } : {}),
    body: flags.body ?? CALLOUT_DEFAULT_BODY_PX,
  }
}

/**
 * Design px per CSS px of the app on screen at OUTPUT time t: the card's
 * footage scale times the camera's level.
 */
export function appScaleAt(doc: ProjectDoc, t: number): number {
  const layout = docCardLayout(doc)
  const meta = doc.source.meta
  const base = layout.dw / Math.max(1, meta.width)
  const track = docZoomTrack(doc)
  if (!track || !track.keyframes.length) return base
  const z = sample(track, t, lerpArray)
  return base * Math.max(1, z[0])
}

export interface CalloutWindow {
  start: number
  duration: number
}

/**
 * The layer's window from the step it is about: it opens a beat after the
 * step's press lands on screen and stays CALLOUT_DEFAULT_SECONDS, cut short
 * by the next scroll or navigation so the referent is still there.
 */
export function windowForStep(
  doc: ProjectDoc,
  step: string | number,
  seconds = CALLOUT_DEFAULT_SECONDS,
): CalloutWindow | null {
  const steps = doc.source.meta.steps ?? []
  const s =
    steps.find((x) => x.id !== undefined && x.id === step) ??
    steps.find((x) => String(x.step) === String(step))
  if (!s || s.skipped) return null
  const rated = ratedSegments(doc)
  const ext = spanOutputExtent(rated, s.tStart, s.tEnd)
  if (!ext) return null
  // The press is at the step's start for a click, the gesture's end for a
  // hover or a type; the card opens once the press has landed.
  const at = s.do === 'click' || s.do === 'drag' ? ext.start : ext.end
  const start = +(at + CALLOUT_LEAD_SECONDS).toFixed(3)
  let end = start + seconds
  for (const n of steps) {
    if (n.tStart <= s.tStart) continue
    if (n.do !== 'scroll' && !n.navigated) continue
    const ne = spanOutputExtent(rated, n.tStart, n.tEnd)
    if (ne && ne.start > start && ne.start < end) end = ne.start - 0.05
  }
  return { start, duration: +Math.max(0.5, end - start).toFixed(3) }
}

export interface CalloutAsk {
  shape: CalloutShape
  words: CalloutWords
  id?: string
  step?: string | number
  press?: number
  at?: number
  seconds?: number
  side?: PinSide
  mark?: PinMark
  leader?: boolean
  color?: string
  /**
   * `--body-px` was GIVEN: the register's body is then the size on the
   * delivered frame and is not rescaled. Without it the grammar's default
   * stands, a note that matches the app's body AS SEEN, which multiplies by
   * the footage scale. A rich capture on a padded frame sits near 0.6, and
   * at that scale both 14 and 21 land under the grammar's floors, so an
   * explicit size used to print the same 11 / 20 / 15 as no size at all.
   */
  bodyPxGiven?: boolean
}

/** What the composer chose, so the verb can say it instead of hiding a floor. */
export interface CalloutSizes {
  scale: number
  kickerPx: number
  titlePx: number
  bodyPx: number
}

/** The clip `vos callout` writes: grammar, register, window and pin composed. */
export function composeCallout(
  doc: ProjectDoc,
  register: CalloutRegister,
  ask: CalloutAsk,
): { clip: HtmlOverlayClip; window: CalloutWindow; sizes: CalloutSizes } {
  let window: CalloutWindow | null = null
  if (ask.step !== undefined) {
    window = windowForStep(doc, ask.step, ask.seconds)
    if (!window)
      throw new Error(
        `step "${String(ask.step)}" is not in the take's step timeline, was skipped, or falls outside the cut`,
      )
  } else if (ask.at !== undefined) {
    window = {
      start: ask.at,
      duration: ask.seconds ?? CALLOUT_DEFAULT_SECONDS,
    }
  } else {
    throw new Error(
      'name the step the callout is about (--step <id>), or --at <output seconds>',
    )
  }
  const pin: OverlayPin | undefined =
    ask.step !== undefined
      ? { step: ask.step }
      : ask.press !== undefined
        ? { press: ask.press }
        : undefined
  if (pin) {
    if (ask.side && ask.side !== 'auto') pin.side = ask.side
    if (ask.mark && ask.mark !== 'none') pin.mark = ask.mark
    if (ask.leader) pin.leader = true
    if (ask.color) pin.color = ask.color
  }
  const taken = new Set((doc.overlays ?? []).map((o) => o.id))
  let id = ask.id ?? `${ask.shape}-${ask.step ?? Math.round(window.start * 10)}`
  let n = 2
  while (taken.has(id) && !ask.id)
    id = `${ask.shape}-${ask.step ?? Math.round(window.start * 10)}-${n++}`
  const seen = appScaleAt(doc, window.start + 0.35)
  const scale = ask.bodyPxGiven ? 1 : seen
  const look = calloutLook(register, scale)
  const clip = calloutClip(ask.shape, register, ask.words, {
    id,
    start: window.start,
    duration: window.duration,
    scale,
    pin,
    // The fallback place, in the margin: the lower third.
    at: { x: 0.5, y: 0.82 },
  })
  return {
    clip,
    window,
    sizes: {
      scale: +seen.toFixed(3),
      kickerPx: look.kickerPx,
      titlePx: look.titlePx,
      bodyPx: look.bodyPx,
    },
  }
}

export function isCalloutShape(s: string): s is CalloutShape {
  return (CALLOUT_SHAPES as readonly string[]).includes(s)
}

// --- the picture check -----------------------------------------------------

export interface GroundFinding {
  index: number
  id: string
  level: 'problem' | 'warning' | 'note'
  deltaE: number | null
  card: string | null
  footage: string | null
  message: string
}

/**
 * ΔE between a card's declared ground and the footage under its box, as
 * the camera shows it at the layer's start plus its entrance. `frameAt`
 * renders the footage WITHOUT layers at an output time; the layer's box is
 * its on-screen rect (a pinned layer's from its placement).
 */
export async function groundFindings(
  doc: ProjectDoc,
  frameAt: (t: number) => Promise<Rgba | null>,
): Promise<GroundFinding[]> {
  const out: GroundFinding[] = []
  const overlays = doc.overlays ?? []
  const layout = docCardLayout(doc)
  const camera = cameraModel(doc.frame)
  const track = docZoomTrack(doc)
  const pins = resolvePins(doc, layout, camera, track)
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i]
    if (o.kind !== 'html') continue
    const card = calloutGroundOf(o.css ?? '')
    if (!card) {
      out.push({
        index: i,
        id: o.id,
        level: 'note',
        deltaE: null,
        card: null,
        footage: null,
        message: `overlays[${i}] declares no readable background on its root rule — the ground check cannot read it`,
      })
      continue
    }
    const t = o.start + Math.min(0.35, o.duration / 2)
    const img = await frameAt(t)
    if (!img) {
      out.push({
        index: i,
        id: o.id,
        level: 'note',
        deltaE: null,
        card,
        footage: null,
        message: `overlays[${i}]: the frame at ${t.toFixed(2)}s could not be read`,
      })
      continue
    }
    const box = pinBox(o as OverlayClip, layout)
    const pinned = pins.get(o.id)
    let cx = o.transform.x * layout.W
    let cy = o.transform.y * layout.H
    if (pinned) {
      const v = sample(pinned.track, t - o.start, lerpArray)
      cx = v[0] * layout.W
      cy = v[1] * layout.H
    }
    const sx = img.w / layout.W
    const sy = img.h / layout.H
    const rect = {
      x: (cx - box.w / 2) * sx,
      y: (cy - box.h / 2) * sy,
      w: box.w * sx,
      h: box.h * sy,
    }
    const footage = medianColour(img, rect)
    const cardRgb = parseCssColour(card)
    if (!cardRgb) continue
    const d = deltaE(cardRgb, footage)
    const fh = `#${footage.map((c) => c.toString(16).padStart(2, '0')).join('')}`
    const level =
      d < CALLOUT_DELTA_E_PROBLEM
        ? 'problem'
        : d < CALLOUT_DELTA_E_WARNING
          ? 'warning'
          : 'note'
    out.push({
      index: i,
      id: o.id,
      level,
      deltaE: +d.toFixed(1),
      card,
      footage: fh,
      message:
        level === 'note'
          ? `overlays[${i}] ground ${card} over footage ${fh}: ΔE ${d.toFixed(1)}, reads as lifted`
          : `overlays[${i}] ground ${card} is within ΔE ${d.toFixed(1)} of the footage it covers (${fh}) at ${t.toFixed(2)}s — it reads as one more panel of the app; invert its value (vos callout does) or move it to the margin`,
    })
  }
  return out
}

/** Render the take's footage without layers at output times, one browser session. */
export async function footageFrames(
  browser: Browser,
  dir: string,
  doc: ProjectDoc,
  times: number[],
  framesTake: (
    browser: Browser,
    dir: string,
    opts: {
      times: number[]
      outDir?: string
      doc?: ProjectDoc
    },
  ) => Promise<{ frames: { file: string; time: number }[] }>,
): Promise<Map<number, Rgba | null>> {
  const out = new Map<number, Rgba | null>()
  if (!times.length) return out
  const bare: ProjectDoc = { ...doc, overlays: [] }
  const outDir = join(dir, '.ground-check')
  const res = await framesTake(browser, dir, { times, outDir, doc: bare })
  for (const f of res.frames) {
    if (!existsSync(f.file)) continue
    out.set(
      +f.time.toFixed(3),
      decodePng(new Uint8Array(await readFile(f.file))),
    )
  }
  return out
}
