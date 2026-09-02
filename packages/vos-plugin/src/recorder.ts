/**
 * The recorder — Playwright drives the action script while:
 *  - CDP Page.startScreencast collects JPEG frames (epoch-timestamped;
 *    hold-last-frame gaps are filled at encode time), and
 *  - every dispatched input is logged as a CursorEvent (the synthesized track:
 *    exact coords, exact times, fresh element rects — no capture needed).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeJson } from './take'
import { capReached, cappedLine, clampWait } from './recordingCap'
import type { Browser } from 'playwright'
import type {
  CursorEvent,
  RecordingMeta,
  Rect,
  StepSpan,
} from '@vosso/studio-core'
import type { ActionsFile } from './actions'
import type { TakePaths } from './take'

export interface FrameRec {
  file: string
  /** ms since t0 */
  tMs: number
}

export interface SkippedStep {
  /** index into actions.steps */
  step: number
  do: string
  selector: string
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
  /** steps whose selector never became visible — the take continued without them. */
  skipped: SkippedStep[]
  /** the initial goto never reached networkidle (recording proceeded anyway). */
  navTimeout: boolean
  /**
   * Smoothness telemetry: stretches ≥400ms with no visual change. Frozen
   * footage is the #1 enemy of a smooth product video — either the flow should
   * keep motion in frame (animate, hover a preview, scroll) or the doc should
   * trim/speed through these. freezePct = share of the take that is frozen.
   */
  freezes: FreezeSpan[]
  freezePct: number
  /** The take reached --max-duration and stopped there; later steps did not run. */
  capped: boolean
}

export interface RecordOpts {
  /** Stop the capture at this many seconds (the hosted cap). */
  maxDurationSeconds?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const easeInOutCubic = (u: number) =>
  u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2

/** Minimal JPEG SOF parse for real encoded dimensions. */
function jpegDims(buf: Buffer): { w: number; h: number } | null {
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) return null
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return null
}

export async function recordTake(
  browser: Browser,
  url: string,
  actions: ActionsFile,
  paths: TakePaths,
  log: (msg: string) => void,
  opts: RecordOpts = {},
): Promise<RecordResult> {
  const maxSeconds = opts.maxDurationSeconds ?? Infinity
  const vw = actions.viewport?.width ?? 1280
  const vh = actions.viewport?.height ?? 720
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') log(`   [page error] ${m.text()}`)
  })

  log(`goto ${url}`)
  let navTimeout = false
  await page
    .goto(url, { waitUntil: 'networkidle', timeout: 45000 })
    .catch(() => {
      navTimeout = true
      log('   (networkidle timeout — continuing)')
    })
  await sleep(800) // hydration settle

  const cdp = await context.newCDPSession(page)
  const frames: FrameRec[] = []
  let frameIdx = 0
  let t0 = 0
  cdp.on('Page.screencastFrame', (ev) => {
    const tsMs = ev.metadata.timestamp
      ? ev.metadata.timestamp * 1000
      : Date.now()
    const file = `frame-${String(frameIdx++).padStart(5, '0')}.jpg`
    writeFileSync(join(paths.framesDir, file), Buffer.from(ev.data, 'base64'))
    frames.push({ file, tMs: Math.max(0, Math.round(tsMs - t0)) })
    cdp
      .send('Page.screencastFrameAck', { sessionId: ev.sessionId })
      .catch(() => {})
  })

  t0 = Date.now()
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    maxWidth: vw,
    maxHeight: vh,
    everyNthFrame: 1,
  })

  const events: CursorEvent[] = []
  const cur = { x: 48, y: 48 }
  const now = () => Date.now() - t0
  const emit = (e: Omit<CursorEvent, 't'>) => events.push({ t: now(), ...e })

  await page.mouse.move(cur.x, cur.y)
  emit({ x: cur.x, y: cur.y, type: 'move' })

  const moveTo = async (tx: number, ty: number) => {
    const dist = Math.hypot(tx - cur.x, ty - cur.y)
    const dur = Math.min(1200, Math.max(350, dist * 1.4))
    const steps = Math.max(6, Math.round(dur / 16))
    const from = { ...cur }
    for (let i = 1; i <= steps; i++) {
      const u = easeInOutCubic(i / steps)
      cur.x = from.x + (tx - from.x) * u
      cur.y = from.y + (ty - from.y) * u
      await page.mouse.move(cur.x, cur.y)
      emit({ x: Math.round(cur.x), y: Math.round(cur.y), type: 'move' })
      await sleep(14)
    }
  }

  const boxOf = async (selector: string): Promise<Rect | null> => {
    const loc = page.locator(selector).first()
    try {
      await loc.waitFor({ state: 'visible', timeout: 8000 })
      await loc.scrollIntoViewIfNeeded()
      await sleep(250)
      const bb = await loc.boundingBox()
      if (!bb) return null
      return { x: bb.x, y: bb.y, w: bb.width, h: bb.height }
    } catch {
      log(`   (selector not found, skipping: ${selector})`)
      return null
    }
  }

  const clickAt = async (rect: Rect) => {
    await moveTo(rect.x + rect.w / 2, rect.y + rect.h / 2)
    await sleep(120)
    emit({
      x: Math.round(cur.x),
      y: Math.round(cur.y),
      type: 'down',
      button: 0,
      rect,
    })
    await page.mouse.down()
    await sleep(90)
    await page.mouse.up()
    emit({
      x: Math.round(cur.x),
      y: Math.round(cur.y),
      type: 'up',
      button: 0,
      rect,
    })
  }

  const skipped: SkippedStep[] = []
  // The step timeline: when each step ran, in source seconds — what
  // lets a cut anchored to steps re-time onto a NEW recording of the same
  // script (`vos plan --reuse`). Every step that STARTED is recorded; a
  // skipped selector is marked, never silently absent.
  const stepSpans: StepSpan[] = []
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
    const skippedBefore = skipped.length
    switch (step.do) {
      case 'wait':
        await sleep(clampWait(step.ms, now(), maxSeconds))
        break
      case 'move':
        await moveTo(step.x, step.y)
        break
      case 'hover': {
        const rect = await boxOf(step.selector)
        if (rect) {
          await moveTo(rect.x + rect.w / 2, rect.y + rect.h / 2)
          log(`hover ${step.selector}`)
          await sleep(step.ms ?? 700) // parked cursor = dwell signal for the planner
        } else
          skipped.push({ step: stepIdx, do: step.do, selector: step.selector })
        break
      }
      case 'click': {
        const rect = await boxOf(step.selector)
        if (rect) {
          await clickAt(rect)
          log(`click ${step.selector}`)
          await sleep(500)
        } else
          skipped.push({ step: stepIdx, do: step.do, selector: step.selector })
        break
      }
      case 'type': {
        const rect = await boxOf(step.selector)
        if (rect) {
          await clickAt(rect)
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
          for (const ch of step.text) {
            if (now() - lastPing >= 350) {
              lastPing = now()
              ping()
            }
            await page.keyboard.type(ch)
            await sleep(delay)
          }
          ping()
          log(`type "${step.text}" into ${step.selector}`)
          await sleep(300)
        } else
          skipped.push({ step: stepIdx, do: step.do, selector: step.selector })
        break
      }
      case 'scroll': {
        const total = Math.abs(step.dy)
        const dir = Math.sign(step.dy)
        for (let done = 0; done < total; done += 120) {
          await page.mouse.wheel(0, dir * Math.min(120, total - done))
          emit({ x: Math.round(cur.x), y: Math.round(cur.y), type: 'scroll' })
          await sleep(40)
        }
        await sleep(400)
        break
      }
      case 'drag': {
        // Start point: selector center when given, else explicit coords.
        let start: { x: number; y: number } | null = null
        let rect: Rect | undefined
        if (step.selector) {
          const box = await boxOf(step.selector)
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
        await moveTo(start.x, start.y)
        await sleep(140)
        emit({
          x: Math.round(cur.x),
          y: Math.round(cur.y),
          type: 'down',
          button: 0,
          rect,
        })
        await page.mouse.down()
        await sleep(90)
        const dur = step.ms ?? 700
        const steps = Math.max(8, Math.round(dur / 16))
        const from = { ...cur }
        for (let i = 1; i <= steps; i++) {
          const u = easeInOutCubic(i / steps)
          cur.x = from.x + (step.tx - from.x) * u
          cur.y = from.y + (step.ty - from.y) * u
          await page.mouse.move(cur.x, cur.y)
          emit({ x: Math.round(cur.x), y: Math.round(cur.y), type: 'move' })
          await sleep(14)
        }
        await sleep(100)
        await page.mouse.up()
        emit({
          x: Math.round(cur.x),
          y: Math.round(cur.y),
          type: 'up',
          button: 0,
          rect,
        })
        log(
          `drag ${step.selector ?? `${start.x},${start.y}`} → ${step.tx},${step.ty}`,
        )
        await sleep(400)
        break
      }
    }
    const stepInfo = step as { id?: string; selector?: string }
    stepSpans.push({
      step: stepIdx,
      ...(stepInfo.id ? { id: stepInfo.id } : {}),
      do: step.do,
      ...(stepInfo.selector ? { selector: stepInfo.selector } : {}),
      tStart: +(stepStart / 1000).toFixed(3),
      tEnd: +(now() / 1000).toFixed(3),
      ...(skipped.length > skippedBefore ? { skipped: true } : {}),
    })
  }
  if (!capped) await sleep(600) // trailing hold
  if (capped || capReached(now(), maxSeconds)) {
    capped = true
    log(`   ${cappedLine(maxSeconds)}`)
  }

  const durationMs = capped ? Math.min(now(), maxSeconds * 1000) : now()
  await cdp.send('Page.stopScreencast').catch(() => {})
  await sleep(200)
  const pageTitle = await page.title().catch(() => '')
  await context.close()

  const firstFrame = frames[0]
    ? jpegDims(readFileSync(join(paths.framesDir, frames[0].file)))
    : null
  const meta: RecordingMeta = {
    dpr: 1,
    zoom: 1,
    t0,
    durationMs,
    width: vw,
    height: vh,
    fps: 30,
    hasAudio: false,
    captureWidth: firstFrame?.w ?? vw,
    captureHeight: firstFrame?.h ?? vh,
    captureSurface: 'tab',
    pageUrl: url,
    pageTitle,
    platform:
      process.platform === 'darwin'
        ? 'mac'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux',
    producer: 'cli',
    steps: stepSpans,
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
  if (freezePct >= 25) {
    log(
      `   WARNING: ${freezePct}% of the take is visually frozen (${freezes.length} freezes, longest ${Math.max(...freezes.map((f) => f.ms))}ms) — keep motion in frame or trim these spans in doc.json`,
    )
  }

  await writeJson(paths.cursor, events)
  await writeJson(paths.meta, meta, true)
  await writeJson(paths.framesIndex, frames)
  await writeJson(paths.actions, { ...actions, url }, true)
  return {
    events,
    frames,
    meta,
    skipped,
    navTimeout,
    freezes,
    freezePct,
    capped,
  }
}
