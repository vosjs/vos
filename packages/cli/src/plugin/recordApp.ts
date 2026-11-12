/**
 * `vos record --app <name>`: a take of a desktop app's window, performed by
 * whoever is at the machine. A person, or an agent's computer use, works the
 * app; `@vosjs/driver` records the window with no system pointer in the
 * pixels and the pointer's path beside it, in the window's own points. The
 * take directory is then what a page take's is (`recording.mp4`,
 * `cursor.json`, `meta.json`), planned the same way, so the planner zooms on
 * what was pressed and typed in.
 *
 * The recording runs until Ctrl-C (or a signal), `--seconds`, or the cap.
 * `vos record --windows` lists what can be recorded.
 *
 * macOS only, and it needs Screen Recording granted to the app this was run
 * from (the terminal, the editor, the agent's host): macOS records the grant
 * against that app, not against this CLI. With Accessibility granted too, a
 * press carries the bounds of what was pressed, so its zoom fits the control.
 *
 * This file owns the verb; the helper, its protocol and its permissions are
 * `@vosjs/driver`'s.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { UsageError, hasFlag, numFlag, parseArgs, strFlag } from './args'
import { EXIT_OK, createReporter } from './output'
import { planTake } from './plan'
import { MULTI_FLAGS, maxDuration, takeBackdrop } from './run'
import { prepareReRecord, takePaths } from './take'
import type { CursorEvent } from '@vosjs/studio-core'
import type { DriverWindow, RecordRequest, StoppedEvent } from '@vosjs/driver'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'windows'])

const USAGE =
  'vos record --app <name|bundle id> [--out take] [--seconds <n>] [--max-duration <s>] [--background <slug|url|none>] [--json]\n' +
  '       vos record --window <id> …   one window by its id\n' +
  '       vos record --windows         list the windows that can be recorded'

/** The part of `@vosjs/driver` this verb uses; a test hands in its own. */
export type DesktopDriver = Pick<
  typeof import('@vosjs/driver'),
  'check' | 'windows' | 'record'
>

/** True when the arguments ask for a desktop take and not a page's. */
export function isDesktopRecord(argv: string[]): boolean {
  return argv.some(
    (a) =>
      a === '--app' ||
      a === '--window' ||
      a === '--windows' ||
      a.startsWith('--app=') ||
      a.startsWith('--window='),
  )
}

async function loadDriver(): Promise<DesktopDriver> {
  try {
    return await import('@vosjs/driver')
  } catch {
    throw new Error(
      'Recording a desktop app needs @vosjs/driver, which is not installed here. Install again without --omit=optional.',
    )
  }
}

/** A failure of the driver, in its own words: every one says what to do. */
function driverFailure(error: unknown): Error {
  const e = error as { code?: string; message?: string }
  if (e.code === 'no-window')
    return new Error(
      'No window on screen matches. vos record --windows lists the windows that can be recorded.',
    )
  return new Error(e.message ?? String(error))
}

const SCREEN_RECORDING =
  'Screen Recording is not granted to the app this was run from (the terminal, the editor or the agent host). Switch it on in System Settings, Privacy & Security, Screen & System Audio Recording, then start that app again.'

function windowLine(w: DriverWindow): string {
  const size = `${Math.round(w.frame.w)}×${Math.round(w.frame.h)}`
  return `${String(w.id).padStart(7)}  ${w.app || '(no name)'}  ${size}${w.titled ? '' : '  (untitled: an alert or a panel)'}`
}

export async function cmdRecordApp(
  argv: string[],
  deps: { driver?: DesktopDriver } = {},
): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS, MULTI_FLAGS)
  const r = createReporter(flags.json === true)
  const driver = deps.driver ?? (await loadDriver())

  let granted: Awaited<ReturnType<DesktopDriver['check']>>
  try {
    granted = await driver.check()
  } catch (error) {
    throw driverFailure(error)
  }
  if (!granted.screenRecording) throw new Error(SCREEN_RECORDING)

  if (flags.windows === true) {
    const windows = await driver.windows().catch((error) => {
      throw driverFailure(error)
    })
    r.done(
      { windows },
      windows.length
        ? `${windows.map(windowLine).join('\n')}\n\nRecord one: vos record --app "<name>" --out take`
        : 'No window that can be recorded is on screen.',
    )
    return EXIT_OK
  }

  const app = strFlag(flags, 'app')
  const windowFlag = hasFlag(flags, 'window')
    ? numFlag(flags, 'window', NaN)
    : undefined
  if (windowFlag !== undefined && !Number.isInteger(windowFlag))
    throw new UsageError(
      '--window expects a window id from vos record --windows',
    )
  if (!app && windowFlag === undefined) throw new UsageError(USAGE)
  const seconds = hasFlag(flags, 'seconds')
    ? numFlag(flags, 'seconds', NaN)
    : undefined
  if (seconds !== undefined && !(seconds > 0))
    throw new UsageError('--seconds expects a length above 0')

  const outDir = resolve(strFlag(flags, 'out') ?? 'take')
  const backdrop = await takeBackdrop(flags, r)
  const cap = await maxDuration(flags, r)

  if (existsSync(join(outDir, 'meta.json'))) {
    const { prevDoc, kept } = await prepareReRecord(outDir)
    r.log(
      `note: recording again into ${outDir}; kept ${kept.length ? kept.join(', ') : 'nothing'}` +
        (prevDoc
          ? `; apply the previous cut with: vos plan ${outDir} --reuse`
          : ''),
    )
  }
  // The helper writes the take's three files itself. No screencast frames are
  // kept for a desktop take, so no place is made for them.
  await mkdir(outDir, { recursive: true })
  const paths = takePaths(outDir)

  const notes: string[] = []
  if (!granted.accessibility) {
    notes.push(
      'Accessibility is not granted to the app this was run from, so a press carries no bounds of what was pressed and its zoom cannot fit the control. Switch it on in System Settings, Privacy & Security, Accessibility, for zooms that fit.',
    )
    r.log(`note: ${notes[0]}`)
  }

  const request: RecordRequest = {
    ...(windowFlag !== undefined ? { window: windowFlag } : { app: app! }),
    out: outDir,
    maxSeconds: seconds !== undefined ? Math.min(seconds, cap) : cap,
    pointer: true,
    frames: granted.accessibility,
  }
  r.event({ event: 'phase', phase: 'record' })
  const take = driver.record(request)

  // Ctrl-C ends the take; it does not end this process before the file is whole.
  const end = () => void take.stop().catch(() => {})
  process.on('SIGINT', end)
  process.on('SIGTERM', end)
  let stopped: StoppedEvent
  try {
    const ready = await take.ready
    r.event({
      event: 'recording',
      app: ready.app,
      window: ready.window,
      width: ready.captureWidth,
      height: ready.captureHeight,
    })
    r.log(
      `recording ${ready.app || 'the window'} (${ready.captureWidth}×${ready.captureHeight})${
        seconds !== undefined
          ? ` for ${seconds}s`
          : '. Use the app; Ctrl-C ends the take'
      }…`,
    )
    stopped = await take.done
  } catch (error) {
    throw driverFailure(error)
  } finally {
    process.off('SIGINT', end)
    process.off('SIGTERM', end)
  }

  if (!existsSync(paths.meta))
    throw new Error(`the recording ended without a take in ${outDir}`)
  const events = existsSync(paths.cursor)
    ? (JSON.parse(await readFile(paths.cursor, 'utf8')) as CursorEvent[])
    : []
  const clicks = events.filter((e) => e.type === 'down').length
  const typing = events.filter((e) => e.type === 'key').length

  const plan = await planTake(outDir, { backdrop })

  const said = notes.length
  if (stopped.reason === 'cap' && seconds === undefined)
    notes.push('stopped at --max-duration')
  if (stopped.resized)
    notes.push(
      'the window changed size during the take, so the picture is scaled to fit from there on',
    )
  const held = stopped.heldFrames
  if (held > 0)
    notes.push(
      `another app's window was over this one for a moment: ${held} frame${held === 1 ? ' was' : 's were'} held back so it is not in the take`,
    )
  for (const n of notes.slice(said)) r.log(`note: ${n}`)

  const length = (stopped.durationMs / 1000).toFixed(1)
  const cursorLine = events.length
    ? `${events.length} cursor events (${clicks} click${clicks === 1 ? '' : 's'}, ${typing} typing ping${typing === 1 ? '' : 's'}); ${plan.zoomAuto} zoom${plan.zoomAuto === 1 ? '' : 's'} planned`
    : 'no pointer came over the window, so nothing was planned'
  r.done(
    {
      out: outDir,
      recording: 'recording.mp4',
      durationMs: stopped.durationMs,
      frames: stopped.frames,
      bytes: stopped.bytes,
      reason: stopped.reason,
      cursor: { events: events.length, clicks, typing },
      zooms: plan.zoomAuto,
      backdrop: plan.backdrop ?? null,
      notes,
    },
    `Recorded ${app ?? `window ${windowFlag}`} → ${outDir}/recording.mp4 (${length}s, ${stopped.frames} frames)\n  ${cursorLine}\n  Next: vos digest ${outDir} — look before you cut; edit doc.json; vos open ${outDir} or vos push ${outDir}`,
  )
  return EXIT_OK
}
