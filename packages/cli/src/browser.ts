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
 */
export async function launchBrowser(): Promise<Browser> {
  const explicit = process.env.VOS_BROWSER_PATH
  if (explicit) {
    return chromium.launch({ executablePath: explicit }).catch((e) => {
      throw new BrowserUnavailableError(`VOS_BROWSER_PATH failed: ${(e as Error).message}`)
    })
  }
  try {
    return await chromium.launch({ channel: 'chrome' })
  } catch {
    try {
      return await chromium.launch()
    } catch (e) {
      throw new BrowserUnavailableError((e as Error).message.split('\n')[0] ?? 'unknown')
    }
  }
}
