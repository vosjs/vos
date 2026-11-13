/**
 * `vos record --app <name>`: a take of a desktop app's window.
 *
 * PERFORMED (no script): a person, or an agent's computer use, works the
 * app; `@vosjs/driver` records the window with no system pointer in the
 * pixels and the pointer's path beside it, in the window's own points. The
 * recording runs until Ctrl-C (or a signal), `--seconds`, or the cap.
 *
 * SCRIPTED (`--actions actions.json`, or a script that names an `app`): the
 * same script a page's take runs, in the desktop selector dialect. The
 * driver brings the app forward and presses, types and scrolls through
 * accessibility while it records; the step loop is render-core's
 * (`runDesktopSteps`), and its step spans go into `meta.steps` as a page
 * take's do. The take ends with its last step.
 *
 * Either way the take directory is what a page take's is (`recording.mp4`,
 * `cursor.json`, `meta.json`), planned the same way, so the planner zooms on
 * what was pressed and typed in. `vos record --windows` lists what can be
 * recorded; `vos look --app` lists what a script can name.
 *
 * macOS only, and it needs Screen Recording granted to the app this was run
 * from (the terminal, the editor, the agent's host): macOS records the grant
 * against that app, not against this CLI. With Accessibility granted too, a
 * press carries the bounds of what was pressed, so its zoom fits the control;
 * a scripted take needs it.
 *
 * This file owns the verb; the helper, its protocol and its permissions are
 * `@vosjs/driver`'s.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { desktopProblems, runDesktopSteps } from '@vosjs/render-core/record'
import { UsageError, hasFlag, numFlag, parseArgs, strFlag } from './args'
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, createReporter } from './output'
import { planTake } from './plan'
import {
  MULTI_FLAGS,
  loadActions,
  maxDuration,
  takeBackdrop,
  takeConfirm,
} from './run'
import { prepareReRecord, readJson, takePaths, writeJson } from './take'
import type {
  ActionsFile,
  DesktopRunResult,
  SkippedStep,
} from '@vosjs/render-core/record'
import type { CursorEvent, RecordingMeta } from '@vosjs/studio-core'
import type { DriverWindow, RecordRequest, StoppedEvent } from '@vosjs/driver'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'windows', 'strict', 'dry-run'])

const USAGE =
  'vos record --app <name|bundle id> [--out take] [--seconds <n>] [--max-duration <s>] [--background <slug|url|none>] [--json]\n' +
  '       vos record --app <name|bundle id> --actions actions.json [--out take] [--strict] [--confirm <id>]... …   scripted\n' +
  '       vos record --window <id> …   one window by its id\n' +
  '       vos record --pid <n> …       a process’s window: two instances of one app share a name\n' +
  '       vos record --windows         list the windows that can be recorded'

/** The part of `@vosjs/driver` the desktop verbs use; a test hands in its own. */
export type DesktopDriver = Pick<
  typeof import('@vosjs/driver'),
  'check' | 'windows' | 'record' | 'tree' | 'still'
>

/** True when the arguments ask for a desktop take and not a page's. */
export function isDesktopRecord(argv: string[]): boolean {
  return argv.some(
    (a) =>
      a === '--app' ||
      a === '--window' ||
      a === '--windows' ||
      a === '--pid' ||
      a.startsWith('--app=') ||
      a.startsWith('--pid=') ||
      a.startsWith('--window='),
  )
}

/**
 * Which window a desktop verb is about: `--window <id>`, `--pid <n>` (a
 * process's window, the one way to tell two instances of an app apart) or
 * `--app <name>`, in that order. Null when none is given.
 */
export function desktopTarget(
  flags: Record<string, string | true>,
  fallbackApp?: string,
): { window: number } | { pid: number } | { app: string } | null {
  for (const key of ['window', 'pid'] as const) {
    if (!hasFlag(flags, key)) continue
    const n = numFlag(flags, key, NaN)
    if (!Number.isInteger(n) || n <= 0)
      throw new UsageError(
        key === 'window'
          ? '--window expects a window id from vos record --windows'
          : '--pid expects a process id (vos record --windows lists each window’s)',
      )
    return key === 'window' ? { window: n } : { pid: n }
  }
  const app = strFlag(flags, 'app') ?? fallbackApp
  return app ? { app } : null
}

/** A target in words, for a line a person reads. */
export function targetWords(
  t: { window: number } | { pid: number } | { app: string },
): string {
  return 'app' in t
    ? t.app
    : 'pid' in t
      ? `process ${t.pid}`
      : `window ${t.window}`
}

/**
 * True when the script a `vos record` names is a desktop one: it has an
 * `app`. A file that cannot be read says no; the page path reports it.
 */
export async function scriptNamesApp(
  file: string | undefined,
): Promise<boolean> {
  if (!file) return false
  try {
    const raw = await readJson<{ app?: unknown }>(resolve(file))
    return typeof raw?.app === 'string' && raw.app.trim().length > 0
  } catch {
    return false
  }
}

export async function loadDriver(): Promise<DesktopDriver> {
  try {
    return await import('@vosjs/driver')
  } catch {
    throw new Error(
      'Recording a desktop app needs @vosjs/driver, which is not installed here. Install again without --omit=optional.',
    )
  }
}

/** A failure of the driver, in its own words: every one says what to do. */
export function driverFailure(error: unknown): Error {
  const e = error as { code?: string; message?: string }
  if (e.code === 'no-window')
    return new Error(
      'No window on screen matches. vos record --windows lists the windows that can be recorded.',
    )
  return new Error(e.message ?? String(error))
}

export const ACCESSIBILITY_FOR_SCRIPT =
  'Accessibility is not granted to the app this was run from (the terminal, the editor or the agent host). A script finds and presses the app’s controls through it. Switch it on in System Settings, Privacy & Security, Accessibility, then start that app again.'

/** A skipped step in words: its reason, else the selector that named nothing. */
function skippedLine(s: SkippedStep): string {
  return `#${s.step}${s.id ? ` ${s.id}` : ''} ${s.do}${s.reason ? `: ${s.reason}` : ` ${s.selector}`}`
}

/** What `--strict` fails a scripted desktop take on, in words, or null. */
function strictReason(run: DesktopRunResult): string | null {
  const parts: string[] = []
  if (run.skipped.length) parts.push(`${run.skipped.length} skipped step(s)`)
  if (run.disabled.length)
    parts.push(`${run.disabled.length} click(s) on a disabled control`)
  if (run.capped) parts.push('stopped at --max-duration')
  return parts.length ? parts.join(' + ') : null
}

export const SCREEN_RECORDING =
  'Screen Recording is not granted to the app this was run from (the terminal, the editor or the agent host). Switch it on in System Settings, Privacy & Security, Screen & System Audio Recording, then start that app again.'

function windowLine(w: DriverWindow): string {
  const size = `${Math.round(w.frame.w)}×${Math.round(w.frame.h)}`
  return `${String(w.id).padStart(7)}  ${w.app || '(no name)'}  ${size}  pid ${w.pid}${w.titled ? '' : '  (untitled: an alert or a panel)'}`
}

export async function cmdRecordApp(
  argv: string[],
  deps: { driver?: DesktopDriver } = {},
): Promise<number> {
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    MULTI_FLAGS,
  )
  const r = createReporter(flags.json === true)

  // The script, read and refused before anything on the machine is touched.
  const actionsPath = strFlag(flags, 'actions') ?? positionals[0]
  let actions: ActionsFile | undefined
  let confirm: string[] = []
  if (actionsPath && flags.windows !== true) {
    actions = await loadActions(resolve(actionsPath), { desktop: true })
    const problems = desktopProblems(actions)
    if (problems.length)
      throw new UsageError(
        `not a script a desktop take can run:\n  ${problems.join('\n  ')}`,
      )
    if (flags['dry-run'] === true)
      throw new UsageError(
        'a desktop script has no rehearsal: a dry run would press the app’s real controls. vos look --app lists what the script can name',
      )
    if (hasFlag(flags, 'seconds'))
      throw new UsageError(
        '--seconds is a performed take’s length; a scripted take ends with its last step (--max-duration caps it)',
      )
    confirm = takeConfirm(multi, actions, { dryRun: false, r })
  }
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
        ? `${windows.map(windowLine).join('\n')}\n\nRecord one: vos record --app "<name>" --out take. Two windows of one app? --pid <n> names the process, --window <id> the window`
        : 'No window that can be recorded is on screen.',
    )
    return EXIT_OK
  }

  const app = strFlag(flags, 'app') ?? actions?.app
  if (actions && !granted.accessibility)
    throw new Error(ACCESSIBILITY_FOR_SCRIPT)
  const target = desktopTarget(flags, actions?.app)
  if (!target) throw new UsageError(USAGE)
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
    ...target,
    out: outDir,
    maxSeconds: seconds !== undefined ? Math.min(seconds, cap) : cap,
    pointer: true,
    frames: granted.accessibility,
    ...(actions
      ? {
          drive: true,
          ...(actions.viewport
            ? {
                size: {
                  w: actions.viewport.width,
                  h: actions.viewport.height,
                },
              }
            : {}),
        }
      : {}),
  }
  r.event({ event: 'phase', phase: 'record' })
  const take = driver.record(request)

  // Ctrl-C ends the take; it does not end this process before the file is whole.
  let interrupted = false
  const end = () => {
    interrupted = true
    void take.stop().catch(() => {})
  }
  process.on('SIGINT', end)
  process.on('SIGTERM', end)
  let stopped: StoppedEvent
  let run: DesktopRunResult | undefined
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
        actions
          ? `, ${actions.steps.length} step${actions.steps.length === 1 ? '' : 's'}. Leave the machine alone until it ends`
          : seconds !== undefined
            ? ` for ${seconds}s`
            : '. Use the app; Ctrl-C ends the take'
      }…`,
    )
    if (actions) {
      try {
        run = await runDesktopSteps(take, actions, r.log, {
          maxDurationSeconds: cap,
          confirm,
          onEvent: r.event,
        })
      } catch (error) {
        // Interrupted: the take is ending and takes no more commands.
        if (!interrupted) throw error
      }
      stopped = await take.stop()
    } else {
      stopped = await take.done
    }
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

  // A scripted take keeps its script and its step spans, as a page's does:
  // the planner groups presses by step, a pin finds its step, and recording
  // again matches the new steps to the old.
  if (actions) {
    if (run) {
      const meta = await readJson<RecordingMeta>(paths.meta)
      await writeJson(paths.meta, { ...meta, steps: run.steps }, true)
    }
    await writeJson(
      paths.actions,
      { ...actions, ...(app ? { app } : {}) },
      true,
    )
  }

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
  if (actions && !run)
    notes.push('the take was interrupted before the script finished')
  for (const n of notes.slice(said)) r.log(`note: ${n}`)

  const strict = flags.strict === true && run ? strictReason(run) : null
  const scriptFields = run
    ? {
        steps: run.steps.length,
        skipped: run.skipped,
        disabled: run.disabled,
        confirmed: run.confirmed,
        pace: run.pace,
        capped: run.capped,
        ...(run.stopped ? { ok: false, stopped: run.stopped } : {}),
        ...(strict ? { strictFailed: true } : {}),
      }
    : {}
  const scriptLines = run
    ? [
        ...(run.skipped.length
          ? [`SKIPPED: ${run.skipped.map(skippedLine).join('; ')}`]
          : []),
        ...(run.disabled.length
          ? [
              `DISABLED when clicked: ${run.disabled.map((d) => `#${d.step}${d.id ? ` ${d.id}` : ''} ${d.selector}`).join(', ')} (it was reached and not pressed; an expect with enabled: true before it waits for the control)`,
            ]
          : []),
        ...(run.confirmed.length
          ? [`pressed, as --confirm said: ${run.confirmed.join(', ')}`]
          : []),
        ...(run.stopped ? [`STOPPED: ${run.stopped.reason}`] : []),
      ]
        .map((l) => `\n  ${l}`)
        .join('')
    : ''

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
      ...scriptFields,
    },
    run?.stopped
      ? `FAILED: the take stopped at step #${run.stopped.step}: ${run.stopped.reason}${scriptLines}`
      : strict
        ? `STRICT: take recorded but incomplete: ${strict}; fix the script and record again.${scriptLines}`
        : `Recorded ${targetWords(target)} → ${outDir}/recording.mp4 (${length}s, ${stopped.frames} frames${run ? `, ${run.steps.length} steps` : ''})\n  ${cursorLine}${scriptLines}\n  Next: vos digest ${outDir} — look before you cut; edit doc.json; vos open ${outDir} or vos push ${outDir}`,
  )
  return run?.stopped ? EXIT_ERROR : strict ? EXIT_USAGE : EXIT_OK
}
