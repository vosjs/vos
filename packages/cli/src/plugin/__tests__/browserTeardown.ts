/**
 * The browser tests' teardown. Under a full parallel run (many headless
 * Chromes at once), a shared browser's `close()` can stop answering on
 * macOS, and the hook timing out failed a file whose tests had all passed.
 * The close is bounded and a close that never answered is said; the worker
 * exits after the file, and Playwright kills the browsers it launched then.
 */
import type { Browser } from 'playwright'

export const BROWSER_CLOSE_WAIT_MS = 10_000

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((r) => {
    timer = setTimeout(() => r('late'), BROWSER_CLOSE_WAIT_MS)
  })
  const done = await Promise.race([
    browser.close().then(() => 'closed' as const),
    late,
  ])
  clearTimeout(timer)
  if (done === 'late')
    console.warn(
      `browser.close() did not answer in ${BROWSER_CLOSE_WAIT_MS / 1000} s; leaving it to the worker's exit`,
    )
}
