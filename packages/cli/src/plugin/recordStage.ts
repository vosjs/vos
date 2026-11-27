/**
 * `vos record --app <name> --app <name> …`: a take of a STAGE.
 *
 * A stage is one display with only what the take names in its pixels: every
 * window of the named apps, where it is and in its real order. No other app,
 * no wallpaper, no Dock and no menu bar is encoded, and a named window that
 * something else covers on screen is recorded whole. `--desk` keeps a part
 * of the desk (`menubar`, `dock`, `wallpaper`) when the desk is the subject.
 * `--stage` with one `--app` (or a `--pid`) is that one app's every window.
 *
 * There is no flag that records the screen as it is.
 *
 * The take is PERFORMED: a person, or an agent's computer use, works the
 * apps. It is planned like any take, with one thing more: it says where its
 * windows were (`meta.windows`), so the planner knows that a press belongs
 * to a window, plans each visit to a window as a take of that window would
 * be planned, and rests the camera on the window being worked in.
 *
 * The capture and its rules are `@vosjs/driver`'s (0.5.0 and later).
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { UsageError, hasFlag, numFlag, strFlag } from './args'
import { EXIT_OK } from './output'
import { planTake } from './plan'
import { maxDuration, takeBackdrop } from './run'
import { prepareReRecord, readJson, takePaths } from './take'
import type { createReporter } from './output'
import type { DesktopDriver } from './recordApp'
import type { CursorEvent, RecordingMeta } from '@vosjs/studio-core'
import type { ReadyEvent, RecordRequest, StoppedEvent } from '@vosjs/driver'

/** The parts of the desk a stage can keep. */
export const DESK_PARTS = ['menubar', 'dock', 'wallpaper'] as const
export type DeskPart = (typeof DESK_PARTS)[number]

/** What a stage asks the driver for, beside what every take does. */
export interface StageRequest {
  apps?: string[]
  pids?: number[]
  desk?: DeskPart[]
}

const STAGE_NEEDS_DRIVER =
  'recording a stage needs @vosjs/driver 0.5.0 or later; the one installed records one window at a time. Update @vosjs/cli (npm i -D @vosjs/cli@latest).'

/** True when the flags ask for a stage and not a take of one window. */
export function isStage(
  flags: Record<string, string | true>,
  multi: Record<string, string[]>,
): boolean {
  return (
    (multi.app?.length ?? 0) > 1 ||
    flags.stage === true ||
    (multi.desk?.length ?? 0) > 0
  )
}

/** `--desk menubar --desk dock`, or `--desk menubar,dock`: the parts, checked. */
export function deskParts(given: readonly string[]): DeskPart[] {
  const parts = given.flatMap((v) => v.split(',')).map((v) => v.trim())
  for (const p of parts) {
    if (!(DESK_PARTS as readonly string[]).includes(p))
      throw new UsageError(
        `--desk expects ${DESK_PARTS.join(', ')}; got "${p}". There is no part that is everything: a stage holds what it names`,
      )
  }
  return DESK_PARTS.filter((p) => parts.includes(p))
}

const listed = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? 'the stage')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

export async function recordStage(a: {
  flags: Record<string, string | true>
  multi: Record<string, string[]>
  driver: DesktopDriver
  accessibility: boolean
  r: ReturnType<typeof createReporter>
  /** The driver's failure, in the verb's words. */
  failure: (error: unknown) => Error
}): Promise<number> {
  const { flags, multi, driver, r } = a
  const apps = multi.app ?? []
  if (hasFlag(flags, 'window'))
    throw new UsageError(
      '--window names one window, and a stage is every window of the apps it names. Leave --window out, or record the one window without --stage',
    )
  let pid: number | undefined
  if (hasFlag(flags, 'pid')) {
    pid = numFlag(flags, 'pid', NaN)
    if (!Number.isInteger(pid) || pid <= 0)
      throw new UsageError(
        '--pid expects a process id (vos record --windows lists each window’s)',
      )
  }
  if (!apps.length && pid === undefined)
    throw new UsageError(
      'a stage names its apps: --app "<name>" once for each (vos record --windows lists what is on screen). Nothing that is not named is recorded',
    )
  const desk = deskParts(multi.desk ?? [])
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
  await mkdir(outDir, { recursive: true })
  const paths = takePaths(outDir)

  const notes: string[] = []
  if (!a.accessibility) {
    notes.push(
      'Accessibility is not granted to the app this was run from, so a press carries no bounds of what was pressed and its zoom cannot fit the control. Switch it on in System Settings, Privacy & Security, Accessibility, for zooms that fit.',
    )
    r.log(`note: ${notes[0]}`)
  }
  if (desk.includes('menubar')) {
    notes.push(
      'the menu bar is in the picture, and with it whatever else it shows: other apps’ items, the clock, and the mark the system adds while a screen is recorded',
    )
    r.log(`note: ${notes.at(-1)}`)
  }

  const stage: StageRequest = {
    ...(apps.length ? { apps } : {}),
    ...(pid !== undefined ? { pids: [pid] } : {}),
    ...(desk.length ? { desk } : {}),
  }
  const request = {
    ...stage,
    out: outDir,
    maxSeconds: seconds !== undefined ? Math.min(seconds, cap) : cap,
    pointer: true,
    frames: a.accessibility,
  } as RecordRequest
  r.event({ event: 'phase', phase: 'record' })
  const take = driver.record(request)

  let stopped: StoppedEvent
  let names: string[] = apps
  const end = () => void take.stop().catch(() => {})
  process.on('SIGINT', end)
  process.on('SIGTERM', end)
  try {
    // Read as a helper of any version says it: one from before stages has no
    // `stage` among its filters and no `apps`.
    const ready = (await take.ready) as Omit<ReadyEvent, 'filter'> & {
      filter: string
      apps?: { name: string }[]
    }
    // A helper that does not know a stage would record one window, or the wrong thing.
    if (ready.filter !== 'stage') {
      await take.stop().catch(() => {})
      await rm(outDir, { recursive: true, force: true })
      throw new Error(STAGE_NEEDS_DRIVER)
    }
    if (ready.apps?.length) names = ready.apps.map((x) => x.name)
    r.event({
      event: 'recording',
      apps: names,
      width: ready.captureWidth,
      height: ready.captureHeight,
    })
    r.log(
      `recording a stage of ${listed(names)} (${ready.captureWidth}×${ready.captureHeight}): only their windows are in the picture${
        seconds !== undefined
          ? ` for ${seconds}s`
          : '. Use the apps; Ctrl-C ends the take'
      }…`,
    )
    stopped = await take.done
  } catch (error) {
    const e = error as { code?: string; message?: string }
    if (e.message === STAGE_NEEDS_DRIVER) throw error
    // A helper from before stages reads a request with no window, pid or app as naming nothing.
    if (e.code === 'bad-request' && /names no target/.test(e.message ?? ''))
      throw new Error(STAGE_NEEDS_DRIVER)
    throw a.failure(error)
  } finally {
    process.off('SIGINT', end)
    process.off('SIGTERM', end)
  }

  if (!existsSync(paths.meta))
    throw new Error(`the recording ended without a take in ${outDir}`)
  const meta = await readJson<RecordingMeta>(paths.meta)
  const events = existsSync(paths.cursor)
    ? (JSON.parse(await readFile(paths.cursor, 'utf8')) as CursorEvent[])
    : []
  const clicks = events.filter((e) => e.type === 'down').length
  const typing = events.filter((e) => e.type === 'key').length
  // Windows proper: an alert or a tip is its window's, not one more.
  const windows = new Set(
    (meta.windows ?? []).flatMap((s) =>
      s.windows.filter((w) => !w.panel).map((w) => w.id),
    ),
  ).size

  const plan = await planTake(outDir, { backdrop })
  const said = notes.length
  if (stopped.reason === 'cap' && seconds === undefined)
    notes.push('stopped at --max-duration')
  const held = stopped.heldFrames
  if (held > 0)
    notes.push(
      `a window that was not named was over the stage for a moment: ${held} frame${held === 1 ? ' was' : 's were'} held back so it is not in the take`,
    )
  for (const n of notes.slice(said)) r.log(`note: ${n}`)

  const length = (stopped.durationMs / 1000).toFixed(1)
  const cursorLine = events.length
    ? `${events.length} cursor events (${clicks} click${clicks === 1 ? '' : 's'}, ${typing} typing ping${typing === 1 ? '' : 's'}); ${plan.zoomAuto} zoom${plan.zoomAuto === 1 ? '' : 's'} planned`
    : 'no pointer came over the stage, so nothing was planned'
  r.done(
    {
      out: outDir,
      recording: 'recording.mp4',
      durationMs: stopped.durationMs,
      frames: stopped.frames,
      bytes: stopped.bytes,
      reason: stopped.reason,
      stage: { apps: names, desk, windows },
      cursor: { events: events.length, clicks, typing },
      zooms: plan.zoomAuto,
      backdrop: plan.backdrop ?? null,
      notes,
    },
    `Recorded a stage of ${listed(names)} → ${outDir}/recording.mp4 (${length}s, ${stopped.frames} frames, ${windows} window${windows === 1 ? '' : 's'})\n  ${cursorLine}\n  Next: vos digest ${outDir} — look before you cut; edit doc.json; vos open ${outDir} or vos push ${outDir}`,
  )
  return EXIT_OK
}
