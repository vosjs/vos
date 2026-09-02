/**
 * The action script — the declarative recipe an agent (or human) writes to
 * drive a take. Small on purpose: selectors + a handful of verbs. The recorder
 * executes it with humanized cursor motion and synthesizes the CursorTrack
 * from its own dispatches.
 */
export interface ActionsFile {
  /** Page to record. `--url` overrides. */
  url?: string
  /** Recording viewport in CSS px (default 1280x720). */
  viewport?: { width: number; height: number }
  steps: ActionStep[]
}

export type ActionStep = (
  | { do: 'wait'; ms: number }
  | { do: 'hover'; selector: string; ms?: number }
  | { do: 'click'; selector: string }
  /**
   * Type into `selector`. The recorder clicks the field first, which is what
   * opens the typing zoom on it; `focus: false` types into the field as it is
   * already focused, for a keystroke that follows earlier typing (a submitting
   * Enter) rather than starting it — a second click there rings a click effect
   * on empty space beside the text.
   */
  | {
      do: 'type'
      selector: string
      text: string
      delayMs?: number
      focus?: boolean
    }
  | { do: 'scroll'; dy: number }
  | { do: 'move'; x: number; y: number }
  /**
   * Press-move-release — real edits (drag an element on the stage canvas,
   * slide a range input, move a timeline clip). Start = the selector's center
   * when given, else (x, y); end = (tx, ty); eased over ms (default 700).
   */
  | {
      do: 'drag'
      selector?: string
      x?: number
      y?: number
      tx: number
      ty: number
      ms?: number
    }
) & {
  /**
   * Optional stable identity: anchors in doc.json name a step by this
   * id (else by index), so a step can move or gain neighbours across script
   * edits without breaking the cut anchored to it. Unique when present.
   */
  id?: string
}

const VERBS = new Set([
  'wait',
  'hover',
  'click',
  'type',
  'scroll',
  'move',
  'drag',
])

/** Structural validation with actionable messages. Returns [] when valid. */
export function validateActions(value: unknown): string[] {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null)
    return ['actions file must be a JSON object']
  const obj = value as Record<string, unknown>
  if (obj.url !== undefined && typeof obj.url !== 'string')
    errors.push('url must be a string')
  if (obj.viewport !== undefined) {
    const v: unknown = obj.viewport
    if (typeof v !== 'object' || v === null) {
      errors.push('viewport must be { width, height }')
    } else {
      const vp = v as Record<string, unknown>
      if (typeof vp.width !== 'number' || typeof vp.height !== 'number') {
        errors.push('viewport must be { width, height }')
      }
    }
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    errors.push('steps must be a non-empty array')
    return errors
  }
  const seenIds = new Set<string>()
  obj.steps.forEach((raw, i) => {
    const at = `steps[${i}]`
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${at}: must be an object`)
      return
    }
    const s = raw as Record<string, unknown>
    if (typeof s.do !== 'string' || !VERBS.has(s.do)) {
      errors.push(`${at}: "do" must be one of ${[...VERBS].join(', ')}`)
      return
    }
    if (s.id !== undefined) {
      if (typeof s.id !== 'string' || !s.id.trim()) {
        errors.push(`${at}: id must be a non-empty string`)
      } else if (seenIds.has(s.id)) {
        errors.push(
          `${at}: duplicate id "${s.id}" — an anchor could not tell the two steps apart`,
        )
      } else {
        seenIds.add(s.id)
      }
    }
    const needSelector = s.do === 'hover' || s.do === 'click' || s.do === 'type'
    if (needSelector && typeof s.selector !== 'string')
      errors.push(`${at}: ${s.do} needs a selector`)
    if (s.do === 'wait' && typeof s.ms !== 'number')
      errors.push(`${at}: wait needs ms`)
    if (s.do === 'type' && typeof s.text !== 'string')
      errors.push(`${at}: type needs text`)
    if (
      s.do === 'type' &&
      s.focus !== undefined &&
      typeof s.focus !== 'boolean'
    )
      errors.push(`${at}: type focus must be true or false`)
    if (s.do === 'scroll' && typeof s.dy !== 'number')
      errors.push(`${at}: scroll needs dy`)
    if (
      s.do === 'move' &&
      (typeof s.x !== 'number' || typeof s.y !== 'number')
    ) {
      errors.push(`${at}: move needs x and y (CSS px)`)
    }
    if (s.do === 'drag') {
      if (typeof s.tx !== 'number' || typeof s.ty !== 'number') {
        errors.push(`${at}: drag needs tx and ty (CSS px)`)
      }
      const hasStart =
        typeof s.selector === 'string' ||
        (typeof s.x === 'number' && typeof s.y === 'number')
      if (!hasStart)
        errors.push(
          `${at}: drag needs a selector OR x and y as the start point`,
        )
    }
  })
  return errors
}
