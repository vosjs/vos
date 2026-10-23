/**
 * The recorder — a browser drives the action script while:
 *  - CDP Page.startScreencast collects JPEG frames (epoch-timestamped;
 *    hold-last-frame gaps are filled at encode time), and
 *  - every dispatched input is logged as a CursorEvent (the synthesized track:
 *    exact coords, exact times, fresh element rects — no capture needed).
 *
 * The MECHANISM, host-free (AN4): the browser arrives as a structural driver
 * (a launched Node Playwright browser from the CLI, a connected
 * @cloudflare/playwright browser from the fleet), frames leave through a
 * sink, the platform and the setup env are handed in, and nothing here
 * touches a filesystem or a process. The CLI's `recordTake` wraps this with
 * a take directory; the fleet's consumer wraps it with R2. Both produce the
 * same events, meta and frame index for the same script.
 */
import type {
  FrameSink,
  OutputSink,
  SoundSink,
  RecorderBrowser,
  RecorderClock,
  RecorderContext,
  ScriptFiles,
} from './driver'
import { realSleep } from './driver'
import { capReached, cappedLine, clampWait } from './cap'
import {
  PRESS_HOLD_MS,
  PRESS_LEAD_MS,
  SCROLL_SETTLE_MS,
  TRAILING_HOLD_MS,
  askedMs,
  deadLine,
  deadTime,
  deadWarns,
  holdLeftMs,
  settleVerdict,
  clockMotion,
  clockTyping,
  paceLine,
  paceReport,
  pointerTravelMs,
  scrollTravelMs,
  settleMs,
} from './pace'
import type { DeadReport, PaceReport, StepPace } from './pace'
import type {
  CursorEvent,
  RecordingMeta,
  RecordingOutput,
  RecordingSkip,
  Rect,
  StepSpan,
} from '@vosjs/studio-core'
import { WALL_PROBE } from './wall'
import {
  EXPOSURE_PROBE,
  ExposureLog,
  NoticeLog,
  maskInitScript,
} from './exposure'
import type { ScannedNotice } from './exposure'
import { SetupError, runSetup } from './setup'
import { StepBound, bounded, stepBoundMs } from './stepBound'
import {
  MEDIA_DRAIN_PROBE,
  MEDIA_WATCH_SCRIPT,
  PageSoundLog,
} from './pageSound'
import type { MediaDrain } from './pageSound'
import { TakeClock } from './takeClock'
import { PageErrorLog } from './pageErrors'
import { fitSurfaceToViewport } from './surfaceFit'
import type { PageError } from './pageErrors'
import {
  AWAIT_POLL_S,
  AWAIT_TIMEOUT_S,
  DOWNLOAD_TIMEOUT_S,
  EXPECT_TIMEOUT_S,
  guardVerdict,
} from './actions'
import type { ActionsFile } from './actions'
import { DEFAULT_READY, readyLine, reloadUntilReady, untilReady } from './ready'
import type { ReadyReport } from './ready'
import {
  DRAG_HOLD_MS,
  KEY_SEQUENCE_GAP_MS,
  MULTI_CLICK_GAP_MS,
  keySequencePlanMs,
  buttonNumber,
  modifierBits,
  overrunLine,
  overrunOf,
  pathDurationMs,
  pressSequence,
  resolveChord,
  resolveModifier,
  readPath,
  schedulePath,
} from './gestures'
import type {
  ClickButton,
  DragModifier,
  PathSample,
  StepOverrun,
} from './gestures'
import { inlineScript, loadScriptFiles } from './scriptFiles'
import type { LoadedFiles } from './scriptFiles'
import { pasteItemOf, runPaste } from './pasteStep'
import { CHANGE_AGE_PROBE, appSettled, settleOn } from './settle'
import {
  conditionMiss,
  keptValue,
  pollCondition,
  sayCondition,
  sayDuration,
} from './waits'
import type { ConditionState, PollResult, WaitCondition } from './waits'
import {
  OUTPUT_MAX_BYTES,
  readMediaSource,
  fetchInPageScript,
  nameFromUrl,
  outputName,
  readAllBytes,
} from './outputs'

/** How often an `expect` looks, in ms: on camera, so a beat, not a poll. */
const EXPECT_EVERY_MS = 100
/** How long a `download` src waits for its element to have a source. */
const SRC_WAIT_MS = 8000
/** How often a long `await` says it is still waiting, in ms. */
export const AWAIT_HEARTBEAT_MS = 30_000
/** An `await` that held sooner than this cut nothing: no skip, no segment split. */
export const MIN_SKIP_MS = 250

/** How long a `read` waits for its element after the step settled. */
const READ_WAIT_MS = 1500
/** The most a step's `read` keeps: a payload, never a page. */
const READ_MAX_CHARS = 2048

/**
 * The headers a request carries, or null to leave it alone: a job's
 * headers (a preview's bypass token) go to the ORIGIN the take is of and
 * nowhere else, since the recorded page embeds whatever third parties it
 * likes and a redirect can land anywhere.
 */
export function headersFor(
  requestUrl: string,
  entryUrl: string,
  headers: Record<string, string>,
): Record<string, string> | null {
  try {
    return new URL(requestUrl).origin === new URL(entryUrl).origin
      ? headers
      : null
  } catch {
    return null
  }
}

async function applyHeaders(
  context: RecorderContext,
  headers: Record<string, string>,
  entryUrl: string,
  log: (msg: string) => void,
): Promise<void> {
  if (!context.route) {
    await context.setExtraHTTPHeaders(headers)
    log('   (this browser scopes no headers: they ride every request)')
    return
  }
  await context.route('**/*', async (route) => {
    const req = route.request()
    const scoped = headersFor(req.url(), entryUrl, headers)
    await route.continue(
      scoped ? { headers: { ...req.headers(), ...scoped } } : undefined,
    )
  })
}

/** A page URL as a take keeps it: origin and path, never a query or a hash. */
export function publicUrl(u: string): string {
  try {
    const x = new URL(u)
    return `${x.origin}${x.pathname}`
  } catch {
    return ''
  }
}
import type { Arrival, WallVerdict } from './wall'

export interface FrameRec {
  file: string
  /** ms since t0 */
  tMs: number
}

export interface SkippedStep {
  /** index into actions.steps */
  step: number
  id?: string
  do: string
  selector: string
  /** why, when it is not a selector that never appeared: an expect that never held, a download that never came */
  reason?: string
}

/** A click whose target was disabled when it was pressed: the press happened, and likely did nothing. */
export interface DisabledClick {
  step: number
  id?: string
  selector: string
}

/** An `await` that timed out with `onTimeout: "fail"`: the take stopped there. */
export interface StoppedTake {
  step: number
  id?: string
  reason: string
}

/** Thrown before anything is captured: a guarded step the command did not confirm, a download with nowhere to land. */
export class RecordRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordRefusedError'
  }
}

/** A stretch with no screencast frames — the page pixels did not change. */
export interface FreezeSpan {
  /** seconds into the take */
  from: number
  to: number
  ms: number
}

export interface RecordResult {
  events: CursorEvent[]
  frames: FrameRec[]
  meta: RecordingMeta
  /** The take's pace: what the script asked, what the gestures added, what the page cost. */
  pace: PaceReport
  /** steps whose selector never became visible — the take continued without them. */
  skipped: SkippedStep[]
  /** `ready: "networkidle"` was asked for and the first load never reached it (recording proceeded anyway). */
  navTimeout: boolean
  /** How the first load settled before step 1. */
  ready: ReadyReport
  /** A wall the caller let through; null when the recorder landed where it was asked. */
  wall: WallVerdict | null
  /** Sensitive-looking text seen in the frame (kind + place, never the string). */
  exposures: NonNullable<RecordingMeta['exposures']>
  /**
   * INFORMATION, never a failure and never in `exposures`: the signed-in
   * account's own name and its recent-items lists (also `meta.notices`).
   */
  notices: NonNullable<RecordingMeta['notices']>
  /** The script's masks with how many elements each reached; hits 0 hid nothing. */
  masks: NonNullable<RecordingMeta['masks']>
  /**
   * Smoothness telemetry: stretches ≥400ms with no visual change. Frozen
   * footage is the #1 enemy of a smooth product video — either the flow should
   * keep motion in frame (animate, hover a preview, scroll) or the doc should
   * trim/speed through these. freezePct = share of the take that is frozen.
   */
  freezes: FreezeSpan[]
  freezePct: number
  /**
   * The smoothness WARNING: still footage under a parked cursor past the
   * beat it takes to read what changed, per step (`deadTime`). A still page
   * being read is content; this is the part of a hold nobody is reading.
   */
  dead: DeadReport
  /** The take reached --max-duration and stopped there; later steps did not run. */
  capped: boolean
  /** Clicks pressed on a disabled target (reported; `--strict` fails on them). */
  disabled: DisabledClick[]
  /** The ids of the guarded steps this take pressed, because the command named them. */
  confirmed: string[]
  /** The cuts `await` steps made (also `meta.skips`). */
  skips: RecordingSkip[]
  /** The files `download` steps kept (also `meta.outputs`). */
  outputs: RecordingOutput[]
  /** The sound the page played, each heard stretch in footage seconds (also `meta.media`). */
  media: NonNullable<RecordingMeta['media']>
  /** An `await` timed out and the take stopped there; null when it ran to the end. */
  stopped: StoppedTake | null
  /** The page's own console errors, each distinct one with its full text and how often it came. */
  pageErrors: PageError[]
  /**
   * Paced gestures that ran more than a fifth past their script (a drag's
   * travel, a path's timing, typing, a key sequence): the page could not
   * keep up with what it was sent. Also on `meta.steps[].overrunMs`.
   */
  overruns: StepOverrun[]
  /** The actions as recorded, `url` resolved: what a take directory writes back. */
  actions: ActionsFile
}

export interface RecordOpts {
  /** Stop the capture at this many seconds (the hosted cap). */
  maxDurationSeconds?: number
  /**
   * Path to a Playwright storage state (cookies + origin storage), so the
   * recorder drives a SIGNED-IN product. A demo of anything behind a login
   * needs it, and a sign-in form cannot always be scripted (an emailed code,
   * an SSO hop). Export one from a real browser, or with
   * `context.storageState({ path })`.
   */
  storageState?: string
  /**
   * REHEARSE the flow: every step runs against the real page, in order,
   * because a later selector usually exists only after an earlier click. But
   * nothing is captured (no screencast, no frames), nothing is written, the
   * pointer lands instead of travelling and every pause is cut to a beat, so
   * a script that misses a selector says so in seconds instead of after a
   * full real-time take and its encode. Selector lookups keep their whole
   * timeout, so a miss here is a miss in the take.
   */
  dryRun?: boolean
  /**
   * Called once the first navigation has settled, BEFORE a frame is captured.
   * The caller judges the wall here and only then prepares the take
   * directory, so a take refused at a sign-in never clears the footage a
   * re-record would have replaced. A throw closes the context and propagates.
   */
  onArrival?: (
    arrival: Arrival,
  ) => Promise<WallVerdict | null | void> | WallVerdict | null | void
  /** Extra request headers on every request (`--header name=value`). */
  headers?: Record<string, string>
  /**
   * A ready-made context to record IN, instead of one made from `browser`:
   * `--session <name>`, a persistent profile the person signed in to. The
   * recorder still sizes the viewport and closes it at the end.
   */
  context?: RecorderContext
  /**
   * The environment a setup's `{ env }` texts resolve from: the shell's
   * for the CLI, the job's own map on the fleet. Absent means no env at
   * all, so a setup that reads one fails in words.
   */
  env?: Record<string, string | undefined>
  /** The platform the take is recorded on, for `meta.platform`. */
  platform?: RecordingMeta['platform']
  /**
   * The ids of the guarded steps this recording may press (`--confirm`).
   * A guarded step not named here refuses the take before anything is
   * captured; a rehearsal hovers every guarded step and presses none.
   */
  confirm?: readonly string[]
  /**
   * Where a `download` step's file goes. A host that hands in none cannot
   * keep a download: such a script is refused before anything is captured.
   * A rehearsal fetches the file and keeps nothing.
   */
  outputs?: OutputSink
  /**
   * Where the sound the page played is kept, fetched with the page's own
   * cookies at the end of the take. A host that hands in none still
   * records `meta.media`, with no file; a rehearsal fetches nothing.
   */
  sounds?: SoundSink
  /**
   * The files the script names beside itself (a drag's path file, a
   * paste's file). A host that hands in none cannot run such a step: the
   * script is refused before anything is captured.
   */
  files?: ScriptFiles
  /** Print every page error whole, each time it comes; by default one cut line per distinct error. */
  verbose?: boolean
  /**
   * Structured progress for a host that reports it (the CLI's `--json`):
   * an `await`'s start, a heartbeat while it waits, and its end.
   */
  onEvent?: (event: Record<string, unknown>) => void
  /**
   * A step the page stopped answering in (it ran into its bound) stops the
   * take there, as an `await` that timed out does (`--strict`). Without
   * it the step is a skip and the take goes on.
   */
  stopOnHang?: boolean
  /** How often a long `await` reports it is still waiting (default 30 s). */
  awaitHeartbeatMs?: number
}

/** The longest any pause lasts in a rehearsal. */
const DRY_PAUSE_MS = 120

/**
 * The expression a scroll tick evaluates: move the first scrollable
 * ancestor of the element under the cursor by `dy`, else the window, the
 * container a wheel at that point would have moved. A string, so no host
 * helper (`__name`) has to exist in the page.
 */
export function scrollByScript(x: number, y: number, dy: number): string {
  return `(() => {
  let el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      el.scrollBy(0, ${dy});
      return 'el';
    }
    el = el.parentElement;
  }
  window.scrollBy(0, ${dy});
  return 'window';
})()`
}

/** Minimal JPEG SOF parse for real encoded dimensions. */
export function jpegDims(buf: Uint8Array): { w: number; h: number } | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) return null
    const marker = buf[i + 1]
    const len = view.getUint16(i + 2)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { h: view.getUint16(i + 5), w: view.getUint16(i + 7) }
    }
    i += 2 + len
  }
  return null
}

/** Base64 to bytes without Node's Buffer, so the fleet's isolate runs it too. */
export function base64Bytes(data: string): Uint8Array {
  const bin = atob(data)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function recordTake(
  browser: RecorderBrowser,
  url: string,
  actions: ActionsFile,
  sink: FrameSink,
  log: (msg: string) => void,
  opts: RecordOpts = {},
): Promise<RecordResult> {
  const dry = opts.dryRun === true
  const sleep = dry
    ? (ms: number) => realSleep(Math.min(ms, DRY_PAUSE_MS))
    : realSleep
  // A rehearsal is not held to the recording cap: its clock is not the take's.
  const maxSeconds = dry ? Infinity : (opts.maxDurationSeconds ?? Infinity)
  // Refused BEFORE a browser context exists: a step that spends something
  // real runs only when the command names it, and a download needs a place
  // to land. A rehearsal presses no guarded step and keeps no file.
  if (!dry) {
    const guard = guardVerdict(actions, opts.confirm ?? [])
    if (!guard.ok) throw new RecordRefusedError(guard.message)
    const download = actions.steps.findIndex((s) => s.do === 'download')
    if (download >= 0 && !opts.outputs)
      throw new RecordRefusedError(
        `steps[${download}] is a download, and this recorder has nowhere to keep a file. Nothing was recorded.`,
      )
  }
  // The files a script names (a path to draw, a file to paste) are read
  // and checked before a browser context exists, in a rehearsal too: a
  // missing or malformed one refuses the take in words.
  const read = await loadScriptFiles(actions, opts.files)
  if ('problem' in read) throw new RecordRefusedError(read.problem)
  const files: LoadedFiles = read
  const vw = actions.viewport?.width ?? 1280
  const vh = actions.viewport?.height ?? 720
  const context =
    opts.context ??
    (await browser.newContext({
      viewport: { width: vw, height: vh },
      deviceScaleFactor: 1,
      ...(opts.storageState ? { storageState: opts.storageState } : {}),
    }))
  if (opts.headers && Object.keys(opts.headers).length)
    await applyHeaders(context, opts.headers, url, log)
  // Masks go in as an init script, so they are in force at document start on
  // every navigation: the real value never reaches a painted frame.
  const masks = actions.mask ?? []
  if (masks.length) await context.addInitScript(maskInitScript(masks))
  // Every media element the page plays is noted from document start, in
  // every frame (pageSound.ts), so the sound it made can be placed later.
  await context.addInitScript(MEDIA_WATCH_SCRIPT)
  const soundLog = new PageSoundLog()
  const exposureLog = new ExposureLog(masks)
  const noticeLog = new NoticeLog()
  const rawPage = await context.newPage()
  // Every call into the page is bounded (stepBound.ts): a page that stops
  // answering ends the step it hung, never the take's clock.
  const pageBound = new StepBound()
  const page = bounded(rawPage, pageBound)
  // What the frame shows, read after each step. A few ms in the page; a scan
  // that fails (mid-navigation) is skipped, never fatal.
  const scanExposures = async (step: number) => {
    const scan = await page.evaluate(EXPOSURE_PROBE).catch(() => null)
    exposureLog.add(step, scan as Parameters<ExposureLog['add']>[1])
    noticeLog.add(step, (scan as { notices?: ScannedNotice[] } | null)?.notices)
  }
  // One line per distinct page error, cut short; repeats are counted and
  // said once at the end (pageErrors.ts). The full text rides the result.
  const pageErrors = new PageErrorLog(opts.verbose === true)
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const line = pageErrors.add(m.text())
    if (line) log(line)
  })

  // When the first page counts as ready: its DOM settled (default), or
  // its network went idle (`ready: "networkidle"`). Polled on the wall's
  // clock in a rehearsal too: how long a page takes is what it is for.
  const readyMode = actions.ready ?? DEFAULT_READY
  const open = (target: string) =>
    untilReady(page, readyMode, (o) => page.goto(target, o), {
      sleep: realSleep,
    })
  log(`goto ${url}`)
  const opened = await open(url)
  let response = opened.response
  const ready: ReadyReport = opened.ready
  log(`   ${readyLine(ready)}`)
  // A warning only when network idle was asked for and never came.
  const navTimeout = ready.mode === 'networkidle' && ready.capped

  // The setup: off camera, before the wall is judged, because a setup that
  // signs in is exactly what makes the wall not there. A selector that never
  // appears fails the take here, in words, before anything is captured.
  const setup = actions.setup ?? []
  if (setup.length) {
    log(`setup: ${setup.length} step(s), off camera`)
    const result = await runSetup(page, setup, {
      sleep: realSleep,
      env: opts.env ?? {},
      goto: (target) => open(target),
    })
    for (const line of result.lines) log(`   ${line}`)
    if (result.failed) {
      await context.close().catch(() => {})
      throw new SetupError(result.failed)
    }
    // Back to the page the take is OF, signed in and past the banners.
    log(`goto ${url} (after setup)`)
    response = (await open(url)).response
  }

  // A wall the caller let through (--allow-wall, or a soft one without
  // --strict) rides the take's meta, so a digest made later still says so.
  let wall: WallVerdict | null = null
  if (opts.onArrival) {
    const seen = (await page.evaluate(WALL_PROBE).catch(() => null)) as Pick<
      Arrival,
      'passwordFields' | 'newPasswordField' | 'oneTimeCodeField'
    > | null
    try {
      wall =
        (await opts.onArrival({
          askedUrl: url,
          landedUrl: page.url(),
          ...(response ? { status: response.status() } : {}),
          passwordFields: seen?.passwordFields ?? 0,
          newPasswordField: seen?.newPasswordField ?? false,
          oneTimeCodeField: seen?.oneTimeCodeField ?? false,
        })) ?? null
    } catch (e) {
      await context.close().catch(() => {})
      throw e
    }
  }

  await scanExposures(-1)
  // What the page played while it was being prepared is not the take's.
  await page.evaluate(MEDIA_DRAIN_PROBE).catch(() => null)
  // A script that settles gets the page's change clock started now, so the
  // first settle knows how long the page has been still.
  if (actions.steps.some((s) => settleOn(s, actions.settle)))
    await page.evaluate(CHANGE_AGE_PROBE).catch(() => undefined)

  const cdp = await context.newCDPSession(rawPage)
  // The surface the screencast reads is the viewport, or the take is short
  // (surfaceFit.ts). Before the camera rolls; a rehearsal captures nothing.
  if (!dry) await fitSurfaceToViewport(cdp, vw, vh)
  const frames: FrameRec[] = []
  let frameIdx = 0
  let t0 = 0
  // The take's clock runs only while the camera does: an `await` stops the
  // capture and polls off camera, and its wall time is taken out of the
  // footage clock, the cursor clock and every frame stamp alike, through
  // ONE mapping (takeClock.ts), which also keeps frame times strictly
  // increasing. Made for real once t0 is stamped below.
  let takeClock = new TakeClock(0)
  // Written from the screencast callback, so the read below does not
  // narrow: a box, not a plain local.
  const first: { dims: { w: number; h: number } | null } = { dims: null }
  // Frames are handed to the sink in order; the chain keeps a slow sink
  // (R2) from reordering them and is awaited before the meta is built.
  let sinkChain: Promise<void> = Promise.resolve()
  if (!dry)
    cdp.on('Page.screencastFrame', (ev) => {
      // Every frame is acked, kept or not, or the screencast stalls.
      cdp
        .send('Page.screencastFrameAck', { sessionId: ev.sessionId })
        .catch(() => {})
      const tsMs = ev.metadata.timestamp
        ? ev.metadata.timestamp * 1000
        : Date.now()
      // Placed by when it was captured; null = not later than the last
      // frame kept, so older pixels than the footage already shows.
      const tMs = takeClock.placeFrame(tsMs)
      if (tMs === null) return
      const file = `frame-${String(frameIdx++).padStart(5, '0')}.jpg`
      const bytes = base64Bytes(ev.data)
      if (!first.dims) first.dims = jpegDims(bytes)
      frames.push({ file, tMs })
      sinkChain = sinkChain.then(() => sink.frame(file, bytes)).catch(() => {})
    })

  const screencast = {
    format: 'jpeg',
    quality: 90,
    maxWidth: vw,
    maxHeight: vh,
    everyNthFrame: 1,
  }
  t0 = Date.now()
  takeClock = new TakeClock(t0)
  if (!dry) await cdp.send('Page.startScreencast', screencast)

  const events: CursorEvent[] = []
  const cur = { x: 48, y: 48 }
  const now = () => takeClock.footageMs(Date.now())

  /**
   * Run `fn` OFF CAMERA: the screencast stops, nothing is emitted, and on
   * the way back the wall time it took is taken out of the take's clock,
   * so the footage runs straight from the moment before to the moment
   * after. Returns the cut's footage time and the wall time spent.
   */
  const offCamera = async <T>(
    fn: () => Promise<T>,
  ): Promise<{ out: T; at: number; ms: number }> => {
    // In a rehearsal the clock pauses too, so `at` and `ms` read the same.
    const at = takeClock.pause(Date.now())
    if (!dry) await cdp.send('Page.stopScreencast').catch(() => {})
    const out = await fn()
    const ms = takeClock.resume(Date.now())
    if (!dry) await cdp.send('Page.startScreencast', screencast).catch(() => {})
    return { out, at, ms }
  }
  const emit = (e: Omit<CursorEvent, 't'>) => events.push({ t: now(), ...e })
  // The page's media notes since the last look, in the recorder's clock.
  const drainSound = async (step?: number) => {
    const drain = (await page
      .evaluate(MEDIA_DRAIN_PROBE)
      .catch(() => null)) as MediaDrain | null
    soundLog.add(drain, Date.now(), step)
  }

  await page.mouse.move(cur.x, cur.y)
  emit({ x: cur.x, y: cur.y, type: 'move' })

  const clock: RecorderClock = { now: () => Date.now(), sleep }
  // The pointer's travel is driven by the CLOCK (pace.ts): its position is
  // a function of the elapsed time and it ends when the travel's duration
  // has elapsed, so a page that answers each mouse.move slowly costs
  // samples, never seconds. Every sample the page took is a cursor event
  // at its real time, which is what the smoothing and the follow read.
  const moveTo = async (tx: number, ty: number) => {
    const dist = Math.hypot(tx - cur.x, ty - cur.y)
    const from = { ...cur }
    await clockMotion(
      dry ? 0 : pointerTravelMs(dist),
      async (u) => {
        cur.x = from.x + (tx - from.x) * u
        cur.y = from.y + (ty - from.y) * u
        await page.mouse.move(cur.x, cur.y)
        emit({ x: Math.round(cur.x), y: Math.round(cur.y), type: 'move' })
      },
      clock,
    )
  }

  /**
   * The words under a selector once a step has settled: trimmed,
   * whitespace collapsed, bounded. Null when nothing matches in time, which
   * the step line says; a missing payload never fails a take.
   */
  const readText = async (
    pg: typeof page,
    selector: string,
  ): Promise<string | null> => {
    try {
      await pg
        .locator(selector)
        .first()
        .waitFor({ state: 'visible', timeout: READ_WAIT_MS })
      // The probe is a string, the one evaluate shape every driver shares.
      // A field's words are its VALUE (what was typed), which textContent
      // never carries; everything else keeps its textContent.
      const raw = await pg.evaluate<string>(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return ''; if ('value' in el && typeof el.value === 'string' && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return el.value; return el.textContent || '' })()`,
      )
      const words = raw.replace(/\s+/g, ' ').trim()
      return words ? words.slice(0, READ_MAX_CHARS) : null
    } catch {
      return null
    }
  }
  const boxOf = async (selector: string): Promise<Rect | null> => {
    const loc = page.locator(selector).first()
    try {
      await loc.waitFor({ state: 'visible', timeout: 8000 })
      const before = await page
        .evaluate(() => [window.scrollX, window.scrollY])
        .catch(() => [0, 0])
      await loc.scrollIntoViewIfNeeded()
      const after = await page
        .evaluate(() => [window.scrollX, window.scrollY])
        .catch(() => before)
      // A lookup that scrolled the page lets the scroll land; one that
      // did not costs nothing.
      if (before[0] !== after[0] || before[1] !== after[1])
        await sleep(SCROLL_SETTLE_MS)
      const bb = await loc.boundingBox()
      if (!bb) return null
      return { x: bb.x, y: bb.y, w: bb.width, h: bb.height }
    } catch {
      log(`   (selector not found, skipping: ${selector})`)
      return null
    }
  }

  /**
   * A media element's source, through the page's locator engine like every
   * other step's selector (`video >> nth=0`, `text=…`, `role=…` all hold):
   * waited for until attached (an `<audio>` is never visible), then read
   * until it has a source. Null when no element matches in time, '' when
   * one does and has no source yet.
   */
  const srcOf = async (selector: string): Promise<string | null> => {
    const deadline = Date.now() + SRC_WAIT_MS
    const loc = page.locator(selector).first()
    try {
      await loc.waitFor({ state: 'attached', timeout: SRC_WAIT_MS })
    } catch {
      return null
    }
    for (;;) {
      const v = await loc.evaluate(readMediaSource).catch(() => '')
      if (v || Date.now() >= deadline) return v
      await realSleep(200)
    }
  }

  /**
   * Fetch a source with the page's own request context (its cookies), or
   * inside the page for what only the page can read (a `blob:`, a
   * `data:`). An address that fails is said without its query.
   */
  const fetchSource = async (
    src: string,
  ): Promise<{
    bytes: Uint8Array
    suggested: string
    contentType?: string
  }> => {
    const abs = new URL(src, page.url()).href
    const suggested = nameFromUrl(abs)
    if (page.request && /^https?:/i.test(abs)) {
      const res = await page.request.get(abs, {
        timeout: DOWNLOAD_TIMEOUT_S * 1000,
      })
      if (!res.ok())
        throw new Error(
          `fetching ${publicUrl(abs) || 'the source'} answered ${res.status()}`,
        )
      const bytes = await res.body()
      if (bytes.length > OUTPUT_MAX_BYTES)
        throw new Error(
          `the file is larger than ${OUTPUT_MAX_BYTES / 1024 / 1024} MB`,
        )
      const type = res.headers()['content-type']?.split(';')[0].trim()
      return { bytes, suggested, ...(type ? { contentType: type } : {}) }
    }
    const r = await page.evaluate<{
      b64?: string
      type?: string
      error?: string
    } | null>(fetchInPageScript(abs))
    if (!r || r.error || r.b64 === undefined)
      throw new Error(
        `fetching the source in the page failed: ${r?.error ?? 'no answer'}`,
      )
    const type = r.type?.split(';')[0].trim()
    return {
      bytes: base64Bytes(r.b64),
      suggested,
      ...(type ? { contentType: type } : {}),
    }
  }

  /**
   * Travel to the rect's centre and press. A double or triple click is that
   * many presses well inside the platform's double-click interval, each
   * carrying its click count, so the page reads one gesture; every press is
   * a down and an up on the cursor track, with its button.
   */
  /**
   * Travel to an element's centre (a rect) or to a viewport point, and
   * press. A double or triple click is that many presses well inside the
   * platform's double-click interval, each carrying its click count, so the
   * page reads one gesture; every press is a down and an up on the cursor
   * track, with its button, and with the element's rect when there is one.
   * `modifiers` go down after the travel and come up after the last
   * release, whatever happens in between.
   */
  const clickAt = async (
    at: Rect | { x: number; y: number },
    how: {
      count?: number
      button?: ClickButton
      modifiers?: readonly DragModifier[]
    } = {},
  ) => {
    const rect = 'w' in at ? at : undefined
    await moveTo(
      rect ? rect.x + rect.w / 2 : at.x,
      rect ? rect.y + rect.h / 2 : at.y,
    )
    const held: string[] = []
    try {
      for (const m of how.modifiers ?? []) {
        const key = resolveModifier(m)
        await page.keyboard.down(key)
        held.push(key)
      }
      await sleep(PRESS_LEAD_MS)
      const count = how.count ?? 1
      const button = buttonNumber(how.button)
      for (let n = 1; n <= count; n++) {
        if (n > 1) await sleep(MULTI_CLICK_GAP_MS)
        const press = {
          ...(how.button && how.button !== 'left'
            ? { button: how.button }
            : {}),
          ...(n > 1 ? { clickCount: n } : {}),
        }
        const hasOpts = Object.keys(press).length > 0
        emit({
          x: Math.round(cur.x),
          y: Math.round(cur.y),
          type: 'down',
          button,
          ...(rect ? { rect } : {}),
        })
        await (hasOpts ? page.mouse.down(press) : page.mouse.down())
        await sleep(n < count ? PRESS_HOLD_MS / 2 : PRESS_HOLD_MS)
        await (hasOpts ? page.mouse.up(press) : page.mouse.up())
        emit({
          x: Math.round(cur.x),
          y: Math.round(cur.y),
          type: 'up',
          button,
          ...(rect ? { rect } : {}),
        })
      }
    } finally {
      for (const key of held.reverse())
        await page.keyboard.up(key).catch(() => undefined)
    }
  }

  /** A key's typing ping: where the key is about, never which key. */
  const keyPing = (rect: Rect | null) =>
    emit({
      x: Math.round(rect ? rect.x + rect.w / 2 : cur.x),
      y: Math.round(rect ? rect.y + rect.h / 2 : cur.y),
      type: 'key',
      ...(rect ? { rect } : {}),
    })

  /**
   * Wait for the page to settle after a press, reading the screencast:
   * returns ms since the last change (null when nothing changed). A dry
   * run has no frames and settles at once.
   */
  const waitSettled = async (): Promise<number | null> => {
    if (dry) return null
    const pressAt = now()
    const before = frames.length
    for (;;) {
      const t = now()
      const last = frames.length > before ? frames[frames.length - 1] : null
      const sinceChange = last ? t - last.tMs : null
      if (settleVerdict({ sincePress: t - pressAt, sinceChange }) === 'settled')
        return sinceChange
      await sleep(40)
    }
  }

  const skipped: SkippedStep[] = []
  // The step timeline: when each step ran, in source seconds — what
  // lets a cut anchored to steps re-time onto a NEW recording of the same
  // script (`vos plan --reuse`). Every step that STARTED is recorded; a
  // skipped selector is marked, never silently absent.
  const stepSpans: StepSpan[] = []
  const paces: StepPace[] = []
  const disabled: DisabledClick[] = []
  const confirmed: string[] = []
  const skips: RecordingSkip[] = []
  const outputs: RecordingOutput[] = []
  const outputNames = new Set<string>()
  const overruns: StepOverrun[] = []
  let stopped: StoppedTake | null = null
  // The last guarded step a rehearsal left unpressed: what follows it and
  // waits for its result (an expect, an await) cannot see that result.
  let unpressedGuard: number | null = null
  let capped = false
  for (const [stepIdx, step] of actions.steps.entries()) {
    // The cap is checked between steps (a step is one gesture and runs
    // whole); only a wait is cut short, since it is the one step that can
    // sit past the cap on its own.
    if (capReached(now(), maxSeconds)) {
      capped = true
      break
    }
    const stepStart = now()
    // The gesture the recorder adds by design around this step's ask: the
    // pointer's travel, the press, the settle. Everything else the step's
    // wall time holds is the page's (a slow round trip, a scroll landing).
    let gestureMs = 0
    const gesture = async <T>(fn: () => Promise<T>): Promise<T> => {
      const t = now()
      const out = await fn()
      gestureMs += now() - t
      return out
    }
    const skippedBefore = skipped.length
    // A paced gesture's plan against its wall time (the overrun report):
    // set by the cases whose tempo the script sets.
    const paced: { v: { plannedMs: number; tookMs: number } | null } = {
      v: null,
    }
    const timed = async <T>(plannedMs: number, fn: () => Promise<T>) => {
      const t = Date.now()
      const out = await fn()
      paced.v = { plannedMs, tookMs: Date.now() - t }
      return out
    }
    // A step's own ask when the script's numbers do not say it (a path
    // read from a file, a key sequence): what the pace report compares.
    let askedOverride: number | null = null
    // A step that changes the page's URL (a click that navigates, the
    // wait that lets the load land) is marked: the planner proposes a
    // transition at the page change.
    const urlBefore = page.url()
    // The selector's box at the gesture: kept on the step so a layer can
    // name what the step touched (`overlays[].pin.step`).
    let stepRect: Rect | null = null
    // What this step adds to its `meta.steps` entry beyond the common fields.
    const extra: Partial<StepSpan> = {}
    const tag = `#${stepIdx}${step.id ? ` ${step.id}` : ''}`
    const skip = (selector: string, reason?: string) => {
      skipped.push({
        step: stepIdx,
        ...(step.id ? { id: step.id } : {}),
        do: step.do,
        selector,
        ...(reason ? { reason } : {}),
      })
      if (reason) extra.reason = reason
    }
    if (step.guard) extra.guard = step.guard
    // What a `js` check last answered, kept on the step: the app's own
    // state at that moment, which the frames cannot say.
    const keepValue = (last: ConditionState) => {
      if (!('value' in last)) return
      const kept = keptValue(last.value)
      if (kept !== undefined) extra.value = kept
    }
    /**
     * A rehearsal never presses a step that spends: the pointer goes to its
     * target, so the selector is proven, and the press is left out. True
     * when the step was rehearsed that way and its case must stop there.
     */
    const rehearseGuard = async (
      sel: string | undefined,
      point?: { x: number; y: number } | null,
    ): Promise<boolean> => {
      if (!step.guard || !dry) return false
      const rect = sel ? await boxOf(sel) : null
      stepRect = rect
      if (sel && !rect) skip(sel)
      else {
        if (rect)
          await gesture(() => moveTo(rect.x + rect.w / 2, rect.y + rect.h / 2))
        else if (point) await gesture(() => moveTo(point.x, point.y))
        log(
          `${tag}: guarded (${step.guard}), ${rect || point ? 'hovered' : 'left alone'}, not pressed`,
        )
      }
      unpressedGuard = stepIdx
      return true
    }
    /**
     * In a rehearsal, an expect or an await after an unpressed guarded step
     * waits for a result that cannot come: it is said and counted as
     * resolved, never waited out. True when the case must stop there.
     */
    const notWaited = (): boolean => {
      if (!dry || unpressedGuard === null) return false
      extra.followsGuard = unpressedGuard
      log(
        `${tag} ${step.do}: not waited: it follows #${unpressedGuard} (guarded, not pressed)`,
      )
      return true
    }
    const boundMs = stepBoundMs(
      step as Parameters<typeof stepBoundMs>[0],
      askedMs(step as Parameters<typeof askedMs>[0]),
      {
        expectS: EXPECT_TIMEOUT_S,
        awaitS: AWAIT_TIMEOUT_S,
        downloadS: DOWNLOAD_TIMEOUT_S,
      },
    )
    opts.onEvent?.({
      event: 'step',
      phase: 'start',
      i: stepIdx,
      ...(step.id ? { id: step.id } : {}),
      do: step.do,
    })
    const stepWall = Date.now()
    pageBound.start(boundMs)
    switch (step.do) {
      case 'wait':
        await sleep(clampWait(step.ms, now(), maxSeconds))
        break
      case 'move':
        // The pointer's travel is the recorder's, a gesture.
        await gesture(() => moveTo(step.x, step.y))
        break
      case 'hover': {
        // An element's centre, or a viewport point (a spot on a canvas).
        if (step.selector === undefined) {
          const px = step.x ?? cur.x
          const py = step.y ?? cur.y
          await gesture(() => moveTo(px, py))
          log(`hover ${Math.round(px)},${Math.round(py)}`)
          await sleep(step.ms ?? 700)
          break
        }
        const rect = await boxOf(step.selector)
        stepRect = rect
        if (rect) {
          await gesture(() => moveTo(rect.x + rect.w / 2, rect.y + rect.h / 2))
          log(`hover ${step.selector}`)
          await sleep(step.ms ?? 700) // parked cursor = dwell signal for the planner
        } else
          skipped.push({ step: stepIdx, do: step.do, selector: step.selector })
        break
      }
      case 'click': {
        const how = {
          count: step.count,
          button: step.button,
          modifiers: step.modifiers,
        }
        const said = `${step.count === 3 ? 'triple-click' : step.count === 2 ? 'double-click' : 'click'}${step.button && step.button !== 'left' ? ` (${step.button})` : ''}${step.modifiers?.length ? ` holding ${step.modifiers.join('+')}` : ''}`
        // A viewport point: a spot on a canvas no selector names.
        if (step.selector === undefined) {
          const point = { x: step.x ?? cur.x, y: step.y ?? cur.y }
          if (await rehearseGuard(undefined, point)) break
          await gesture(() => clickAt(point, how))
          log(`${said} at ${Math.round(point.x)},${Math.round(point.y)}`)
          const sinceChange = await gesture(() => waitSettled())
          await sleep(holdLeftMs(settleMs(step), sinceChange))
          break
        }
        if (await rehearseGuard(step.selector)) break
        const rect = await boxOf(step.selector)
        stepRect = rect
        if (rect) {
          // A press on a disabled control still happens (the flow is the
          // flow), and is reported: it most likely did nothing, and a take
          // built on it shows a button that never answered.
          const enabled = await page
            .locator(step.selector)
            .first()
            .isEnabled({ timeout: 1000 })
            .catch(() => true)
          if (!enabled) {
            disabled.push({
              step: stepIdx,
              ...(step.id ? { id: step.id } : {}),
              selector: step.selector,
            })
            log(
              `   (${tag} click: ${step.selector} is disabled; pressed anyway)`,
            )
          }
          await gesture(() => clickAt(rect, how))
          log(`${said} ${step.selector}`)
          // The settle is the recorder's (watched on the screencast); the
          // hold is the author's, from the page's last change.
          const sinceChange = await gesture(() => waitSettled())
          await sleep(holdLeftMs(settleMs(step), sinceChange))
        } else
          skipped.push({ step: stepIdx, do: step.do, selector: step.selector })
        break
      }
      case 'type': {
        if (await rehearseGuard(step.selector)) break
        const rect = await boxOf(step.selector)
        stepRect = rect
        if (rect) {
          // The click is what opens the typing zoom on the field. A step that
          // only finishes earlier typing (a submitting Enter) passes
          // focus:false: the field is already focused and a second click
          // rings a click effect on empty space beside the text.
          if (step.focus !== false) await gesture(() => clickAt(rect))
          // Where the caret stands before the first character: a click
          // lands it where the pointer hit, and a code editor line is
          // typed at its end. `replace` selects the value so the typing
          // replaces it (a form that opens filled in).
          if (step.at === 'end') await page.keyboard.press('End')
          else if (step.at === 'start') await page.keyboard.press('Home')
          if (step.replace) await page.keyboard.press('ControlOrMeta+a')
          // Typing-activity pings (TZ): one per ~350ms while characters land,
          // plus one at completion so the planner's hold starts at the true
          // typing end. When-and-where only — a ping never carries the text.
          // ~0.6s+ of typing earns the zoom (TYPING_MIN_DUR + ping floor), so
          // pace delayMs like a person for a camera moment, not a paste.
          const delay = step.delayMs ?? 40
          const ping = () =>
            emit({
              x: Math.round(rect.x + rect.w / 2),
              y: Math.round(rect.y + rect.h / 2),
              type: 'key',
              rect,
            })
          let lastPing = -Infinity
          const chars = [...step.text]
          await timed(Math.max(0, chars.length - 1) * delay, () =>
            clockTyping(
              chars,
              delay,
              async (ch) => {
                if (now() - lastPing >= 350) {
                  lastPing = now()
                  ping()
                }
                await page.keyboard.type(ch)
              },
              clock,
            ),
          )
          ping()
          log(`type ${step.text.length} chars into ${step.selector}`)
          await gesture(() => sleep(settleMs(step)))
        } else
          skipped.push({ step: stepIdx, do: step.do, selector: step.selector })
        break
      }
      case 'press': {
        if (await rehearseGuard(step.selector)) break
        // One named key, recorded as a typing ping (when-and-where only,
        // never the key) so the planner's typing session holds through a
        // submitting Enter or an Escape that closes what a click opened.
        // No click: the field is as the flow left it. With a selector the
        // ping (and the step's rect) is that element's; without, the
        // pointer's.
        let rect: Rect | null = null
        if (step.selector) {
          rect = await boxOf(step.selector)
          stepRect = rect
          if (!rect) {
            skipped.push({
              step: stepIdx,
              do: step.do,
              selector: step.selector,
            })
            break
          }
        }
        // A chord, a plain key or a sequence: each key is its own ping, a
        // person's hand apart. The ping is when and where, never which key.
        const seq = pressSequence(step)
        const chords = step.keys !== undefined ? seq.map(resolveChord) : seq
        const plan = keySequencePlanMs(chords.length)
        if (chords.length > 1) askedOverride = plan + settleMs(step)
        await timed(plan, async () => {
          for (const [i, chord] of chords.entries()) {
            if (i > 0) await sleep(KEY_SEQUENCE_GAP_MS)
            keyPing(rect)
            await page.keyboard.press(chord)
          }
        })
        log(`press ${seq.join(', ')}`)
        const sinceChange = await gesture(() => waitSettled())
        await sleep(holdLeftMs(settleMs(step), sinceChange))
        break
      }
      case 'scroll': {
        // The scroll travels by the clock, like the pointer, and each tick
        // moves the scroll container under the cursor INSIDE the page
        // (`Runtime.evaluate` returns at once). Not wheel events: CDP's
        // wheel dispatch waits for the renderer to handle the event, and a
        // tab that paints no frame for a small delta, which a fleet browser's
        // background tab is, never answers, so a clock-driven wheel stalled
        // there for good. And not requestAnimationFrame or an in-page timer,
        // which such a tab never fires or throttles to once a second. The
        // screencast captures whatever the compositor paints between ticks,
        // and a layout moved by scrollTo is never a torn composite.
        const total = Math.abs(step.dy)
        const dir = Math.sign(step.dy)
        const sent = { px: 0 }
        await gesture(() =>
          clockMotion(
            dry ? 0 : scrollTravelMs(total),
            async (u) => {
              const target = Math.round(total * u)
              const delta = target - sent.px
              if (delta <= 0) return
              sent.px = target
              await page
                .evaluate(scrollByScript(cur.x, cur.y, dir * delta))
                .catch(() => undefined)
              emit({
                x: Math.round(cur.x),
                y: Math.round(cur.y),
                type: 'scroll',
              })
            },
            clock,
          ),
        )
        await gesture(() => sleep(settleMs(step)))
        break
      }
      case 'drag': {
        // A drawn path starts at its first point; a straight drag at the
        // selector's centre, else (x, y).
        let path: PathSample[] | null = null
        if (typeof step.path === 'string') {
          const read = files.paths.get(stepIdx)
          if (read) path = schedulePath(read, step.ms)
        } else if (step.path !== undefined) {
          const read = readPath(step.path)
          if (!('problems' in read)) path = schedulePath(read, step.ms)
        }
        let start: { x: number; y: number } | null = null
        let rect: Rect | undefined
        if (path) {
          start = { x: path[0].x, y: path[0].y }
        } else if (step.selector) {
          const box = await boxOf(step.selector)
          stepRect = box
          if (box) {
            rect = box
            start = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
          } else {
            skipped.push({
              step: stepIdx,
              do: step.do,
              selector: step.selector,
            })
            break
          }
        } else if (typeof step.x === 'number' && typeof step.y === 'number') {
          start = { x: step.x, y: step.y }
        }
        if (!start) break
        const from0 = start
        await gesture(() => moveTo(from0.x, from0.y))
        // The modifiers go down after the travel and before the press, and
        // come up after the release, so the page sees them for the whole
        // drag and the pointer's approach is a plain move.
        const mods = step.modifiers ?? []
        const held: string[] = []
        try {
          for (const m of mods) {
            const key = resolveModifier(m)
            await page.keyboard.down(key)
            held.push(key)
          }
          await gesture(() => sleep(PRESS_LEAD_MS))
          // A path that carries pressure is drawn with a PEN through the
          // browser's own input (the mouse has no pressure); a driver that
          // will not take one draws it with the mouse and says so.
          const bits = modifierBits(mods, opts.platform)
          const penAt = (
            type: 'mousePressed' | 'mouseMoved' | 'mouseReleased',
            p: { x: number; y: number; pressure?: number },
          ) =>
            cdp.send('Input.dispatchMouseEvent', {
              type,
              x: p.x,
              y: p.y,
              button: 'left',
              buttons: type === 'mouseReleased' ? 0 : 1,
              ...(type === 'mouseMoved' ? {} : { clickCount: 1 }),
              pointerType: 'pen',
              force: type === 'mouseReleased' ? 0 : (p.pressure ?? 0.5),
              modifiers: bits,
            })
          let pen = path?.some((p) => p.pressure !== undefined) ?? false
          if (pen && path) {
            try {
              await penAt('mousePressed', path[0])
            } catch {
              pen = false
              log(
                `   (${tag} drag: this browser takes no pen input; the path is drawn with the mouse and its pressure dropped)`,
              )
            }
          }
          emit({
            x: Math.round(cur.x),
            y: Math.round(cur.y),
            type: 'down',
            button: 0,
            rect,
          })
          if (!pen) await page.mouse.down()
          await gesture(() => sleep(PRESS_HOLD_MS))
          if (path) {
            // Every point is sent, in order, at its time: a drawing's shape
            // is its points, so a page that answers slowly makes the stroke
            // late (an overrun, reported), never a different stroke.
            const pts = path
            const total = pathDurationMs(pts)
            askedOverride = total
            await timed(total, async () => {
              const from = Date.now()
              for (let i = 1; i < pts.length; i++) {
                const p = pts[i]
                if (!dry) {
                  const wait = from + p.at - Date.now()
                  if (wait > 0) await realSleep(wait)
                }
                if (pen) await penAt('mouseMoved', p)
                else await page.mouse.move(p.x, p.y)
                cur.x = p.x
                cur.y = p.y
                emit({ x: Math.round(p.x), y: Math.round(p.y), type: 'move' })
              }
            })
          } else {
            // The drag is the ask: `ms` of travel by the clock, however
            // slowly the page answers each move (a slider re-rendering per
            // sample).
            const dur = step.ms ?? 700
            const from = { ...cur }
            const tx = step.tx ?? from.x
            const ty = step.ty ?? from.y
            await timed(dur, () =>
              clockMotion(
                dur,
                async (u) => {
                  cur.x = from.x + (tx - from.x) * u
                  cur.y = from.y + (ty - from.y) * u
                  await page.mouse.move(cur.x, cur.y)
                  emit({
                    x: Math.round(cur.x),
                    y: Math.round(cur.y),
                    type: 'move',
                  })
                },
                clock,
              ),
            )
          }
          await gesture(() => sleep(settleMs({ do: 'drag' })))
          if (pen) await penAt('mouseReleased', { x: cur.x, y: cur.y })
          else await page.mouse.up()
          emit({
            x: Math.round(cur.x),
            y: Math.round(cur.y),
            type: 'up',
            button: 0,
            rect,
          })
        } finally {
          for (const key of held.reverse())
            await page.keyboard.up(key).catch(() => undefined)
        }
        const holding = mods.length ? ` holding ${mods.join('+')}` : ''
        log(
          path
            ? `drag a path of ${path.length} points from ${Math.round(start.x)},${Math.round(start.y)}${holding}`
            : `drag ${step.selector ?? `${start.x},${start.y}`} → ${step.tx},${step.ty}${holding}`,
        )
        // The drag's own hold after the release: the recorder's, a gesture.
        await gesture(() => sleep(DRAG_HOLD_MS))
        break
      }
      case 'paste': {
        // Words or a file on the clipboard, pasted as a person's ⌘V does:
        // into the selector (clicked first, as a person puts the caret
        // there) or where the focus already is. The keystroke is a typing
        // ping; what was pasted never reaches the cursor track.
        const item = pasteItemOf(step, stepIdx, files)
        if (!item) {
          skip(step.file ?? '', `"${step.file}" was not read`)
          break
        }
        let rect: Rect | null = null
        if (step.selector) {
          rect = await boxOf(step.selector)
          stepRect = rect
          if (!rect) {
            skip(step.selector)
            break
          }
          const at = rect
          await gesture(() => clickAt(at))
        }
        const ping = { done: false }
        const outcome = await runPaste(page, context, item, async (chord) => {
          keyPing(rect)
          ping.done = true
          await page.keyboard.press(chord)
        })
        if ('failed' in outcome) {
          skip(step.selector ?? step.file ?? 'paste', outcome.failed)
          log(`   (${tag} paste: ${outcome.failed})`)
          break
        }
        if (!ping.done) keyPing(rect)
        const what =
          step.text !== undefined
            ? `${[...step.text].length} chars`
            : `the file ${step.file}`
        const into = step.selector ? ` into ${step.selector}` : ''
        log(
          outcome.via === 'file'
            ? `paste ${what}${into}, dispatched in the page with the file's own bytes (the browser's clipboard re-encodes an image and drops what it carries, its density among it); its events are untrusted`
            : outcome.via === 'page'
              ? `paste ${what}${into}, dispatched in the page (the browser's clipboard refused it: ${outcome.why}); its events are untrusted`
              : `paste ${what}${into}`,
        )
        const sinceChange = await gesture(() => waitSettled())
        await sleep(holdLeftMs(settleMs(step), sinceChange))
        break
      }
      case 'expect': {
        if (notWaited()) break
        // A check, on camera, with no cursor move and no input: the page is
        // read until the condition holds or the step's time runs out.
        const cond: WaitCondition = step
        const timeoutMs = (step.timeout ?? EXPECT_TIMEOUT_S) * 1000
        const res = await pollCondition(page, cond, {
          timeoutMs,
          everyMs: EXPECT_EVERY_MS,
          sleep: realSleep,
        })
        keepValue(res.last)
        if (res.ok) log(`expect ${sayCondition(cond)}: holds`)
        else {
          const reason = conditionMiss(cond, res.last, timeoutMs)
          skip(step.selector ?? step.gone ?? step.text ?? '', reason)
          log(`   (${tag} expect: ${reason})`)
        }
        break
      }
      case 'await': {
        if (notWaited()) break
        // OFF CAMERA: the capture stops, the page is polled, and the take
        // resumes the moment the condition holds, so a 40-second render is
        // a cut in the footage, never 40 seconds of a spinner.
        const cond: WaitCondition = step.until
        const timeoutMs = (step.timeout ?? AWAIT_TIMEOUT_S) * 1000
        const reload = step.reload
          ? () => reloadUntilReady(page, readyMode, timeoutMs)
          : undefined
        log(`await ${sayCondition(cond)} (off camera)…`)
        const awaitEvent = {
          event: 'await',
          step: stepIdx,
          ...(step.id ? { id: step.id } : {}),
        }
        opts.onEvent?.({ ...awaitEvent, phase: 'start' })
        // A long wait says it is still waiting, so a host reading the
        // events is never left with minutes of silence.
        const beatMs = opts.awaitHeartbeatMs ?? AWAIT_HEARTBEAT_MS
        const waitFrom = Date.now()
        const beat = setInterval(() => {
          const elapsedMs = Date.now() - waitFrom
          opts.onEvent?.({ ...awaitEvent, phase: 'wait', elapsedMs })
          log(`   still waiting, ${sayDuration(elapsedMs)} so far`)
        }, beatMs)
        let waited: { out: PollResult; at: number; ms: number }
        try {
          waited = await offCamera(() =>
            pollCondition(page, cond, {
              timeoutMs,
              everyMs: (step.poll ?? AWAIT_POLL_S) * 1000,
              sleep: realSleep,
              between: reload,
              // After a reload the condition must hold on two reads in a
              // row, or a half-built page ends the wait early.
              ...(reload ? { confirm: { reads: 2, gapMs: 500 } } : {}),
            }),
          )
        } finally {
          clearInterval(beat)
        }
        const { out, at, ms } = waited
        keepValue(out.last)
        opts.onEvent?.({ ...awaitEvent, phase: 'end', ms, held: out.ok })
        extra.offCameraMs = ms
        if (!out.ok) extra.timedOut = true
        // A wait that held at once (the page already showed it) cut
        // nothing worth a segment: the step reports it, the footage does
        // not split on it.
        if (!dry && (ms >= MIN_SKIP_MS || !out.ok))
          skips.push({
            step: stepIdx,
            ...(step.id ? { id: step.id } : {}),
            at: +(at / 1000).toFixed(3),
            ms,
            ...(out.ok ? {} : { timedOut: true }),
          })
        if (out.ok) log(`   held after ${sayDuration(ms)} off camera`)
        else if ((step.onTimeout ?? 'fail') === 'continue')
          log(
            `   (${tag} await: ${conditionMiss(cond, out.last, ms)}; going on, as onTimeout says)`,
          )
        else {
          stopped = {
            step: stepIdx,
            ...(step.id ? { id: step.id } : {}),
            reason: `${tag} await: ${conditionMiss(cond, out.last, ms)}, so the take stopped there. Raise its timeout, or set onTimeout: "continue" to go on without it`,
          }
          extra.reason = stopped.reason
          log(`   ${stopped.reason}`)
        }
        break
      }
      case 'download': {
        // A file the page makes, kept in the take's outputs/: by the click
        // that downloads it (the press is on camera, like any click), or by
        // fetching what a media element plays with the page's own cookies.
        let got: {
          bytes: Uint8Array
          suggested: string
          contentType?: string
        } | null = null
        let reason: string | null = null
        const target = step.selector ?? step.src ?? ''
        try {
          if (step.selector !== undefined) {
            const rect = await boxOf(step.selector)
            stepRect = rect
            if (!rect) {
              skip(step.selector)
              break
            }
            if (!page.waitForEvent) {
              reason = 'this browser reports no downloads'
            } else {
              const waitMs = DOWNLOAD_TIMEOUT_S * 1000
              const arriving = page
                .waitForEvent('download', { timeout: waitMs })
                .catch(() => null)
              await gesture(() => clickAt(rect))
              log(`click ${step.selector} (download)`)
              const dl = await arriving
              if (!dl)
                reason = `no download arrived within ${sayDuration(waitMs)} of the click on '${step.selector}'`
              else {
                const stream = await dl.createReadStream()
                if (!stream) reason = 'the download failed in the browser'
                else
                  got = {
                    bytes: await readAllBytes(stream),
                    suggested: dl.suggestedFilename(),
                    // A browser download carries no headers here: the type is
                    // read from the name the page gave it.
                    ...typeOfName(dl.suggestedFilename()),
                  }
              }
            }
          } else if (step.src !== undefined) {
            const src = await srcOf(step.src)
            if (src === null) reason = `no element matches '${step.src}'`
            else if (!src) reason = `'${step.src}' has no source to fetch`
            else got = await fetchSource(src)
          }
        } catch (e) {
          reason = e instanceof Error ? e.message : String(e)
        }
        if (got) {
          const name = outputName(
            step.as,
            got.suggested,
            `download-${stepIdx}${extForType(got.contentType)}`,
            outputNames,
          )
          outputNames.add(name)
          if (!dry) await opts.outputs?.save(name, got.bytes, got.contentType)
          outputs.push({
            step: stepIdx,
            ...(step.id ? { id: step.id } : {}),
            name,
            bytes: got.bytes.length,
            ...(got.contentType ? { contentType: got.contentType } : {}),
          })
          log(
            `download → outputs/${name} (${got.bytes.length} bytes)${dry ? ', not kept in a rehearsal' : ''}`,
          )
        } else {
          const why = reason ?? 'nothing came'
          skip(target, why)
          log(`   (${tag} download: ${why})`)
        }
        break
      }
    }
    // A gesture that waits on the app: no DOM change and no new frame for a
    // beat before the next step, so a canvas that fell behind catches up.
    if (
      settleOn(step, actions.settle) &&
      skipped.length === skippedBefore &&
      !stopped
    ) {
      const res = await gesture(() =>
        appSettled(page, () => frames.length, {
          sleep: realSleep,
          sinceFrame: () =>
            frames.length ? now() - frames[frames.length - 1].tMs : null,
        }),
      )
      extra.settleMs = res.ms
      if (!res.settled)
        log(
          `   (${tag} settle: the page was still changing after ${sayDuration(res.ms)}; going on)`,
        )
    }
    // A paced gesture that ran past its script: the page could not keep up.
    if (paced.v && !dry) {
      const over = overrunOf(paced.v.plannedMs, paced.v.tookMs)
      if (over !== null) {
        overruns.push({
          step: stepIdx,
          ...(step.id ? { id: step.id } : {}),
          do: step.do,
          plannedMs: Math.round(paced.v.plannedMs),
          tookMs: Math.round(paced.v.tookMs),
          overrunMs: over,
        })
        extra.overrunMs = over
      }
    }
    const hang = pageBound.end()
    if (hang.hung) {
      const reason = hangReason(step.do, hang.ms, hang.boundMs)
      // One skip per step: a miss the step said already gives way to why.
      const said = skipped.length > skippedBefore ? skipped.at(-1) : undefined
      if (said) {
        said.reason = reason
        extra.reason = reason
      } else skip((step as { selector?: string }).selector ?? '', reason)
      log(`   (${tag} ${step.do}: ${reason})`)
      // --strict: a page that stopped answering stops the take here.
      if (opts.stopOnHang && !stopped)
        stopped = {
          step: stepIdx,
          ...(step.id ? { id: step.id } : {}),
          reason: `${tag} ${step.do}: ${reason}, so the take stopped there`,
        }
    }
    // The step's own reads after it (its words, the scans) get a beat each.
    pageBound.start(POST_STEP_READ_MS)
    // A guarded step that ran in a recording ran because the command named it.
    if (step.guard && !dry && skipped.length === skippedBefore) {
      confirmed.push(step.id ?? String(stepIdx))
      extra.confirmed = true
    }
    const stepInfo = step as {
      id?: string
      selector?: string
      read?: string
      src?: string
      gone?: string
      until?: { selector?: string; gone?: string }
    }
    // The element the step is about: an await names what it waited on, a
    // download by src the element it fetched.
    const about =
      stepInfo.selector ??
      stepInfo.until?.selector ??
      stepInfo.until?.gone ??
      stepInfo.gone ??
      stepInfo.src
    // The take carries its payload: the page the step left (origin and
    // path, never a query or a hash) and, when the step named a `read`,
    // that element's words once the step has settled, so a layer quotes
    // the take instead of a replay of it.
    const urlAfter = publicUrl(page.url())
    const text = stepInfo.read ? await readText(page, stepInfo.read) : null
    if (stepInfo.read && text === null)
      log(`   (read ${stepInfo.read}: nothing there after the step)`)
    stepSpans.push({
      step: stepIdx,
      ...(stepInfo.id ? { id: stepInfo.id } : {}),
      do: step.do,
      ...(about ? { selector: about } : {}),
      tStart: +(stepStart / 1000).toFixed(3),
      tEnd: +(now() / 1000).toFixed(3),
      ...(skipped.length > skippedBefore ? { skipped: true } : {}),
      ...(page.url() !== urlBefore ? { navigated: true } : {}),
      ...(urlAfter ? { url: urlAfter } : {}),
      ...(text !== null ? { text } : {}),
      ...(stepRect
        ? {
            rect: {
              x: +stepRect.x.toFixed(1),
              y: +stepRect.y.toFixed(1),
              w: +stepRect.w.toFixed(1),
              h: +stepRect.h.toFixed(1),
            },
          }
        : {}),
      ...extra,
    })
    paces.push({
      step: stepIdx,
      do: step.do,
      askedMs: askedOverride ?? askedMs(step as Parameters<typeof askedMs>[0]),
      gestureMs,
      wallMs: now() - stepStart,
    })
    // After the pace is taken: the scan's few ms are not the step's.
    await scanExposures(stepIdx)
    await drainSound(stepIdx)
    pageBound.end()
    const stepSpan = stepSpans[stepSpans.length - 1]
    opts.onEvent?.({
      event: 'step',
      phase: 'end',
      i: stepIdx,
      ...(step.id ? { id: step.id } : {}),
      do: step.do,
      ms: Date.now() - stepWall,
      ...(stepSpan?.skipped ? { skipped: true } : {}),
      ...(hang.hung ? { hung: true } : {}),
    })
    // An await that timed out with onTimeout "fail": the take ends here.
    if (stopped) break
  }
  if (!capped && !stopped) await sleep(TRAILING_HOLD_MS) // trailing hold
  if (capped || capReached(now(), maxSeconds)) {
    capped = true
    log(`   ${cappedLine(maxSeconds)}`)
  }

  // The take's own finish reads the page too, and is bounded like a step.
  pageBound.start(POST_STEP_READ_MS * 2)
  await drainSound()
  const endWall = Date.now()
  const durationMs = capped ? Math.min(now(), maxSeconds * 1000) : now()
  const heard = soundLog.heard(takeClock, endWall, durationMs)
  await cdp.send('Page.stopScreencast').catch(() => {})
  // Off camera now: the fetch takes what it takes.
  const media = await keepPageSound(
    heard,
    dry ? undefined : opts.sounds,
    fetchSource,
    log,
  )
  await sleep(200)
  const pageTitle = (await page.title().catch(() => '')) ?? ''
  for (const line of pageErrors.repeats()) log(line)
  // A context whose page stopped answering may not close either: the take
  // is done whether it does or not.
  pageBound.end()
  pageBound.start(CLOSE_BOUND_MS)
  await pageBound.race(context.close().catch(() => {}))
  pageBound.end()
  // Every frame the screencast delivered has reached the sink.
  await sinkChain

  const meta: RecordingMeta = {
    dpr: 1,
    zoom: 1,
    t0,
    durationMs,
    width: vw,
    height: vh,
    fps: 30,
    hasAudio: false,
    captureWidth: first.dims?.w ?? vw,
    captureHeight: first.dims?.h ?? vh,
    captureSurface: 'tab',
    // The take keeps the address, never its query or hash, which is where
    // a token or a magic link would ride.
    pageUrl: publicUrl(url) || url,
    pageTitle,
    platform: opts.platform ?? 'linux',
    producer: 'cli',
    steps: stepSpans,
    ...(wall
      ? { wall: { kind: wall.kind, asked: wall.asked, landed: wall.landed } }
      : {}),
    ...(exposureLog.exposures().length
      ? { exposures: exposureLog.exposures() }
      : {}),
    ...(noticeLog.notices().length ? { notices: noticeLog.notices() } : {}),
    ...(masks.length ? { masks: exposureLog.masks(masks) } : {}),
    ...(skips.length ? { skips } : {}),
    ...(outputs.length ? { outputs } : {}),
    ...(media.length ? { media } : {}),
  }

  // Smoothness telemetry: screencast emits only on visual change, so frame
  // gaps = frozen pixels. ≥400ms reads as dead time in a product video.
  const freezes: FreezeSpan[] = []
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].tMs - frames[i - 1].tMs
    if (gap >= 400) {
      freezes.push({
        from: +(frames[i - 1].tMs / 1000).toFixed(2),
        to: +(frames[i].tMs / 1000).toFixed(2),
        ms: gap,
      })
    }
  }
  const frozenMs = freezes.reduce((sum, f) => sum + f.ms, 0)
  const freezePct =
    durationMs > 0 ? Math.round((frozenMs / durationMs) * 100) : 0
  // The freeze share is a FACT (a workspace tour is mostly still and fine);
  // the warning is dead time: a hold nobody is reading, named per step.
  const dead = deadTime(stepSpans, frames, events, durationMs)
  // A rehearsal captures no frames: it has no dead time to warn about.
  if (!dry && deadWarns(dead)) log(`   WARNING: ${deadLine(dead)}`)

  const pace = paceReport(paces)
  if (!dry) log(`   ${paceLine(pace)}`)
  const overrun = overrunLine(overruns)
  if (overrun) log(`   WARNING: ${overrun}`)
  return {
    events,
    frames,
    meta,
    pace,
    skipped,
    navTimeout,
    ready,
    wall,
    exposures: exposureLog.exposures(),
    notices: noticeLog.notices(),
    masks: exposureLog.masks(masks),
    freezes,
    freezePct,
    dead,
    capped,
    disabled,
    confirmed,
    skips,
    outputs,
    media,
    stopped,
    pageErrors: pageErrors.entries(),
    overruns,
    // Self-contained: a path a file held is inline, so the take re-records
    // from its own script with the file gone.
    actions: { ...inlineScript(actions, files), url },
  }
}

/**
 * Fetch each sound the page was heard playing, once per address, and keep
 * it through the host's sink: the take-relative key lands on its
 * `meta.media` entry. A source that cannot be fetched (a `blob:` of a page
 * that has gone, an address that answers 403) is said, and the entry keeps
 * the reason instead of a file. Nothing is fetched without a sink.
 */
async function keepPageSound(
  heard: ReturnType<PageSoundLog['heard']>,
  sink: SoundSink | undefined,
  fetchSource: (
    src: string,
  ) => Promise<{ bytes: Uint8Array; suggested: string; contentType?: string }>,
  log: (msg: string) => void,
): Promise<NonNullable<RecordingMeta['media']>> {
  const kept = new Map<string, { file?: string; fetchError?: string }>()
  const used = new Set<string>()
  for (const h of heard) {
    if (!h.meta.intervals.length) continue
    const stretches = h.meta.intervals.length
    log(
      `   page sound: ${h.meta.src || 'a media element'} heard ${stretches === 1 ? 'once' : `${stretches} times`}`,
    )
    if (!sink || kept.has(h.src)) continue
    try {
      const got = await fetchSource(h.src)
      const name = outputName(
        undefined,
        got.suggested,
        `sound-${kept.size + 1}${extForType(got.contentType)}`,
        used,
      )
      used.add(name)
      kept.set(h.src, {
        file: await sink.save(name, got.bytes, got.contentType),
      })
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      kept.set(h.src, { fetchError: why })
      log(`   (page sound not kept: ${why})`)
    }
  }
  return heard.map((h) => ({ ...h.meta, ...(kept.get(h.src) ?? {}) }))
}

/** How long a step's own reads after it (its words, the scans) may take on a page that has stopped answering. */
const POST_STEP_READ_MS = 5000
/** How long the take waits for its browser context to close. */
const CLOSE_BOUND_MS = 10_000

/** Why a step ended at its bound, with the real time it took. */
export function hangReason(verb: string, ms: number, boundMs: number): string {
  return `the page stopped answering: this ${verb} ran ${sayDuration(ms)}, past its bound of ${sayDuration(boundMs)}`
}

/** A download's extension from its type, for a name the page did not give. */
const EXT_FOR_TYPE: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/json': '.json',
  'text/csv': '.csv',
  'application/zip': '.zip',
}

export function extForType(type: string | undefined): string {
  return (type && EXT_FOR_TYPE[type.split(';')[0].trim().toLowerCase()]) ?? ''
}

/** A download's type from its name's extension, as `{ contentType }`, or `{}` when the extension says nothing. */
export function typeOfName(name: string): { contentType?: string } {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (!name.includes('.')) return {}
  for (const [type, e] of Object.entries(EXT_FOR_TYPE))
    if (e === ext) return { contentType: type }
  return ext === '.jpeg' ? { contentType: 'image/jpeg' } : {}
}
