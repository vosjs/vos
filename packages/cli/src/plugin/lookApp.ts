/**
 * `vos look --app <name>`: what a script can name in a desktop app's window,
 * before the script is written. One picture of the window as a take would
 * show it (`look.png`), and each control with ONE selector proposed for it,
 * marked UNIQUE or AMBIGUOUS, as a page's look does.
 *
 * It reads what the interface calls its elements (titles, labels, a field's
 * placeholder) and where they are. What a person typed into a field is never
 * read. Nothing is pressed.
 *
 * macOS only. It needs Screen Recording (the picture) and Accessibility (the
 * outline) granted to the app this was run from.
 */
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { UsageError, hasFlag, numFlag, parseArgs, strFlag } from './args'
import { EXIT_OK, createReporter } from './output'
import {
  ACCESSIBILITY_FOR_SCRIPT,
  SCREEN_RECORDING,
  driverFailure,
  loadDriver,
} from './recordApp'
import type { DesktopDriver } from './recordApp'
import type { TreeElement } from '@vosjs/driver'

const USAGE =
  'vos look --app <name|bundle id> [--out <dir>] [--json]\n       vos look --window <id> …   one window by its id (vos record --windows lists them)'

/** The most controls one look lists, as a page's look. */
export const APP_CONTROL_LIMIT = 150

/** True when the arguments ask to look at a desktop app and not a page. */
export function isDesktopLook(argv: string[]): boolean {
  return argv.some(
    (a) =>
      a === '--app' ||
      a === '--window' ||
      a.startsWith('--app=') ||
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

export async function cmdLookApp(
  argv: string[],
  deps: { driver?: DesktopDriver } = {},
): Promise<number> {
  const { flags } = parseArgs(argv, new Set(['json', 'help']), new Set())
  const r = createReporter(flags.json === true)
  const app = strFlag(flags, 'app')
  const windowFlag = hasFlag(flags, 'window')
    ? numFlag(flags, 'window', NaN)
    : undefined
  if (windowFlag !== undefined && !Number.isInteger(windowFlag))
    throw new UsageError(
      '--window expects a window id from vos record --windows',
    )
  if (!app && windowFlag === undefined) throw new UsageError(USAGE)
  const driver = deps.driver ?? (await loadDriver())

  const granted = await driver.check().catch((error) => {
    throw driverFailure(error)
  })
  if (!granted.screenRecording) throw new Error(SCREEN_RECORDING)
  if (!granted.accessibility) throw new Error(ACCESSIBILITY_FOR_SCRIPT)

  const outDir = resolve(strFlag(flags, 'out') ?? 'look')
  await mkdir(outDir, { recursive: true })
  const target =
    windowFlag !== undefined ? { window: windowFlag } : { app: app! }
  const screenshot = join(outDir, 'look.png')
  let outline: Awaited<ReturnType<DesktopDriver['tree']>>
  let shot: Awaited<ReturnType<DesktopDriver['still']>>
  try {
    shot = await driver.still({ ...target, out: screenshot })
    // The picture names the window, so the outline is of that same one.
    outline = await driver.tree({ window: shot.window })
  } catch (error) {
    throw driverFailure(error)
  }

  const all = outline.elements.map(appControl)
  const controls = all.slice(0, APP_CONTROL_LIMIT)
  const more = all.length - controls.length
  const size = `${Math.round(outline.window.w)}×${Math.round(outline.window.h)}`
  const named = outline.app || app || `window ${windowFlag}`
  r.done(
    {
      ok: true,
      app: outline.app,
      window: outline.window,
      screenshot,
      controls,
      more,
    },
    [
      `Looked at ${named} (${size} points): ${screenshot}`,
      controls.length
        ? `${controls.length} control${controls.length === 1 ? '' : 's'}${more > 0 ? `, ${more} past the listing's limit` : ''}:`
        : 'The window offers nothing a script can name. Its app may not describe itself to accessibility; a step can still act on a point (x and y in the window’s points).',
      ...controls.map(appControlLine),
      '',
      `Take a UNIQUE selector into actions.json as it is; an AMBIGUOUS one names by position, and moves when the interface does. Then record: vos record --app "${outline.app || app || '<name>'}" --actions actions.json`,
    ].join('\n'),
  )
  return EXIT_OK
}
