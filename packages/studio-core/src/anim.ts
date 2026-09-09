/**
 * ONE animation vocabulary for every visual primitive: the card, a text,
 * image or video clip, a prop. `anim.enter` and `anim.exit` are how a thing
 * arrives and leaves; `anim.idle` is what it does while it stays. A kind
 * alone is the house motion; a step object adds its seconds and, for words,
 * the per-unit grammar (unit, direction, stagger). Pure helpers over the
 * type; the lowering bakes them into the same ON_FRAME data the older
 * spellings produced (`enter`, `exit`, `fx`, `anim`), so a migrated document
 * paints the same picture.
 */
import type {
  Anim,
  AnimKind,
  AnimSide,
  AnimStep,
  IdleKind,
  ObjectClip,
  OverlayClip,
  TextFxSpec,
  TextOverlayClip,
} from './types'

/** What the CARD can do. */
export const CARD_ENTER_KINDS: readonly AnimKind[] = [
  'none',
  'fade',
  'rise',
  'tilt-in',
  'pull-out',
  'slide',
]
export const CARD_EXIT_KINDS: readonly AnimKind[] = ['none', 'fade', 'recede']
/**
 * What a FOOTAGE clip can do at a boundary with the clip beside it: the
 * incoming slides, fades or scales in while the outgoing, frozen on its
 * last frame, does the same out. `none` (or absent) is a hard cut.
 */
export const SEGMENT_ENTER_KINDS: readonly AnimKind[] = [
  'none',
  'slide',
  'fade',
  'scale',
]
export const SEGMENT_EXIT_KINDS: readonly AnimKind[] = [
  'none',
  'slide',
  'fade',
  'scale',
]
/** A transition's house length, seconds. */
export const TRANSITION_SECONDS = 0.6
/** A transition's bounds, seconds (the lint's and the lowering's). */
export const TRANSITION_SECONDS_MIN = 0.15
export const TRANSITION_SECONDS_MAX = 2

/**
 * A transition step's seconds: its own, else the house length, clamped.
 * Zero for none or absent.
 */
export function transitionSeconds(step: AnimStep | null | undefined): number {
  if (!step || step.kind === 'none') return 0
  return Math.max(
    TRANSITION_SECONDS_MIN,
    Math.min(TRANSITION_SECONDS_MAX, step.seconds ?? TRANSITION_SECONDS),
  )
}

/**
 * A slide's side: where an enter comes from, where an exit goes to. The
 * default turns the page forward: in from the right, out to the left.
 */
export function slideSide(
  step: AnimStep | null | undefined,
  which: 'enter' | 'exit',
): AnimSide {
  return step?.side ?? (which === 'enter' ? 'right' : 'left')
}
/** What WORDS can do (the per-unit kinds are text-only). */
export const TEXT_ENTER_KINDS: readonly AnimKind[] = [
  'none',
  'fade',
  'rise',
  'pop',
  'blur',
  'typewriter',
]
export const TEXT_EXIT_KINDS: readonly AnimKind[] = ['none', 'fade', 'rise']
/** What an image or a video clip can do. */
export const MEDIA_ENTER_KINDS: readonly AnimKind[] = ['none', 'fade', 'rise']
export const MEDIA_EXIT_KINDS: readonly AnimKind[] = ['none', 'fade', 'rise']
/** What a prop does while it stays. */
export const IDLE_KINDS: readonly IdleKind[] = ['spin', 'float']

/** The kinds that animate PER UNIT (word by word, letter by letter). */
const UNIT_KINDS: ReadonlySet<AnimKind> = new Set(['pop', 'blur', 'typewriter'])

/**
 * A step as an object: a bare kind becomes `{ kind }`; absent stays null so
 * a caller can tell "the house default" from "none".
 */
export function animStep(
  step: AnimKind | AnimStep | null | undefined,
): AnimStep | null {
  if (step == null) return null
  if (typeof step === 'string') return { kind: step }
  return step
}

/** The enter step of a thing, or null when it carries none. */
export function enterOf(anim: Anim | null | undefined): AnimStep | null {
  return animStep(anim?.enter)
}

/** The exit step of a thing, or null when it carries none. */
export function exitOf(anim: Anim | null | undefined): AnimStep | null {
  return animStep(anim?.exit)
}

/**
 * Whether a text clip's enter step is a PER-UNIT animation (the baked `fx`
 * payload ON_FRAME reads) rather than the block transition: a per-unit
 * kind, or a fade/rise that names its unit, stagger or seconds. A bare
 * `'rise'` stays the block transition, which is what a migrated `enter`
 * was; a migrated `fx` always names its unit, so it stays per-unit.
 */
export function isUnitStep(step: AnimStep | null): boolean {
  if (!step) return false
  if (UNIT_KINDS.has(step.kind)) return true
  if (step.kind !== 'fade' && step.kind !== 'rise') return false
  return (
    step.unit !== undefined ||
    step.stagger !== undefined ||
    step.seconds !== undefined ||
    step.direction !== undefined
  )
}

/**
 * The text-fx spec a clip's enter step describes, in the shape the fx
 * normalizer reads, or null when the clip enters by the block transition.
 */
export function overlayFxSpec(clip: TextOverlayClip): TextFxSpec | null {
  const step = enterOf(clip.anim)
  if (!isUnitStep(step) || !step || step.kind === 'none') return null
  const kind = step.kind
  const fx: TextFxSpec['fx'] =
    kind === 'fade' ||
    kind === 'rise' ||
    kind === 'pop' ||
    kind === 'blur' ||
    kind === 'typewriter'
      ? kind
      : 'rise'
  return {
    fx,
    ...(step.unit !== undefined ? { unit: step.unit } : {}),
    ...(step.direction !== undefined ? { direction: step.direction } : {}),
    ...(step.stagger !== undefined ? { stagger: step.stagger } : {}),
    ...(step.seconds !== undefined ? { duration: step.seconds } : {}),
  }
}

const BLOCK_KINDS: ReadonlySet<string> = new Set(['none', 'fade', 'rise'])

/**
 * The block transition ON_FRAME reads as `enter`: the step's kind when it
 * is one of the three transitions, the house `rise` otherwise (a per-unit
 * step bakes `fx` beside it, and ON_FRAME ignores `enter` while `fx` is
 * set, exactly as before).
 */
export function enterKey(clip: OverlayClip): 'none' | 'fade' | 'rise' {
  const step = enterOf(clip.anim)
  if (!step) return 'rise'
  return BLOCK_KINDS.has(step.kind)
    ? (step.kind as 'none' | 'fade' | 'rise')
    : 'rise'
}

/** The block transition ON_FRAME reads as `exit`. */
export function exitKey(clip: OverlayClip): 'none' | 'fade' | 'rise' {
  const step = exitOf(clip.anim)
  if (!step) return 'fade'
  return BLOCK_KINDS.has(step.kind)
    ? (step.kind as 'none' | 'fade' | 'rise')
    : 'fade'
}

/** A prop's idle motion as ON_FRAME reads it (`anim`). */
export function idleKey(clip: ObjectClip): IdleKind | null {
  const idle = clip.anim?.idle
  return idle === 'spin' || idle === 'float' ? idle : null
}

/**
 * Where the last VISUAL layer ends, in output seconds: a text, image or
 * video clip's end, a prop's span end. The output lasts at least this
 * long, so an end card is nothing but clips placed after the footage.
 * Audio never extends the output (a sound after the last picture is not a
 * thing to watch); a bed is trimmed to the output instead. A prop with no
 * span is always on and extends nothing.
 */
export function lastLayerEnd(
  doc: Pick<
    Partial<{ overlays: OverlayClip[]; objects: ObjectClip[] }>,
    'overlays' | 'objects'
  >,
): number {
  let end = 0
  for (const o of doc.overlays ?? []) end = Math.max(end, o.start + o.duration)
  for (const o of doc.objects ?? [])
    if (o.span) end = Math.max(end, o.span.start + o.span.duration)
  return Number.isFinite(end) && end > 0 ? end : 0
}
