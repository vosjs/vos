/**
 * WHAT A SCRIPT MAY REACH ON THIS MACHINE IS SAID ON THE COMMAND LINE.
 *
 * An `actions.json` is a file, and files travel: a take is fetched, a
 * script is shared, an agent is handed one. `vos record` runs it with the
 * person's own hands (their desktop, their shell, their signed-in
 * browser), so a script that could choose those for itself is a program a
 * stranger wrote and the person ran by naming a file.
 *
 * So a script describes a walk, and nothing in it widens its own reach.
 * Four things it may ask for, each granted by the person, by name, where
 * they can see it:
 *
 *   the desktop        `--app <name>`       a script never picks the app it drives
 *   a shell variable   `--env <NAME>`       only the names passed are readable
 *   code in the page   `--allow-js`         a `js` check runs as the person's session
 *   a saved sign-in    `--allow-state <f>`  outside the script's own directory
 *
 * Each refusal says the exact flag that grants it, with the script's own
 * names, so a person who trusts the script adds one word and one who does
 * not has just read what it wanted.
 *
 * Pure but for `scriptEnv`, which reads the shell through the grant.
 */
import { isAbsolute, relative, resolve } from 'node:path'
import { scriptEnvNames } from '@vosjs/render-core/record'
import { UsageError } from './args'

const quoted = (names: readonly string[]) =>
  names.map((n) => `--app ${JSON.stringify(n)}`).join(' ')

/**
 * A desktop script against what the command line named. A script that
 * names an app (or a stage's `apps`) runs only when the PERSON named what
 * to drive: `--app`, or `--window` / `--pid`, which point at one window by
 * hand. Which app, and whether it is the script's, is then theirs: a
 * person who names another app gets that one, and a stage that does not
 * match its script is refused by the stage's own check. Null when it may
 * run.
 */
export function scriptedDesktopProblem(
  script: { app?: string; apps?: readonly string[] },
  said: { apps: readonly string[]; byWindow: boolean },
  file: string,
): string | null {
  const names = script.apps?.length
    ? [...script.apps]
    : script.app?.trim()
      ? [script.app]
      : []
  if (names.length === 0) return null
  if (said.byWindow || said.apps.length > 0) return null
  const what =
    names.length === 1
      ? `drives ${names[0]} on your desktop`
      : `drives ${names.length} apps on your desktop (${names.join(', ')})`
  return (
    `${file} ${what}: it presses and types with your own pointer and keyboard. ` +
    `A script never chooses the app it drives. Name ${names.length === 1 ? 'it' : 'them'} yourself: ` +
    `vos record ${quoted(names)} --actions ${file}`
  )
}

/** A shell variable's name, as `--env` takes it: never `NAME=value`. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** `--env` values that are not names, in words; null when all are. */
export function envFlagProblem(given: readonly string[]): string | null {
  const bad = given.filter((n) => !ENV_NAME.test(n))
  return bad.length
    ? `--env takes a variable's NAME, never its value: ${bad.map((b) => JSON.stringify(b.split('=')[0])).join(', ')}. Export the value in this shell and pass the name`
    : null
}

/** The names a script reads that the command line did not grant; null when none. */
export function ungrantedEnvProblem(
  scriptNames: readonly string[],
  granted: readonly string[],
  file: string,
): string | null {
  const missing = scriptNames.filter((n) => !granted.includes(n))
  if (missing.length === 0) return null
  return (
    `${file} reads ${missing.length === 1 ? 'this variable' : 'these variables'} from your shell and types ${missing.length === 1 ? 'it' : 'them'} into the page: ${missing.join(', ')}. ` +
    `A script reads only the names you pass. If that is what you mean: ` +
    missing.map((n) => `--env ${n}`).join(' ')
  )
}

let granted: readonly string[] = []

/** Say which shell variables this run's script may read (`--env`). */
export function grantScriptEnv(names: readonly string[]): void {
  granted = [...names]
}

/**
 * The shell as a script sees it: the granted names and nothing else. The
 * recorders read this in place of `process.env`, so a run that granted
 * nothing hands a script nothing, whatever it asks for.
 */
export function scriptEnv(
  shell: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return Object.fromEntries(granted.map((name) => [name, shell[name]]))
}

let grantedStates: readonly string[] = []

/** Say which saved sign-ins outside the script's directory it may open (`--allow-state`). */
export function grantStatePaths(paths: readonly string[]): void {
  grantedStates = [...paths]
}

/** The saved sign-ins this run granted. */
export function grantedStatePaths(): readonly string[] {
  return grantedStates
}

type JsSteps = {
  steps: readonly {
    do: string
    js?: unknown
    until?: { js?: unknown }
  }[]
}

/** The steps that run a `js` expression in the page, by index. */
export function jsSteps(actions: JsSteps): number[] {
  return actions.steps.flatMap((s, i) =>
    (s.do === 'expect' && s.js !== undefined) ||
    (s.do === 'await' && s.until?.js !== undefined)
      ? [i]
      : [],
  )
}

/** A script's `js` checks against `--allow-js`; null when it may run. */
export function jsStepsProblem(
  actions: JsSteps,
  allowed: boolean,
  file: string,
): string | null {
  if (allowed) return null
  const steps = jsSteps(actions)
  if (steps.length === 0) return null
  return (
    `${file} runs code in the page at ${steps.length === 1 ? 'step' : 'steps'} ${steps.join(', ')} (a js check). ` +
    `It runs as whoever the browser is signed in as, and can read the page and its storage. ` +
    `Read the expression${steps.length === 1 ? '' : 's'}, then pass --allow-js to let ${steps.length === 1 ? 'it' : 'them'} run; a selector or a text check needs no flag`
  )
}

/**
 * Where a peer's saved sign-in may be read from: inside the script's own
 * directory, or a file the person named with `--allow-state`. Answers the
 * resolved path, or throws in words. A saved sign-in is a person's
 * account; a script that could name any path on disk could open a browser
 * as anyone the machine has ever signed in as.
 */
export function peerStatePath(
  dir: string,
  name: string,
  allowed: readonly string[],
): string {
  const file = resolve(dir, name)
  const inside = relative(resolve(dir), file)
  if (inside && !inside.startsWith('..') && !isAbsolute(inside)) return file
  if (allowed.some((a) => resolve(a) === file)) return file
  throw new Error(
    `the script opens a browser signed in from ${file}, which is outside the script's own directory. ` +
      `A script never picks a saved sign-in from elsewhere on this machine. If that is the account you mean: --allow-state ${JSON.stringify(file)}`,
  )
}

/**
 * Settle what this run's script may reach, before anything is opened: the
 * shell variables it reads (`--env`) and the code it runs in the page
 * (`--allow-js`). Throws a usage error that names the flag which grants it.
 */
export function grantReach(
  actions: Parameters<typeof scriptEnvNames>[0] &
    Parameters<typeof jsStepsProblem>[0],
  flags: Record<string, string | true>,
  multi: Record<string, string[]>,
  file: string,
): void {
  const names = multi.env ?? []
  const shape = envFlagProblem(names)
  if (shape) throw new UsageError(shape)
  const env = ungrantedEnvProblem(scriptEnvNames(actions), names, file)
  if (env) throw new UsageError(env)
  const js = jsStepsProblem(actions, flags['allow-js'] === true, file)
  if (js) throw new UsageError(js)
  grantScriptEnv(names)
  grantStatePaths(multi['allow-state'] ?? [])
}
