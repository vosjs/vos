/**
 * `vos record --app <name> --app <name> …`: a take of a STAGE.
 *
 * A stage is one display with only what the take names in its pixels: every
 * window of the named apps, where it is and in its real order. No other app,
 * no wallpaper, no Dock and no menu bar is encoded, and a named window that
 * something else covers on screen is recorded whole. `--desk` keeps a part
 * of the desk (`menubar`, `dock`, `wallpaper`) when the desk is the subject.
 * `--stage` with one `--app` (or a `--pid`) is that one app's every window.
 * A script is a stage's when it names `apps`.
 *
 * There is no flag that records the screen as it is.
 *
 * A stage is a desktop take in every other way, so `recordApp.ts` records
 * it: performed, or scripted by an `actions.json` whose steps say which app
 * they act on. This file holds what is the stage's own: what makes a request
 * one, what it asks the driver for, and what it refuses.
 *
 * The take says where its windows were (`meta.windows`), so the planner
 * knows that a press belongs to a window, plans each visit to a window as a
 * take of that window would be planned, and rests the camera on the window
 * being worked in.
 *
 * The capture and its rules are `@vosjs/driver`'s (0.5.0 and later; a
 * scripted stage, 0.6.0).
 */
import { UsageError, hasFlag, numFlag } from './args'
import type { ActionsFile } from '@vosjs/render-core/record'

/** The parts of the desk a stage can keep. */
export const DESK_PARTS = ['menubar', 'dock', 'wallpaper'] as const
export type DeskPart = (typeof DESK_PARTS)[number]

/** What a stage asks the driver for, where a take of one window names it. */
export interface StageTarget {
  apps?: string[]
  pids?: number[]
  desk?: DeskPart[]
  /** Nothing behind the windows: the take carries their shape, and they stand on the backdrop. */
  float?: true
}

export const STAGE_NEEDS_DRIVER =
  'recording a stage needs @vosjs/driver 0.5.0 or later; the one installed records one window at a time. Update @vosjs/cli (npm i -D @vosjs/cli@latest).'

export const SCRIPTED_STAGE_NEEDS_DRIVER =
  'a scripted stage needs @vosjs/driver 0.6.0 or later; the one installed records a stage as it is performed. Update @vosjs/cli (npm i -D @vosjs/cli@latest).'

export const FLOAT_NEEDS_DRIVER =
  "a floating stage needs @vosjs/driver 0.6.0 or later; the one installed paints a ground behind a stage's windows. Update @vosjs/cli (npm i -D @vosjs/cli@latest)."

/** True when the flags, or the script, ask for a stage and not a take of one window. */
export function isStage(
  flags: Record<string, string | true>,
  multi: Record<string, string[]>,
  actions?: Pick<ActionsFile, 'apps'>,
): boolean {
  return (
    (multi.app?.length ?? 0) > 1 ||
    flags.stage === true ||
    flags.float === true ||
    (multi.desk?.length ?? 0) > 0 ||
    (actions?.apps?.length ?? 0) > 0
  )
}

export function isStageTarget(t: object): t is StageTarget {
  return 'apps' in t || 'pids' in t
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

/**
 * The stage a `vos record` names: its `--app`s (which win over a script's
 * `apps`, as `--app` wins over a script's `app`), a `--pid`, and the parts
 * of the desk it keeps.
 */
export function stageTarget(
  flags: Record<string, string | true>,
  multi: Record<string, string[]>,
  actions?: Pick<ActionsFile, 'apps'>,
): StageTarget {
  if (hasFlag(flags, 'window'))
    throw new UsageError(
      '--window names one window, and a stage is every window of the apps it names. Leave --window out, or record the one window without --stage',
    )
  const given = multi.app ?? []
  const apps = given.length ? given : (actions?.apps ?? [])
  if (given.length && actions?.apps) {
    const off = given.filter((a) => !actions.apps!.includes(a))
    const missing = actions.apps.filter((a) => !given.includes(a))
    if (off.length || missing.length)
      throw new UsageError(
        `the script's stage is ${actions.apps.join(', ')}, and its steps name those apps; --app named ${given.join(', ')}. Leave --app out, or name the same apps`,
      )
  }
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
  const float = flags.float === true
  if (float && desk.length)
    throw new UsageError(
      '--float is the windows with nothing behind them, and --desk keeps a part of what is behind them. Use one',
    )
  return {
    ...(apps.length ? { apps } : {}),
    ...(pid !== undefined ? { pids: [pid] } : {}),
    ...(desk.length ? { desk } : {}),
    ...(float ? { float: true as const } : {}),
  }
}

/** Apps in words: "A", "A and B", "A, B and C". */
export const listed = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? 'the stage')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * What a helper that does not know a stage says when asked for one, as what
 * to install. Null for any other failure.
 */
export function stageRefusal(error: unknown): Error | null {
  const e = error as { code?: string; message?: string }
  // A helper from before stages reads a request with no window, pid or app as naming nothing.
  if (e.code === 'bad-request' && /names no target/.test(e.message ?? ''))
    return new Error(STAGE_NEEDS_DRIVER)
  // One from before scripted stages refuses the script in its own words.
  if (
    e.code === 'bad-request' &&
    /takes no script yet|takes no mask yet/.test(e.message ?? '')
  )
    return new Error(SCRIPTED_STAGE_NEEDS_DRIVER)
  return null
}
