/**
 * Run your own browser code inside a saved session.
 *
 * Some work a take needs is not a step: looking at a state that exists only
 * after a click that creates something, listing what an account holds,
 * cleaning up after a flow. The tempting way is to open the session's
 * profile with your own browser, and that is the one way to lose it: the
 * cookies a plain Chrome saved are encrypted with a key in the login
 * keychain, Playwright's bundled browser and any mock keychain cannot read
 * them, and a browser that cannot read them starts the profile over,
 * signed out. `vos session exec` opens the profile the way every vos verb
 * does (the system Chrome, the real keychain) and hands the script the
 * context and a page; the profile is closed cleanly whatever the script
 * does.
 *
 * The script is an ES module whose default export is a function:
 *
 *   export default async ({ context, page, url, name }) => {
 *     await page.goto(url)
 *     return await page.title()
 *   }
 *
 * What it returns (JSON-serializable) is the command's result.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { withProfile } from './session'
import type { BrowserContext, Page } from 'playwright'

export interface ExecArgs {
  context: BrowserContext
  page: Page
  /** The `--url` given, when one was (the page is already on it). */
  url?: string
  /** The session's name. */
  name: string
}

export type ExecScript = (args: ExecArgs) => unknown

/** A script that could not run, said in words (exit 2). */
export class ExecScriptError extends Error {}

/** Load the module and find its default function, in words when it has none. */
export async function loadExecScript(path: string): Promise<ExecScript> {
  const file = resolve(path)
  if (!existsSync(file)) throw new ExecScriptError(`no script at ${file}`)
  if (!/\.(m?js|cjs)$/.test(file))
    throw new ExecScriptError(
      `${path}: a script is a .mjs or .js module (compile TypeScript first)`,
    )
  const mod = (await import(pathToFileURL(file).href)) as {
    default?: unknown
  }
  if (typeof mod.default !== 'function')
    throw new ExecScriptError(
      `${path} has no default export function: export default async ({ context, page, url }) => { … }`,
    )
  return mod.default as ExecScript
}

/**
 * Open the profile in `dir` as every vos verb does, run the script in it,
 * and close the profile, whatever the script does. The script's own error
 * is rethrown after the close.
 */
export async function execInProfile(
  dir: string,
  script: ExecScript,
  opts: {
    name: string
    url?: string
    headless?: boolean
    viewport?: { width: number; height: number }
  },
): Promise<unknown> {
  return withProfile(
    dir,
    async (context) => {
      const page = context.pages()[0] ?? (await context.newPage())
      if (opts.url)
        await page.goto(opts.url, { waitUntil: 'load', timeout: 30000 })
      return await script({
        context,
        page,
        name: opts.name,
        ...(opts.url ? { url: opts.url } : {}),
      })
    },
    {
      headless: opts.headless ?? true,
      ...(opts.viewport ? { viewport: opts.viewport } : {}),
    },
  )
}
