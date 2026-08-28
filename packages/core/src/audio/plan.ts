import {
  createSampler,
  createTweenRecorder,
  makeElementsMap,
  runCreateTimeline,
} from '@vosjs/tween'
import type { RuntimeEntry } from '@vosjs/tween'
import type { VosConfigJson } from '../types/vosConfigJson'
import { normalizeEnvelope, sampleEnvelope } from './envelope'
import type { GainEnvelope } from './envelope'

/** The default sampling step for a plan: 240 points per second. */
export const AUDIO_PLAN_STEP = 1 / 240

/** One sampled instant of an audio element, at output time `t`. */
export interface AudioPoint {
  /** Output seconds. */
  t: number
  /** Whether the element is audible (`props.playing`). */
  on: boolean
  /** Source position in seconds (the element's `currentTime`). */
  pos: number
  /** Effective gain: `props.gain` × the element's `gainEnvelope`, 0..1. */
  gain: number
}

export interface AudioTrackPlan {
  id: string
  src: string
  loop: boolean
  /** `points[k]` is the state at `k * step`, `k` in `0..ceil(duration / step)`. */
  points: AudioPoint[]
}

export interface AudioPlan {
  /** Output seconds rendered. */
  duration: number
  step: number
  tracks: AudioTrackPlan[]
}

export interface PlanAudioOptions {
  /** Output seconds to plan (default: `config.duration`). */
  duration?: number
  /** Seconds between samples (default `AUDIO_PLAN_STEP`). */
  step?: number
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** The fields of an `AudioElement` the plan reads, narrowed from the config. */
interface AudioSpec {
  id: string
  src: string
  loop: boolean
  gain: number
  startTime: number
  gainEnvelope: GainEnvelope
}

function audioSpecs(elements: Record<string, unknown>[]): AudioSpec[] {
  const out: AudioSpec[] = []
  for (const e of elements) {
    if (
      e.type !== 'audio' ||
      typeof e.id !== 'string' ||
      typeof e.src !== 'string'
    )
      continue
    out.push({
      id: e.id,
      src: e.src,
      loop: !!e.loop,
      gain: clamp01(typeof e.gain === 'number' ? e.gain : 1),
      startTime:
        typeof e.startTime === 'number' && e.startTime > 0 ? e.startTime : 0,
      gainEnvelope: normalizeEnvelope(
        e.gainEnvelope as GainEnvelope | undefined,
      ),
    })
  }
  return out
}

function compileFunction<T>(source: string | undefined): T | null {
  if (typeof source !== 'string') return null
  try {
    return new Function('return (' + source + ')')() as T
  } catch {
    return null
  }
}

/**
 * `content.refs` for the recording run: any path resolves to a plain object
 * so a `createTimeline` that tweens `content.refs.group.rotation` records an
 * opaque target instead of throwing halfway through the audio tweens.
 */
function anyRefs(): Record<string, unknown> {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (!(prop in target)) target[prop] = new Proxy({}, handler)
      return target[prop]
    },
  }
  return new Proxy({}, handler)
}

/**
 * Sample the program's audio schedule: which `AudioElement`s play when, at
 * what source position, at what gain. The timeline is recorded once with
 * `@vosjs/tween` and sampled with its pure sampler, so the result is exactly
 * what live playback drives into `props.playing`, `props.currentTime` and
 * `props.gain`; `retime` maps output time to program time the way the render
 * loop does. Pure: no I/O, no DOM.
 */
export function planAudio(
  config: VosConfigJson,
  opts: PlanAudioOptions = {},
): AudioPlan {
  const duration = opts.duration ?? config.duration
  const step = opts.step ?? AUDIO_PLAN_STEP
  const elements = (config.elements ?? []) as Record<string, unknown>[]
  const audio = audioSpecs(elements)
  if (!audio.length || !(duration > 0))
    return { duration: Math.max(0, duration || 0), step, tracks: [] }

  // Targets the timeline can bind: every element's props, a generous segment
  // count for split text (unknown until rendered, harmless when unused).
  const spec: Record<string, number> = {}
  for (const e of elements)
    if (typeof e.id === 'string') spec[e.id] = e.split ? 64 : 0
  const elementsMap = makeElementsMap(spec)
  const propsOf = new Map<string, Record<string, unknown>>()
  for (const a of audio) {
    const el = elementsMap.get(a.id)
    if (!el) continue
    const props = el.props as Record<string, unknown>
    props.gain = a.gain
    props.playing = false
    props.currentTime = a.startTime
    propsOf.set(a.id, props)
  }

  const data = (config.data ?? {}) as Record<string, unknown>
  const recorder = createTweenRecorder()
  const ctx = {
    gsap: recorder,
    elements: elementsMap,
    data,
    duration: config.duration,
    time: 0,
    progress: 0,
    outputTime: 0,
  }
  const tl = runCreateTimeline(
    config.createTimeline,
    ctx,
    { refs: anyRefs() },
    config.duration,
  )
  const entries: RuntimeEntry[] = tl ? tl.entries : []
  const sampler = createSampler(entries)

  const retime = compileFunction<
    (t: number, d: Record<string, unknown>) => number
  >(config.retime)
  const programTime = (t: number): number => {
    if (!retime) return t
    let p: number
    try {
      p = retime(t, data)
    } catch {
      return t
    }
    if (!Number.isFinite(p)) return t
    return p < 0 ? 0 : p > config.duration ? config.duration : p
  }

  const envelopes = new Map(audio.map((a) => [a.id, a.gainEnvelope]))
  const count = Math.ceil(duration / step) + 1
  const tracks: AudioTrackPlan[] = audio
    .filter((a) => propsOf.has(a.id))
    .map((a) => ({
      id: a.id,
      src: a.src,
      loop: a.loop,
      points: new Array<AudioPoint>(count),
    }))
  const lastSeen = new Map<string, number>()

  for (let k = 0; k < count; k++) {
    const t = k * step
    sampler.seek(programTime(t), true)
    for (const track of tracks) {
      const props = propsOf.get(track.id)!
      const on = !!props.playing
      const ct = typeof props.currentTime === 'number' ? props.currentTime : 0
      const prev = k > 0 ? track.points[k - 1] : null
      const seen = lastSeen.get(track.id)
      // A changed currentTime is a seek (a set, or an animated position); an
      // unchanged one while playing advances natively, one output second per
      // second, the way an HTMLMediaElement does under the master clock.
      let pos: number
      if (seen === undefined || ct !== seen) pos = ct
      else if (prev && prev.on) pos = prev.pos + step
      else pos = prev ? prev.pos : ct
      lastSeen.set(track.id, ct)
      const gain =
        clamp01(typeof props.gain === 'number' ? props.gain : 1) *
        sampleEnvelope(envelopes.get(track.id)!, t)
      track.points[k] = { t, on, pos, gain }
    }
  }

  return { duration, step, tracks }
}
