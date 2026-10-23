import { chromium } from 'playwright'
import type { Browser } from 'playwright'

export class BrowserUnavailableError extends Error {
  constructor(cause: string) {
    super(
      `Could not launch a Chromium-family browser (${cause}).\n` +
        `Fixes, in order of preference:\n` +
        `  1. Install Google Chrome (used automatically), or\n` +
        `  2. npx playwright install chromium, or\n` +
        `  3. Set VOS_BROWSER_PATH to a Chrome/Chromium executable.`,
    )
  }
}

/**
 * Switches every browser the CLI launches carries.
 *
 * `--disable-updater-scheduler`: Google Chrome on macOS starts its updater
 * (`GoogleUpdater --wake-all`) 19 s after launch, and again every 5 hours.
 * The updater is spawned with the browser's stdout and stderr, and
 * Playwright's `close()` resolves only when every holder of those pipes has
 * closed them, so a browser that lived past 19 s could take as long to
 * close as the updater takes to finish: seconds when the machine is idle,
 * minutes when several browsers woke it at once. The CDP pipe closes at
 * once; only the wait for the updater was slow. The switch is Chromium's
 * own (its browser tests pass it) and does nothing where there is no
 * updater (Linux, Windows, Chromium builds).
 */
export const BROWSER_SWITCHES: readonly string[] = [
  '--disable-updater-scheduler',
]

/**
 * Launch headless Chromium: explicit VOS_BROWSER_PATH → system Chrome
 * (no download needed) → Playwright's bundled Chromium.
 *
 * `args` are extra Chromium switches (`--browser-arg` on the verbs that
 * record). Some product surfaces cannot be reached without one: a recorder
 * needs a fake capture device to get past a permission prompt, an extension
 * page needs the extension loaded. Passed through verbatim, after
 * `BROWSER_SWITCHES`. `headless: false` opens a window (`vos look --headed`).
 */
export async function launchBrowser(
  args: string[] = [],
  launch: { headless?: boolean } = {},
): Promise<Browser> {
  const opts = {
    args: [...BROWSER_SWITCHES, ...args],
    ...(launch.headless === false ? { headless: false } : {}),
  }
  const explicit = process.env.VOS_BROWSER_PATH
  if (explicit) {
    return chromium.launch({ ...opts, executablePath: explicit }).catch((e) => {
      throw new BrowserUnavailableError(
        `VOS_BROWSER_PATH failed: ${(e as Error).message}`,
      )
    })
  }
  try {
    return await chromium.launch({ ...opts, channel: 'chrome' })
  } catch {
    try {
      return await chromium.launch(opts)
    } catch (e) {
      throw new BrowserUnavailableError(
        (e as Error).message.split('\n')[0] ?? 'unknown',
      )
    }
  }
}
