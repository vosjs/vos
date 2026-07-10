/**
 * Host-side extraction scope.
 *
 * To extract a `createTimeline` string without the engine, run it against a stub `ctx`
 * whose `gsap` is a recorder and whose elements/refs are tagged so the recorder can bind
 * targets. Element `props`/`segments` and shader uniforms — the editable idioms — resolve
 * cleanly here. Deep ref paths (`content.refs.group.rotation`) exist only against real
 * content, so host-side they record as `opaque`; full binding happens in live/sandbox
 * extraction where the real objects are present.
 */
import { tagTarget } from './target'
import { RecordingTimeline } from './recorder'
import type { TweenRecorder } from './recorder'

export interface ExtractionElement {
  props: Record<string, number>
  segments: Record<string, number>[]
}

/** Build one tagged element with `props` and `segmentCount` split segments. */
export function makeElement(id: string, segmentCount = 0): ExtractionElement {
  const props = tagTarget({} as Record<string, number>, { kind: 'element', id, scope: 'props' })
  const segments = Array.from({ length: segmentCount }, (_, i) =>
    tagTarget({} as Record<string, number>, {
      kind: 'element',
      id,
      scope: 'segment',
      segmentIndex: i,
    }),
  )
  return { props, segments }
}

/**
 * Build a `ctx.elements`-shaped Map from `{ id: segmentCount }`. A segmentCount of 0
 * yields an element with only `props`.
 */
export function makeElementsMap(spec: Record<string, number>): Map<string, ExtractionElement> {
  const map = new Map<string, ExtractionElement>()
  for (const [id, count] of Object.entries(spec)) map.set(id, makeElement(id, count))
  return map
}

/** Tag each uniform object (`{ value }`) so `content.refs.uniforms.<name>` binds. */
export function tagUniforms<T extends Record<string, object>>(uniforms: T): T {
  for (const name of Object.keys(uniforms)) {
    tagTarget(uniforms[name], { kind: 'uniform', path: name })
  }
  return uniforms
}

/** Tag a top-level named ref object so `content.refs.<name>` binds. */
export function tagRef<T extends object>(obj: T, path: string): T {
  return tagTarget(obj, { kind: 'ref', path })
}

interface RecorderCtx {
  gsap: TweenRecorder
  [k: string]: unknown
}

/**
 * Evaluate a `createTimeline` function string against a recorder-backed `ctx` and return
 * the recorded timeline. Best-effort: if the body throws partway, whatever was recorded
 * on the recorder's last timeline is still returned (so partial extraction survives).
 */
export function runCreateTimeline(
  source: string,
  ctx: RecorderCtx,
  content: { refs?: Record<string, unknown> } = { refs: {} },
  duration = 1,
): RecordingTimeline | null {
  let fn: (...args: unknown[]) => unknown
  try {
    fn = new Function('return (' + source + ')')() as typeof fn
  } catch {
    return null
  }
  let result: unknown
  try {
    result = fn(ctx, content, duration)
  } catch {
    // fall through to the last recorded timeline
  }
  if (result instanceof RecordingTimeline) return result
  const tls = ctx.gsap.timelines
  return tls.length ? tls[tls.length - 1] : null
}
