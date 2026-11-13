/**
 * `vos look --app <name>`: what a script can name in a desktop app's window,
 * before the script is written. One picture of the window as a take would
 * show it (`look.png`), and each control with ONE selector proposed for it,
 * marked UNIQUE or AMBIGUOUS, as a page's look does.
 *
 * It reads what the interface calls its elements (titles, labels, a field's
 * placeholder) and where they are. What a person typed into a field is never
 * read. A plain look presses nothing.
 *
 * `--actions actions.json --until <step id>` looks at the state a script
 * REACHES: it runs the script's steps up to and including that one, for
 * real (there is no rehearsal of a desktop app), and then looks. It is how
 * the second screen's selectors are learned without recording a take.
 *
 * macOS only. It needs Screen Recording (the picture) and Accessibility (the
 * outline) granted to the app this was run from.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { desktopProblems, runDesktopSteps } from '@vosjs/render-core/record'
import { UsageError, parseArgs, strFlag } from './args'
import {
  desktopSetup,
  desktopStageProblem,
  desktopTeardown,
  driverSelectorProblem,
} from './desktopStage'
import { EXIT_OK, EXIT_USAGE, createReporter } from './output'
import {
  ACCESSIBILITY_FOR_SCRIPT,
  SCREEN_RECORDING,
  desktopTarget,
  driverFailure,
  loadDriver,
  targetWords,
} from './recordApp'
import { loadActions, takeConfirm } from './run'
import { teardownLine } from './setup'
import type { DesktopDriver } from './recordApp'
import type {
  ActionsFile,
  DesktopRunResult,
  TeardownReport,
} from '@vosjs/render-core/record'
import type { TreeElement } from '@vosjs/driver'

const USAGE =
  'vos look --app <name|bundle id> [--out <dir>] [--json]\n' +
  '       vos look --window <id> …   one window by its id (vos record --windows lists them)\n' +
  '       vos look --pid <n> …       a process’s window: two instances of one app share a name\n' +
  '       vos look --app <name> --actions actions.json --until <step id> [--confirm <id>]...   the state a script reaches'

/** The most controls one look lists, as a page's look. */
export const APP_CONTROL_LIMIT = 150

/** True when the arguments ask to look at a desktop app and not a page. */
export function isDesktopLook(argv: string[]): boolean {
  return argv.some(
    (a) =>
      a === '--app' ||
      a === '--window' ||
      a === '--pid' ||
      a.startsWith('--app=') ||
      a.startsWith('--pid=') ||
      a.startsWith('--window='),
  )
}

/** One control of the listing: what it is, where, and the selector proposed for it. */
export interface AppLookControl {
  role: string
  name: string
  /** The accessibility identifier, or empty. */
  id: string
  /** In the window's own points. */
  rect: { x: number; y: number; w: number; h: number }
  disabled: boolean
  selector: string
  /** `ambiguous`: the selector names it by position among several. */
  match: 'unique' | 'ambiguous'
}

export function appControl(e: TreeElement): AppLookControl {
  return {
    role: e.role,
    name: (e.name ?? '').slice(0, 60),
    id: e.id ?? '',
    rect: e.rect,
    disabled: !e.enabled,
    selector: e.selector,
    match: e.unique ? 'unique' : 'ambiguous',
  }
}

/** A control in two lines: what it is, then how a script names it. */
export function appControlLine(c: AppLookControl): string {
  const r = c.rect
  const where = `@ ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}`
  const what = `  ${c.role}${c.name ? ` "${c.name}"` : ''}${c.disabled ? '  [disabled]' : ''}`
  const nameless = !c.name && !c.id
  return `${what}\n      ${c.selector}  ${
    c.match === 'unique'
      ? 'UNIQUE'
      : nameless
        ? 'AMBIGUOUS (no name: by position alone)'
        : 'AMBIGUOUS (by position among its namesakes)'
  }  ${where}`
}

/**
 * How many of an outline's names carry a file path: a home directory, a
 * project's folder. The tree says more than the picture shows (a file row
 * is named by its full path), and a look prints it.
 */
export function pathNames(elements: readonly TreeElement[]): number {
  const PATH = /(^|[\s"'(])(~\/|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/
  return elements.filter((e) => PATH.test(e.name ?? '')).length
}

/** What to do about a Chromium app whose tree is not there, in words. */
export function unbuiltLine(kind: string, app: string): string {
  const made = kind === 'electron' ? 'an Electron app' : 'a Chromium app'
  return `${app || 'This'} is ${made}, and it has not built its accessibility tree: such an app builds it only when asked, and a running one can take a while. What is listed is its window frame, not its interface. Run this again in a moment; or quit it and start it with --force-renderer-accessibility, which builds the tree from the first frame.`
}

export async function cmdLookApp(
  argv: string[],
  deps: { driver?: DesktopDriver } = {},
): Promise<number> {
  const { flags, multi } = parseArgs(
    argv,
    new Set(['json', 'help']),
    new Set(['confirm']),
  )
  const r = createReporter(flags.json === true)

  // The script to walk, read and refused before anything is touched.
  const actionsArg = strFlag(flags, 'actions')
  const untilId = strFlag(flags, 'until')
  let actions: ActionsFile | undefined
  let confirm: string[] = []
  if (actionsArg || untilId) {
    if (!actionsArg || !untilId)
      throw new UsageError(
        '--actions and --until go together: the script, and the id of the step to stop after',
      )
    actions = await loadActions(resolve(actionsArg), { desktop: true })
    const selectorProblem = await driverSelectorProblem(deps.driver)
    const problems = desktopProblems(actions, { selectorProblem })
    if (problems.length)
      throw new UsageError(
        `not a script a desktop take can run:\n  ${problems.join('\n  ')}`,
      )
    // A look records nothing, so a mask is not needed to walk the script.
    const stage = desktopStageProblem(actions, true)
    if (stage) throw new UsageError(stage)
    if (!actions.steps.some((s) => s.id === untilId))
      throw new UsageError(
        `--until ${untilId}: no step of the script has that id (a step is named by its "id")`,
      )
    confirm = takeConfirm(multi, actions, { dryRun: false, r })
  }

  const target = desktopTarget(flags, actions?.app)
  if (!target) throw new UsageError(USAGE)
  const driver = deps.driver ?? (await loadDriver())

  const granted = await driver.check().catch((error) => {
    throw driverFailure(error)
  })
  if (!granted.screenRecording) throw new Error(SCREEN_RECORDING)
  if (!granted.accessibility) throw new Error(ACCESSIBILITY_FOR_SCRIPT)

  const outDir = resolve(strFlag(flags, 'out') ?? 'look')
  await mkdir(outDir, { recursive: true })
  const screenshot = join(outDir, 'look.png')

  // Walk the script to the step asked for. The steps are real: the app is
  // brought forward and pressed, and the take that carries them is thrown
  // away. The look is taken once that take has ended, because two captures
  // of one screen at the same moment fail each other.
  let walked: DesktopRunResult | undefined
  let window: number | undefined
  let teardown: TeardownReport | undefined
  if (actions && untilId) {
    try {
      await desktopSetup(driver, target, actions, r.log)
    } catch (error) {
      throw error instanceof UsageError ? error : driverFailure(error)
    }
    const scratch = await mkdtemp(join(tmpdir(), 'vos-look-app-'))
    try {
      const take = driver.record({
        ...target,
        out: scratch,
        drive: true,
        pointer: false,
        maxSeconds: 300,
        ...(actions.viewport
          ? {
              size: {
                w: actions.viewport.width,
                h: actions.viewport.height,
              },
            }
          : {}),
      })
      try {
        window = (await take.ready).window
        r.log(
          `walking the script to step "${untilId}": its steps are real. Leave the machine alone until it ends…`,
        )
        walked = await runDesktopSteps(take, actions, r.log, {
          until: untilId,
          confirm,
        })
      } finally {
        await take.stop().catch(() => {})
      }
    } catch (error) {
      throw driverFailure(error)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  let outline: Awaited<ReturnType<DesktopDriver['tree']>>
  let shot: Awaited<ReturnType<DesktopDriver['still']>>
  try {
    shot = await driver.still({
      ...(window !== undefined ? { window } : target),
      out: screenshot,
    })
    // The picture names the window, so the outline is of that same one.
    outline = await driver.tree({ window: shot.window })
  } catch (error) {
    throw driverFailure(error)
  } finally {
    // The walk pressed the real app: what it left is undone once the look
    // is taken, and after a walk that stopped early too.
    if (actions && untilId)
      teardown = await desktopTeardown(driver, target, actions, r.log)
  }

  const all = outline.elements.map(appControl)
  const controls = all.slice(0, APP_CONTROL_LIMIT)
  const more = all.length - controls.length
  const paths = pathNames(outline.elements)
  const size = `${Math.round(outline.window.w)}×${Math.round(outline.window.h)}`
  const named = outline.app || targetWords(target)
  const missed =
    walked && (walked.stopped || walked.reached === false)
      ? (walked.stopped?.reason ??
        `the script ended before step "${untilId}" ran`)
      : null
  r.done(
    {
      ok: !missed,
      app: outline.app,
      kind: outline.kind,
      built: outline.built,
      window: outline.window,
      screenshot,
      controls,
      more,
      paths,
      ...(walked
        ? {
            until: untilId,
            reached: walked.reached === true && !walked.stopped,
            steps: walked.steps.length,
            ...(walked.stopped ? { stopped: walked.stopped } : {}),
            ...(teardown ? { teardown } : {}),
          }
        : {}),
    },
    [
      `Looked at ${named} (${size} points)${walked && !missed ? `, after step "${untilId}"` : ''}: ${screenshot}`,
      ...(missed
        ? [`NOT REACHED: ${missed}. This is the window as the walk left it.`]
        : []),
      ...(!outline.built ? [unbuiltLine(outline.kind, outline.app)] : []),
      ...(teardown ? [teardownLine(teardown)] : []),
      controls.length
        ? `${controls.length} control${controls.length === 1 ? '' : 's'}${more > 0 ? `, ${more} past the listing's limit` : ''}:`
        : 'The window offers nothing a script can name. Its app may not describe itself to accessibility; a step can still act on a point (x and y in the window’s points).',
      ...controls.map(appControlLine),
      '',
      ...(paths > 0
        ? [
            `note: ${paths} name${paths === 1 ? '' : 's'} above carr${paths === 1 ? 'ies' : 'y'} a file path the picture does not show (a home directory, a project’s folder). The outline says more than the pixels do.`,
          ]
        : []),
      `Take a UNIQUE selector into actions.json as it is; an AMBIGUOUS one names by position, and moves when the interface does. Then record: vos record --app "${outline.app || '<name>'}" --actions actions.json`,
    ].join('\n'),
  )
  return missed ? EXIT_USAGE : EXIT_OK
}
