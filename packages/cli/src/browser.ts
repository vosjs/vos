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
 * Launch headless Chromium: explicit VOS_BROWSER_PATH → system Chrome
 * (no download needed) → Playwright's bundled Chromium.
 *
 * `args` are extra Chromium switches (`--browser-arg` on the verbs that
 * record). Some product surfaces cannot be reached without one: a recorder
 * needs a fake capture device to get past a permission prompt, an extension
 * page needs the extension loaded. Passed through verbatim.
 */
export async function launchBrowser(args: string[] = []): Promise<Browser> {
  const opts = args.length ? { args } : {}
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
