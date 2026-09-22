/**
 * The shot list: an `actions.json` said in words, for a person who will
 * record it by hand. The last rung of the session ladder is "the human
 * records, the agent cuts", and an agent that falls to it should hand over
 * more than an apology: the flow it worked out, as numbered beats with the
 * pace it wanted, so its knowledge survives the hop to a human. The take
 * comes back through the ordinary handoff and the agent cuts it.
 *
 * Pure: an ActionsFile in, lines out. Selectors are said as what they name
 * where the script says (an id, a caption, a text= locator), and as the
 * selector itself where it does not: a person reading `#filter-late` can
 * find it; a person reading nothing cannot.
 */
import type { ActionStep, ActionsFile } from './actions'
import { askedMs } from './pace'

export interface ShotBeat {
  n: number
  /** what to do, in words */
  line: string
  /** how long to hold after, in seconds, when the script asks for a hold */
  holdS?: number
}

export interface ShotList {
  url?: string
  viewport?: { width: number; height: number }
  beats: ShotBeat[]
  /** the take's asked length, from the script's own pacing */
  aboutS: number
  setup: number
}

/** A selector as a person reads it: the text it names, or the selector itself. */
export function sayTarget(selector: string): string {
  const text = /^text=(['"]?)(.+?)\1$/.exec(selector)
  if (text) return `"${text[2]}"`
  const has = /:has-text\((['"])(.+?)\1\)/.exec(selector)
  if (has) return `"${has[2]}"`
  const role = /getByRole\(['"](\w+)['"],\s*\{\s*name:\s*(['"])(.+?)\2/.exec(
    selector,
  )
  if (role) return `the ${role[1]} "${role[3]}"`
  const label = /\[aria-label=(['"])(.+?)\1\]/.exec(selector)
  if (label) return `"${label[2]}"`
  const ph = /\[placeholder=(['"])(.+?)\1\]/.exec(selector)
  if (ph) return `the "${ph[2]}" field`
  return `\`${selector}\``
}

const s1 = (ms: number) => `${Math.round(ms / 100) / 10}`.replace(/\.0$/, '')

/** A step's id, said as a name when it reads as one (`late`, `new-order`, `openBilling`). */
export function sayId(id: string | undefined): string | null {
  if (!id || /^\d+$/.test(id) || id.length < 3) return null
  const words = id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .trim()
  return words.length >= 3 ? words : null
}

/** What a step points at, for a person: the words the selector names, else the id's, else the selector. */
function sayStepTarget(step: { selector: string; id?: string }): string {
  const bySelector = sayTarget(step.selector)
  if (!bySelector.startsWith('`')) return bySelector
  const byId = sayId(step.id)
  return byId ? `${byId} (${bySelector})` : bySelector
}

function beatOf(step: ActionStep): string | null {
  const cap = step.caption
  const named = cap ? `${cap}: ` : ''
  switch (step.do) {
    case 'wait':
      return null
    case 'hover':
      return `${named}Rest the pointer on ${sayStepTarget(step)}`
    case 'click':
      return `${named}Click ${sayStepTarget(step)}`
    case 'type':
      return `${named}Type "${step.text}" into ${sayStepTarget(step)}`
    case 'scroll':
      return `${named}Scroll ${step.dy < 0 ? 'up' : 'down'} ${step.dy < 0 ? 'a little' : 'a little'}`
    case 'move':
      return `${named}Move the pointer to the ${step.y < 360 ? 'upper' : 'lower'} ${step.x < 640 ? 'left' : 'right'}`
    case 'drag':
      return `${named}Drag ${step.selector ? sayStepTarget(step as { selector: string; id?: string }) : 'from the start point'} across`
  }
}

export function shotList(actions: ActionsFile): ShotList {
  const beats: ShotBeat[] = []
  let pendingHold = 0
  let total = 0
  for (const step of actions.steps) {
    total += askedMs(step)
    if (step.do === 'wait') {
      // A wait after a beat is that beat's hold; a leading wait is the
      // settle before the first, which a person does without being told.
      if (beats.length) {
        const last = beats[beats.length - 1]
        last.holdS = (last.holdS ?? 0) + step.ms / 1000
      } else pendingHold += step.ms
      continue
    }
    const line = beatOf(step)
    if (!line) continue
    const beat: ShotBeat = { n: beats.length + 1, line }
    if (step.do === 'hover') beat.holdS = askedMs(step) / 1000
    beats.push(beat)
  }
  void pendingHold
  return {
    url: actions.url,
    viewport: actions.viewport,
    beats,
    // gestures the recorder adds around each ask: about a second a beat
    aboutS: Math.round((total + beats.length * 1000) / 1000),
    setup: actions.setup?.length ?? 0,
  }
}

/** The list as the person reads it. */
export function formatShotList(list: ShotList): string {
  const out: string[] = []
  out.push(
    `Record this with the vosso extension in your own signed-in browser, about ${list.aboutS} seconds${list.viewport ? `, window about ${list.viewport.width}×${list.viewport.height}` : ''}.`,
  )
  if (list.url)
    out.push(`Start on ${list.url}, signed in, with the page settled.`)
  if (list.setup)
    out.push(
      `Before you press record: the script's ${list.setup} setup step${list.setup === 1 ? '' : 's'} (sign in, dismiss banners) are yours to do first; they are not part of the take.`,
    )
  out.push('')
  for (const b of list.beats) {
    const hold =
      b.holdS && b.holdS >= 0.4 ? ` Hold ${s1(b.holdS * 1000)} s.` : ''
    out.push(`${b.n}. ${b.line}.${hold}`)
  }
  out.push('')
  out.push(
    'Move at a talking pace, let each screen settle before the next beat, and end on the finished state. Press the icon again to stop; the take opens in the studio and saves to your shelf.',
  )
  return out.join('\n')
}
