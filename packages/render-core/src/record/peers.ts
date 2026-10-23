/**
 * `peers`: other people on the same page, off camera. A collaboration
 * product shows best with a second person on the canvas: their cursor, the
 * shape they drew, the comment they left, arriving in the filmed page the
 * way the app syncs them. A peer is a second browser context (its own
 * cookies, so its own user, from its own storage state or none) on the
 * same URL, driven by its own step list, interleaved with the take's.
 *
 * What a peer is, and is not:
 *
 * - NOT FILMED. Only the take's own page is captured. A peer's page is
 *   never screencast, scanned, masked or listened to; what it does reaches
 *   the footage only through the app (its sync, its presence, its remote
 *   cursors), which is what a viewer would see.
 * - NOT ON THE CURSOR TRACK. A peer's pointer moves its own page; the take's
 *   CursorTrack is synthesized from the take's own steps alone, so a zoom,
 *   a click ring or a dwell is never planned on a peer's gesture.
 * - ORDERED BY THE TAKE'S STEPS. A peer step may name a take step by id:
 *   `with` starts it as that step starts (the two run together), `after` as
 *   that step ends. A step naming neither follows the peer's previous step
 *   at once; a peer's first step with neither starts as the camera rolls.
 *   The take never waits on a peer: it waits on what the peer's work
 *   SHOWS, with an `expect` or an `await` on its own page, so the footage
 *   holds exactly the moment the sync landed. When the take's steps end,
 *   a peer step still waiting on a trigger never runs (said), and one
 *   already running finishes, bounded, before the trailing hold.
 * - PACED, NOT INSTANT. A peer's pointer glides on the same clock as the
 *   take's (an app that draws remote cursors shows it travelling) and its
 *   typing is paced per key, so what it does reads as a person.
 * - BOUNDED. Every peer step runs inside its own bound, as a take step
 *   does; a selector that never appears or a check that never holds is a
 *   skip with its reason, listed with the take's (`--strict` fails on it).
 *
 * A peer takes the take's gestures and checks (`wait`, `move`, `hover`,
 * `click`, `type`, `press`, `scroll`, `drag` with an inline `path`, and
 * `expect`), never a `paste`, a `download`, an `await` (a peer that must
 * wait for a result is the take's `await`), a guard, a `read`, a `caption`
 * or `settle`, which all belong to the filmed page.
 */
import type { ActionStep } from './actions'
import type { RecorderClock, RecorderPage } from './driver'
import {
  DRAG_HOLD_MS,
  KEY_SEQUENCE_GAP_MS,
  MULTI_CLICK_GAP_MS,
  pressSequence,
  readPath,
  resolveChord,
  resolveModifier,
  schedulePath,
} from './gestures'
import type { ClickButton, DragModifier } from './gestures'
import {
  PRESS_HOLD_MS,
  PRESS_LEAD_MS,
  SETTLE_MS,
  askedMs,
  clockMotion,
  clockTyping,
  pointerTravelMs,
} from './pace'
import { StepBound, bounded, stepBoundMs } from './stepBound'
import { conditionMiss, pollCondition, sayCondition } from './waits'
import type { ConditionState, WaitCondition } from './waits'
import { urlSchemeProblem } from './setup'
import type { PeerStepSpan } from '@vosjs/studio-core'

/** One other person on the page: their own context, their own steps. */
export interface Peer {
  /** How the peer is named in lines and in `meta.peers`: a short word. */
  id: string
  /** The page the peer opens; absent, the take's own `url`. */
  url?: string
  /** The peer's viewport in CSS px; absent, the take's. */
  viewport?: { width: number; height: number }
  /**
   * A Playwright storage state the peer's context is made from: the second
   * person's own sign-in. The host resolves the name (the CLI: a path from
   * the actions file's directory) and never sends the file anywhere.
   * Absent, the peer is signed out.
   */
  storageState?: string
  steps: PeerStep[]
}

/** A peer's step: one of the take's gestures or checks, and when it starts. */
export type PeerStep = ActionStep & {
  /**
   * Start as the take's step with this id starts: the two run together.
   * (`with`, never `at`: a `type` step's `at` is where its caret goes.)
   */
  with?: string
  /** Start as the take's step with this id ends. */
  after?: string
}

/** The verbs a peer takes: the gestures and the on-page check. */
export const PEER_VERBS = [
  'wait',
  'move',
  'hover',
  'click',
  'type',
  'press',
  'scroll',
  'drag',
  'expect',
] as const

/** The most peers a take may have: each is a whole browser context. */
export const MAX_PEERS = 4
/** The most steps one peer may take. */
export const MAX_PEER_STEPS = 200

/** Fields a take step carries that a peer's never does, and why. */
const TAKE_ONLY: Record<string, string> = {
  guard: 'a guard is pressed only on the filmed page, under --confirm',
  read: 'read keeps words from the filmed page',
  caption: 'a caption is a beat of the film, which is the take’s',
  settle: 'settle reads the filmed page’s frames',
  zoom: 'a zoom mark picks a moment on the cursor track, and a peer is never on it',
}

const PEER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/

/**
 * Structural validation of `peers`, given the take's own steps (a trigger
 * names one of their ids). `validate` is the take's step validator, run on
 * each peer's list so a peer step is checked in exactly the take's words.
 */
export function validatePeers(
  value: unknown,
  takeSteps: unknown,
  validate: (steps: unknown[]) => string[],
): string[] {
  if (!Array.isArray(value))
    return [
      'peers must be an array of { id, url?, viewport?, storageState?, steps }',
    ]
  const errors: string[] = []
  if (value.length > MAX_PEERS)
    errors.push(
      `peers names ${value.length} peers; a take holds at most ${MAX_PEERS} (each is a whole browser)`,
    )
  const takeIds = new Set(
    (Array.isArray(takeSteps) ? takeSteps : [])
      .map((s) => (s as { id?: unknown } | null)?.id)
      .filter((id): id is string => typeof id === 'string'),
  )
  const seen = new Set<string>()
  value.forEach((raw, i) => {
    const at = `peers[${i}]`
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push(`${at}: must be an object`)
      return
    }
    const p = raw as Record<string, unknown>
    if (typeof p.id !== 'string' || !PEER_ID.test(p.id))
      errors.push(
        `${at}: id must be a short word (letters, digits, - and _, at most 32), which lines and meta.peers name the peer by`,
      )
    else if (seen.has(p.id)) errors.push(`${at}: duplicate peer id "${p.id}"`)
    else seen.add(p.id)
    if (p.url !== undefined) {
      if (typeof p.url !== 'string') errors.push(`${at}: url must be a string`)
      else {
        const problem = urlSchemeProblem(p.url)
        if (problem) errors.push(`${at}: url ${problem}`)
      }
    }
    if (p.viewport !== undefined) {
      const v = p.viewport as Record<string, unknown> | null
      if (
        typeof v !== 'object' ||
        v === null ||
        typeof v.width !== 'number' ||
        typeof v.height !== 'number'
      )
        errors.push(`${at}: viewport must be { width, height }`)
    }
    if (
      p.storageState !== undefined &&
      (typeof p.storageState !== 'string' || !p.storageState.trim())
    )
      errors.push(
        `${at}: storageState must name a Playwright storage state file (the second person's sign-in)`,
      )
    for (const k of Object.keys(p))
      if (!['id', 'url', 'viewport', 'storageState', 'steps'].includes(k))
        errors.push(
          `${at}: a peer takes id, url, viewport, storageState and steps, not ${k}`,
        )
    if (!Array.isArray(p.steps) || p.steps.length === 0) {
      errors.push(`${at}: steps must be a non-empty array`)
      return
    }
    if (p.steps.length > MAX_PEER_STEPS)
      errors.push(
        `${at}: steps holds ${p.steps.length} steps; a peer takes at most ${MAX_PEER_STEPS}`,
      )
    const steps = p.steps as unknown[]
    steps.forEach((rawStep, j) => {
      const sat = `${at}.steps[${j}]`
      if (typeof rawStep !== 'object' || rawStep === null) return
      const s = rawStep as Record<string, unknown>
      if (
        typeof s.do === 'string' &&
        !(PEER_VERBS as readonly string[]).includes(s.do)
      )
        errors.push(
          `${sat}: a peer step is one of ${PEER_VERBS.join(', ')}; ${/^[aeiou]/.test(s.do) ? 'an' : 'a'} ${s.do} belongs to the filmed page${s.do === 'await' ? ' (wait for what the peer did with the take’s own await or expect)' : ''}`,
        )
      for (const [k, why] of Object.entries(TAKE_ONLY))
        if (s[k] !== undefined)
          errors.push(`${sat}: no ${k} on a peer step: ${why}`)
      if (s.do === 'drag' && typeof s.path === 'string')
        errors.push(
          `${sat}: a peer draws its path inline (an array of points), never from a file`,
        )
      if (s.with !== undefined && s.after !== undefined)
        errors.push(
          `${sat}: with or after, not both (with starts as the take's step starts, after once it ends)`,
        )
      for (const k of ['with', 'after'] as const) {
        const v = s[k]
        if (v === undefined) continue
        if (typeof v !== 'string' || !v.trim())
          errors.push(`${sat}: ${k} must name a take step by its id`)
        else if (!takeIds.has(v))
          errors.push(
            `${sat}: ${k} "${v}" names no take step (the take's steps with ids: ${takeIds.size ? [...takeIds].join(', ') : 'none'}); give the take step an id`,
          )
      }
    })
    for (const e of validate(steps))
      errors.push(e.replace(/^steps\[/, `${at}.steps[`))
  })
  return errors
}

/** What a hosted recorder says of a script with peers, or null. */
export function peersHostedRefusal(peers: unknown): string | null {
  if (!Array.isArray(peers) || !peers.length) return null
  return 'the script has peers (more browsers on the page, off camera), and a hosted take runs one browser: record it on this machine'
}

/**
 * The take's step boundaries, as promises a peer step waits on. The take
 * calls `begin` as the camera rolls, `start`/`end` around each step and
 * `close` once its steps are over; a trigger still pending then resolves
 * false and its step never runs.
 */
export class StepSignals {
  private readonly started = new Map<string, Deferred>()
  private readonly ended = new Map<string, Deferred>()
  private readonly began = deferred()
  private closed = false

  constructor(ids: Iterable<string>) {
    for (const id of ids) {
      this.started.set(id, deferred())
      this.ended.set(id, deferred())
    }
  }

  begin(): void {
    this.began.resolve(true)
  }

  start(id: string | undefined): void {
    if (id) this.started.get(id)?.resolve(true)
  }

  end(id: string | undefined): void {
    if (id) this.ended.get(id)?.resolve(true)
  }

  close(): void {
    this.closed = true
    this.began.resolve(false)
    for (const d of [...this.started.values(), ...this.ended.values()])
      d.resolve(false)
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** When a step with this trigger may start: true, or false for never. */
  when(trigger: { with?: string; after?: string }): {
    ready: Promise<boolean>
    already: boolean
  } {
    const d = trigger.with
      ? this.started.get(trigger.with)
      : trigger.after
        ? this.ended.get(trigger.after)
        : this.began
    if (!d) return { ready: Promise.resolve(false), already: false }
    return { ready: d.promise, already: d.settled }
  }
}

interface Deferred {
  promise: Promise<boolean>
  resolve: (v: boolean) => void
  settled: boolean
}

function deferred(): Deferred {
  let resolve: (v: boolean) => void = () => {}
  const d: Deferred = {
    promise: new Promise<boolean>((r) => {
      resolve = r
    }),
    resolve: (v) => {
      if (d.settled) return
      d.settled = true
      resolve(v)
    },
    settled: false,
  }
  return d
}

/** One peer step as it ran, in the take's footage seconds. */
export type { PeerStepSpan } from '@vosjs/studio-core'

/** The most a peer step's kept value holds, in characters of JSON (as a take step's). */
export const PEER_VALUE_MAX = 2048

/**
 * What a peer's check last answered, kept on its step the way the take's
 * own steps keep theirs (`meta.steps[].value`): the value itself while its
 * JSON fits, else that JSON cut short as a string; absent when the read
 * answered nothing JSON can hold, or no value at all (a check that only
 * holds or not).
 */
export function peerValue(last: ConditionState): unknown {
  if (!('value' in last)) return undefined
  const value = (last as { value?: unknown }).value
  const json = JSON.stringify(value)
  if (json === undefined) return undefined
  return json.length <= PEER_VALUE_MAX
    ? value
    : `${json.slice(0, PEER_VALUE_MAX - 1)}…`
}

/** What a peer did: its steps as they ran, and the ones that never did. */
export interface PeerRun {
  id: string
  steps: PeerStepSpan[]
  /** Steps whose trigger never fired before the take's steps were over. */
  notRun: number[]
}

/** A selector's centre, or a viewport point. */
type Spot = { x: number; y: number }

const EXPECT_TIMEOUT_S = 5
const EXPECT_EVERY_MS = 150

/**
 * Drive one peer's steps on its page, each when its trigger fires. Never
 * throws for a page's reasons: a miss is a skip on the run.
 */
export async function runPeer(
  peer: Peer,
  rawPage: RecorderPage,
  signals: StepSignals,
  opts: {
    clock: RecorderClock
    /** The take's footage clock, ms: what a span is placed by. */
    footageMs: () => number
    log: (msg: string) => void
    /** A rehearsal: no travel, every pause cut short. */
    dry?: boolean
  },
): Promise<PeerRun> {
  const bound = new StepBound()
  const page = bounded(rawPage, bound)
  const { clock, log } = opts
  const run: PeerRun = { id: peer.id, steps: [], notRun: [] }
  const cur = { x: 24, y: 24 }
  const moveTo = async (tx: number, ty: number) => {
    const from = { ...cur }
    const dist = Math.hypot(tx - from.x, ty - from.y)
    await clockMotion(
      opts.dry ? 0 : pointerTravelMs(dist),
      async (u) => {
        cur.x = from.x + (tx - from.x) * u
        cur.y = from.y + (ty - from.y) * u
        await page.mouse.move(cur.x, cur.y)
      },
      clock,
    )
  }
  const spotOf = async (s: {
    selector?: string
    x?: number
    y?: number
  }): Promise<Spot | null> => {
    if (s.selector === undefined) return { x: s.x ?? cur.x, y: s.y ?? cur.y }
    const loc = page.locator(s.selector).first()
    try {
      await loc.waitFor({ state: 'visible', timeout: 8000 })
      await loc.scrollIntoViewIfNeeded()
      const bb = await loc.boundingBox()
      return bb ? { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 } : null
    } catch {
      return null
    }
  }
  const press = async (how: {
    count?: number
    button?: ClickButton
    modifiers?: DragModifier[]
  }) => {
    const held: string[] = []
    try {
      for (const m of how.modifiers ?? []) {
        const key = resolveModifier(m)
        await page.keyboard.down(key)
        held.push(key)
      }
      await clock.sleep(PRESS_LEAD_MS)
      const count = how.count ?? 1
      for (let n = 1; n <= count; n++) {
        if (n > 1) await clock.sleep(MULTI_CLICK_GAP_MS)
        const o = {
          ...(how.button && how.button !== 'left'
            ? { button: how.button }
            : {}),
          ...(n > 1 ? { clickCount: n } : {}),
        }
        const has = Object.keys(o).length > 0
        await (has ? page.mouse.down(o) : page.mouse.down())
        await clock.sleep(PRESS_HOLD_MS)
        await (has ? page.mouse.up(o) : page.mouse.up())
      }
    } finally {
      for (const key of held.reverse())
        await page.keyboard.up(key).catch(() => undefined)
    }
  }

  for (const [i, step] of peer.steps.entries()) {
    const tag = `peer ${peer.id} #${i}${step.id ? ` ${step.id}` : ''}`
    const trigger = signals.when(step)
    const go = await trigger.ready
    if (!go) {
      run.notRun = peer.steps.slice(i).map((_, k) => i + k)
      log(
        `   (${tag} ${step.do}: not run: ${step.with ? `the take's step ${step.with} never started` : step.after ? `the take's step ${step.after} never ended` : 'the take ended first'})`,
      )
      break
    }
    const late =
      (step.with !== undefined || step.after !== undefined) && trigger.already
    const tStart = opts.footageMs()
    let selector: string | undefined
    let reason: string | null = null
    let value: unknown
    bound.start(
      stepBoundMs(
        step as Parameters<typeof stepBoundMs>[0],
        askedMs(step as Parameters<typeof askedMs>[0]),
        { expectS: EXPECT_TIMEOUT_S, awaitS: 0, downloadS: 0 },
      ),
    )
    try {
      switch (step.do) {
        case 'wait':
          await clock.sleep(step.ms)
          break
        case 'move':
          await moveTo(step.x, step.y)
          break
        case 'hover': {
          selector = step.selector
          const spot = await spotOf(step)
          if (!spot) reason = `'${step.selector}' never appeared`
          else {
            await moveTo(spot.x, spot.y)
            await clock.sleep(step.ms ?? 700)
          }
          break
        }
        case 'click': {
          selector = step.selector
          const spot = await spotOf(step)
          if (!spot) {
            reason = `'${step.selector}' never appeared`
            break
          }
          await moveTo(spot.x, spot.y)
          await press(step)
          await clock.sleep(step.ms ?? SETTLE_MS.click)
          break
        }
        case 'type': {
          selector = step.selector
          if (step.focus !== false) {
            const spot = await spotOf(step)
            if (!spot) {
              reason = `'${step.selector}' never appeared`
              break
            }
            await moveTo(spot.x, spot.y)
            await press({})
          }
          if (step.at === 'end') await page.keyboard.press('End')
          else if (step.at === 'start') await page.keyboard.press('Home')
          if (step.replace) await page.keyboard.press('ControlOrMeta+a')
          await clockTyping(
            [...step.text],
            opts.dry ? 0 : (step.delayMs ?? 40),
            (ch) => page.keyboard.type(ch),
            clock,
          )
          await clock.sleep(step.ms ?? SETTLE_MS.type)
          break
        }
        case 'press': {
          selector = step.selector
          if (step.selector !== undefined) {
            const spot = await spotOf(step)
            if (!spot) {
              reason = `'${step.selector}' never appeared`
              break
            }
          }
          const keys = pressSequence(step)
          for (const [k, key] of keys.entries()) {
            if (k > 0) await clock.sleep(KEY_SEQUENCE_GAP_MS)
            await page.keyboard.press(resolveChord(key))
          }
          await clock.sleep(step.ms ?? SETTLE_MS.press)
          break
        }
        case 'scroll':
          await page.mouse.wheel(0, step.dy)
          await clock.sleep(step.ms ?? 200)
          break
        case 'drag': {
          selector = step.selector
          const read = step.path !== undefined ? readPath(step.path) : null
          if (read && 'problems' in read) {
            reason = `its path ${read.problems.join('; ')}`
            break
          }
          const held: string[] = []
          try {
            if (read) {
              const sched = schedulePath(read, step.ms)
              await moveTo(sched[0].x, sched[0].y)
              for (const m of step.modifiers ?? []) {
                const key = resolveModifier(m)
                await page.keyboard.down(key)
                held.push(key)
              }
              await page.mouse.down()
              const t0 = clock.now()
              for (const p of sched.slice(1)) {
                const wait = t0 + (opts.dry ? 0 : p.at) - clock.now()
                if (wait > 0) await clock.sleep(wait)
                cur.x = p.x
                cur.y = p.y
                await page.mouse.move(p.x, p.y)
              }
            } else {
              const start = await spotOf(step)
              if (!start) {
                reason = `'${step.selector}' never appeared`
                break
              }
              await moveTo(start.x, start.y)
              for (const m of step.modifiers ?? []) {
                const key = resolveModifier(m)
                await page.keyboard.down(key)
                held.push(key)
              }
              await page.mouse.down()
              const from = { ...cur }
              const tx = step.tx as number
              const ty = step.ty as number
              await clockMotion(
                opts.dry ? 0 : (step.ms ?? 700),
                async (u) => {
                  cur.x = from.x + (tx - from.x) * u
                  cur.y = from.y + (ty - from.y) * u
                  await page.mouse.move(cur.x, cur.y)
                },
                clock,
              )
            }
            await page.mouse.up()
          } finally {
            for (const key of held.reverse())
              await page.keyboard.up(key).catch(() => undefined)
          }
          await clock.sleep(DRAG_HOLD_MS)
          break
        }
        case 'expect': {
          const cond: WaitCondition = step
          selector = step.selector ?? step.gone
          const timeoutMs = (step.timeout ?? EXPECT_TIMEOUT_S) * 1000
          const res = await pollCondition(page, cond, {
            timeoutMs,
            everyMs: EXPECT_EVERY_MS,
            sleep: clock.sleep,
          })
          value = peerValue(res.last)
          if (!res.ok) reason = conditionMiss(cond, res.last, timeoutMs)
          else log(`   ${tag} expect ${sayCondition(cond)}: holds`)
          break
        }
        default:
          reason = `a peer does not ${step.do}`
      }
    } catch (e) {
      reason = e instanceof Error ? e.message.split('\n')[0] : String(e)
    }
    const hang = bound.end()
    if (hang.hung)
      reason = `the page stopped answering: this ${step.do} ran past its bound`
    if (reason) log(`   (${tag} ${step.do}: ${reason})`)
    else if (step.do !== 'expect')
      log(`   ${tag} ${step.do}${selector ? ` ${selector}` : ''}`)
    run.steps.push({
      step: i,
      ...(step.id ? { id: step.id } : {}),
      do: step.do,
      ...(step.with ? { with: step.with } : {}),
      ...(step.after ? { after: step.after } : {}),
      ...(selector ? { selector } : {}),
      tStart: +(tStart / 1000).toFixed(3),
      tEnd: +(opts.footageMs() / 1000).toFixed(3),
      ...(reason ? { skipped: true, reason } : {}),
      ...(late ? { late: true } : {}),
      ...(value !== undefined ? { value } : {}),
    })
  }
  return run
}
