/**
 * The sound a page plays during a take. The recorder captures frames, and
 * a product's sound (a voice preview, a video playing in the page) would
 * be lost with nothing to say it was there. Most of it is a media element,
 * so the recorder watches every `<video>` and `<audio>` the page plays, in
 * the page and in its same-origin frames, and keeps WHEN each was heard
 * and WHAT media time it played, so a clip of the same file can be placed
 * exactly under the footage (`meta.media`, then the plan's audio clips).
 *
 * Two pieces run IN the page, both plain JavaScript strings (a function
 * serialized out of a bundle picks up the bundler's helpers and dies in the
 * page): an init script that notes every play, pause, seek, end and volume
 * change into a log on the top window, and a drain that hands the log over
 * with the page's clock. The rest is here, in the recorder's clock: the
 * page's instants become wall instants, and the take clock turns those
 * into footage stretches, split wherever an `await` took the camera away.
 */
import type { RecordingPageMedia } from '@vosjs/studio-core'
import type { TakeClock } from './takeClock'

/** The most elements a take follows, and the most notes the page keeps between drains. */
const MAX_ELEMENTS = 50
const MAX_NOTES = 2000
/** A heard stretch shorter than this places nothing. */
const MIN_HEARD_S = 0.05

/**
 * The init script: runs at document start in every frame. A frame that
 * cannot reach the top window (another origin) notes nothing. A media
 * element out of the document (`new Audio(url).play()`) is reached by
 * the play it is started with.
 */
export const MEDIA_WATCH_SCRIPT = `(() => {
  let host
  try { host = window.top; void host.document.title } catch { return }
  if (window.__vosMediaWatch) return
  window.__vosMediaWatch = true
  if (!host.__vosMedia) {
    const M = { log: [], seq: 0, els: new Set(), doc: Math.random().toString(36).slice(2) }
    M.fields = (el, kind) => ({
      id: el.__vosMediaId,
      tag: el.tagName === 'VIDEO' ? 'video' : 'audio',
      src: el.currentSrc || el.src || '',
      kind,
      wall: Date.now(),
      t: el.currentTime,
      rate: el.playbackRate || 1,
      paused: el.paused || el.ended,
      audible: !el.muted && el.volume > 0,
      volume: el.volume,
      duration: isFinite(el.duration) ? el.duration : null,
      ab: typeof el.webkitAudioDecodedByteCount === 'number' ? el.webkitAudioDecodedByteCount : null,
    })
    host.__vosMedia = M
  }
  const M = host.__vosMedia
  const EVENTS = ['playing', 'pause', 'ended', 'seeking', 'seeked', 'volumechange', 'ratechange', 'emptied']
  const note = (e) => {
    const el = e.target
    if (!el || typeof el.currentTime !== 'number' || !/^(VIDEO|AUDIO)$/.test(el.tagName || '')) return
    if (e.__vosNoted) return
    e.__vosNoted = true
    if (!el.__vosMediaId) {
      if (M.els.size >= ${MAX_ELEMENTS}) return
      el.__vosMediaId = ++M.seq
      M.els.add(el)
    }
    if (M.log.length < ${MAX_NOTES}) M.log.push(M.fields(el, e.type))
  }
  for (const type of EVENTS) document.addEventListener(type, note, true)
  const proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype
  if (proto && proto.play) {
    const play = proto.play
    proto.play = function () {
      if (!this.__vosListening && !this.isConnected) {
        this.__vosListening = true
        for (const type of EVENTS) this.addEventListener(type, note)
      }
      return play.apply(this, arguments)
    }
  }
})()`

/**
 * The drain: the notes since the last drain, a `tick` for every element
 * followed (what it is doing now, which catches a note that never came),
 * the page's clock, and which document the log belongs to (a navigation
 * starts a new one).
 */
export const MEDIA_DRAIN_PROBE = `(() => {
  const M = window.__vosMedia
  if (!M) return { now: Date.now(), doc: null, notes: [] }
  const notes = M.log.splice(0)
  M.els.forEach((el) => notes.push(M.fields(el, 'tick')))
  return { now: Date.now(), doc: M.doc, notes }
})()`

/** One note from the page. */
export interface MediaNote {
  id: number
  tag: 'video' | 'audio'
  src: string
  kind: string
  wall: number
  t: number
  rate: number
  paused: boolean
  audible: boolean
  volume: number
  duration: number | null
  ab: number | null
}

export interface MediaDrain {
  now: number
  doc: string | null
  notes: MediaNote[]
}

interface Stretch {
  fromWall: number
  toWall: number
  t0: number
  rate: number
}

interface Followed {
  tag: 'video' | 'audio'
  src: string
  step?: number
  duration?: number
  volume?: number
  played: boolean
  audioBytes: number | null
  open: { wall: number; t: number; rate: number } | null
  stretches: Stretch[]
}

/** A page sound with its full source, for the fetch; `meta` is what the take keeps. */
export interface HeardSound {
  meta: RecordingPageMedia
  /** the address as the page played it, query and all: fetched, never stored */
  src: string
}

/** What `meta.media[].src` keeps of an address: origin and path; a `blob:` or `data:` by its scheme. */
export function soundSrcForMeta(src: string): string {
  if (/^blob:/i.test(src)) return 'blob:'
  if (/^data:/i.test(src)) return src.slice(0, src.search(/[;,]/) + 1 || 5)
  try {
    const u = new URL(src)
    return `${u.origin}${u.pathname}`
  } catch {
    return ''
  }
}

/**
 * Accumulates the page's notes across a take, in the recorder's clock.
 * `add` takes each drain with the recorder's own `Date.now()` at the
 * moment it came back; `heard` closes what is still playing at the end
 * and maps every stretch to footage time.
 */
export class PageSoundLog {
  private byKey = new Map<string, Followed>()
  private openKeyOf = new Map<number, string>()
  private doc: string | null = null
  private lastWall = 0

  add(drain: MediaDrain | null, nodeNow: number, step?: number): void {
    if (!drain) return
    const skew = nodeNow - drain.now
    // A new document: what the old one was playing stopped with it, no
    // later than the last time it was seen.
    if (drain.doc !== this.doc) {
      if (this.doc !== null) this.closeAll(this.lastWall)
      this.openKeyOf.clear()
      this.doc = drain.doc
    }
    const notes = [...drain.notes].sort((a, b) => a.wall - b.wall)
    for (const n of notes) this.note(n, n.wall + skew, step)
    this.lastWall = nodeNow
  }

  private note(n: MediaNote, wall: number, step?: number): void {
    const key = `${this.doc}|${n.id}|${n.src}`
    const prevKey = this.openKeyOf.get(n.id)
    // The element moved on to another source: what it played before ended.
    if (prevKey && prevKey !== key) {
      const prev = this.byKey.get(prevKey)
      if (prev) this.close(prev, wall)
    }
    let f = this.byKey.get(key)
    if (!f) {
      if (!n.src) return
      f = {
        tag: n.tag,
        src: n.src,
        played: false,
        audioBytes: null,
        open: null,
        stretches: [],
      }
      this.byKey.set(key, f)
    }
    this.openKeyOf.set(n.id, key)
    if (n.duration !== null) f.duration = n.duration
    if (n.ab !== null) f.audioBytes = Math.max(f.audioBytes ?? 0, n.ab)
    if (!n.paused) f.played = true
    const stops = ['pause', 'ended', 'seeking', 'emptied'].includes(n.kind)
    const heard = !n.paused && n.audible && !stops
    // A resync point: the stretch so far ends here, and a new one starts
    // from the media time the page reports now.
    const resync = ['playing', 'seeked', 'ratechange'].includes(n.kind)
    if (f.open && (!heard || resync))
      this.close(
        f,
        wall,
        n.kind === 'ended' ? (n.duration ?? undefined) : undefined,
      )
    if (!f.open && heard) {
      f.open = { wall, t: n.t, rate: n.rate > 0 ? n.rate : 1 }
      f.volume = n.volume
      if (f.step === undefined && step !== undefined && step >= 0) f.step = step
    }
  }

  private close(f: Followed, wall: number, endT?: number): void {
    if (!f.open) return
    const { wall: from, t, rate } = f.open
    f.open = null
    if (wall <= from) return
    // The media time at the end is where the stretch was heading; an end
    // the page reported (`ended`) is the file's length.
    const to = endT ?? t + ((wall - from) / 1000) * rate
    f.stretches.push({
      fromWall: from,
      toWall: from + ((to - t) / rate) * 1000,
      t0: t,
      rate,
    })
  }

  private closeAll(wall: number): void {
    for (const f of this.byKey.values()) this.close(f, wall)
  }

  /**
   * Every element the page played, each heard stretch as footage seconds
   * `at` with media seconds `from`..`to`, none past `endMs` of footage.
   * A video whose decoder never decoded a byte of sound played none.
   */
  heard(clock: TakeClock, endWall: number, endMs: number): HeardSound[] {
    this.closeAll(endWall)
    const out: HeardSound[] = []
    for (const f of this.byKey.values()) {
      if (!f.played) continue
      const silentVideo = f.tag === 'video' && f.audioBytes === 0
      const intervals: RecordingPageMedia['intervals'] = []
      if (!silentVideo)
        for (const s of f.stretches)
          for (const c of clock.onCamera(s.fromWall, s.toWall)) {
            const at = c.atMs / 1000
            let from = s.t0 + ((c.wallMs - s.fromWall) / 1000) * s.rate
            let to = from + (c.ms / 1000) * s.rate
            if (f.duration !== undefined) to = Math.min(to, f.duration)
            const room = (endMs - c.atMs) / 1000
            if (room <= 0) continue
            to = Math.min(to, from + room * s.rate)
            from = Math.max(0, from)
            if (to - from < MIN_HEARD_S) continue
            intervals.push({
              at: +at.toFixed(3),
              from: +from.toFixed(3),
              to: +to.toFixed(3),
            })
          }
      out.push({
        src: f.src,
        meta: {
          ...(f.step !== undefined ? { step: f.step } : {}),
          src: soundSrcForMeta(f.src),
          tag: f.tag,
          ...(f.duration !== undefined
            ? { duration: +f.duration.toFixed(3) }
            : {}),
          ...(intervals.length && f.volume !== undefined
            ? { volume: +f.volume.toFixed(3) }
            : {}),
          intervals,
          ...(intervals.length ? {} : { muted: true }),
        },
      })
    }
    return out
  }
}
