/**
 * What a VIDEO destination adds on top of the cut, keyed on the
 * destination's KIND and never on measured audio (deterministic and
 * explainable): the card's entrance, the end card, captions per beat,
 * a music bed and click sounds where the channel plays sound, and the
 * vertical reframe. Every rule lands as doc overrides for that one render,
 * so the take on disk stays the cut. Pure; the catalog and the words come
 * in as data.
 */
import { ratedSegments, spanOutputExtent } from '@vosjs/studio-core'
import { stepOutputTime } from './moments'
import type { Destination, ProjectDoc } from '@vosjs/studio-core'
import type { ReleaseWords } from './posterValues'

/** Destinations that play sound (a feed autoplays muted; a demo has a speaker). */
export const SOUND_DESTINATIONS = new Set([
  'x-feed-cut',
  'youtube-main-demo',
  'shorts-linkedin-vertical-cut',
])

/** Destinations that must loop seamlessly: no entrance, no end card, no sound. */
export const LOOP_DESTINATIONS = new Set(['github-readme-loop'])

export interface MusicCatalog {
  tracks: { slug: string; title: string; mood?: string; duration: number; url: string }[]
  sfx: { slug: string; title: string; duration: number; url: string }[]
}

export interface MotionInput {
  destination: Pick<Destination, 'id' | 'kind' | 'px' | 'text'>
  doc: ProjectDoc
  /** The OUTPUT-time window the render covers (the --range), or the whole cut. */
  range: [number, number]
  words: ReleaseWords
  /** LAUNCH.md roles: music (a slug or mood), entrance, endCard, captions. */
  launch: Record<string, string>
  /** actions.json steps with their optional captions, by index. */
  captions: { step: number; id?: string; caption: string }[]
  catalog: MusicCatalog | null
}

export interface MotionPlan {
  set: string[]
  /** What was added, for the phase note. */
  notes: string[]
  /** What could not be added, in words. */
  skipped: string[]
}

const off = (v: string | undefined) => v !== undefined && /^(none|off|false|no)$/i.test(v.trim())

/**
 * The bed: LAUNCH.md names a track slug or a mood; a mood picks the first
 * track of that mood. Null when nothing was asked or nothing matched.
 */
export function pickTrack(
  catalog: MusicCatalog | null,
  ask: string | undefined,
): MusicCatalog['tracks'][number] | null {
  if (!catalog || !ask || off(ask)) return null
  const want = ask.trim().toLowerCase()
  return (
    catalog.tracks.find((t) => t.slug.toLowerCase() === want) ??
    catalog.tracks.find((t) => (t.mood ?? '').toLowerCase() === want) ??
    null
  )
}

/** Click instants of the take in OUTPUT seconds, inside the range. */
export function clickTimes(doc: ProjectDoc, range: [number, number]): number[] {
  const rated = ratedSegments(doc)
  const out: number[] = []
  for (const e of doc.source.cursor) {
    if (e.type !== 'down') continue
    const src = e.t / 1000
    const ext = spanOutputExtent(rated, src, src + 0.001)
    if (!ext) continue
    const t = ext.start
    if (t < range[0] || t > range[1]) continue
    if (out.length && t - out[out.length - 1] < 0.12) continue
    out.push(+(t - range[0]).toFixed(3))
  }
  return out
}

export function planMotion(input: MotionInput): MotionPlan {
  const { destination: d, doc, range, words, launch, catalog } = input
  const set: string[] = []
  const notes: string[] = []
  const skipped: string[] = []
  if (d.kind !== 'video') return { set, notes, skipped }
  const loop = LOOP_DESTINATIONS.has(d.id)
  const sound = SOUND_DESTINATIONS.has(d.id)
  const length = range[1] - range[0]
  const portrait = d.px.w / d.px.h < 0.9

  // The entrance: every clip but a loop opens on a move.
  const entrance = launch.entrance
  if (!loop && !off(entrance)) {
    const kind = entrance && /^(tilt-in|pull-out|rise)$/.test(entrance.trim()) ? entrance.trim() : 'tilt-in'
    set.push(`frame.entrance={"kind":"${kind}"}`)
    notes.push(`entrance ${kind}`)
  }

  // The end card: the last frame holds, the words rise. Feed cuts and the
  // demo; never a loop.
  if (!loop && !off(launch.endCard)) {
    const headline = (words.headline ?? '').trim()
    const brand = (words.brand ?? '').trim()
    const sub = [brand, (words.release ?? '').trim()].filter(Boolean).join(' ')
    if (headline || brand) {
      const card: Record<string, unknown> = { seconds: 2.5 }
      if (headline) card.headline = headline
      if (sub && sub !== headline) card.sub = sub
      if (brand) card.wordmark = brand
      set.push(`endCard=${JSON.stringify(card)}`)
      notes.push('end card')
    } else {
      skipped.push(`${d.id}: no end card (no headline or wordmark in LAUNCH.md, BRAND.md or the flags)`)
    }
  }

  // Captions per beat: a step's caption lands at the step's settled
  // moment as a lower-third, where the channel takes words.
  if (!loop && d.text !== 'none' && input.captions.length && !off(launch.captions)) {
    const rated = ratedSegments(doc)
    const steps = doc.source.meta.steps ?? []
    const clips: Record<string, unknown>[] = []
    for (const c of input.captions) {
      const step = steps.find((s) => (c.id !== undefined && s.id === c.id) || s.step === c.step)
      if (!step || step.skipped) continue
      const t = stepOutputTime(rated, step, 0.2)
      if (t === null || t < range[0] || t > range[1] - 1) continue
      const start = +(t - range[0]).toFixed(3)
      clips.push({
        id: `caption-${c.step}`,
        kind: 'text',
        text: c.caption,
        preset: 'caption',
        start,
        duration: Math.min(3.5, Math.max(2.5, (range[1] - t) - 0.2)),
        transform: { x: 0.5, y: portrait ? 0.8 : 0.86, scale: 1, rotation: 0 },
        enter: 'rise',
        exit: 'fade',
        align: 'center',
        box: { color: 'rgba(17,17,17,0.72)' },
      })
    }
    if (clips.length) {
      const existing = Array.isArray(doc.overlays) ? doc.overlays : []
      set.push(`overlays=${JSON.stringify([...existing, ...clips])}`)
      notes.push(`${clips.length} caption(s)`)
    }
  }

  // Sound: a bed and click sounds where the channel plays sound.
  if (sound && !loop) {
    const track = pickTrack(catalog, launch.music)
    const clips: unknown[] = Array.isArray(doc.audio) ? [...doc.audio] : []
    if (track) {
      const hasMic = !!doc.source.micKey
      const fadeOut = Math.min(2.5, length * 0.15)
      clips.push({
        id: 'bed',
        key: track.url,
        name: track.title,
        start: 0,
        in: 0,
        out: Math.min(track.duration, length),
        duration: track.duration,
        gain: hasMic ? 0.35 : 0.5,
        fadeIn: 0.6,
        fadeOut,
        loop: track.duration < length,
        loopLen: track.duration < length ? length : undefined,
        duck: hasMic,
      })
      notes.push(`bed ${track.slug}`)
    } else if (launch.music && !off(launch.music)) {
      skipped.push(`${d.id}: music "${launch.music}" is not a catalog track or mood${catalog ? '' : ' (the catalog could not be read)'}`)
    }
    const click = catalog?.sfx.find((s) => s.slug === 'sfx-click')
    if (click && !doc.source.micKey && !off(launch.clicks)) {
      const times = clickTimes(doc, range)
      for (const [i, t] of times.entries()) {
        clips.push({
          id: `click-${i}`,
          key: click.url,
          name: click.title,
          start: t,
          in: 0,
          out: click.duration,
          duration: click.duration,
          gain: 0.4,
          fadeIn: 0,
          fadeOut: 0,
        })
      }
      if (times.length) notes.push(`${times.length} click sound(s)`)
    }
    if (clips.length) set.push(`audio=${JSON.stringify(clips)}`)
  }

  // The vertical cut is a reframe, not a letterbox: the card is the tall
  // inset area, the footage cover-fills it, and the crop follows the camera.
  if (portrait) {
    set.push('frame.fit=cover')
    set.push('frame.inset={"left":0.06,"right":0.06,"top":0.17,"bottom":0.17}')
    set.push('frame.focusFollow=camera')
    notes.push('vertical reframe follows the camera')
  }

  return { set, notes, skipped }
}
