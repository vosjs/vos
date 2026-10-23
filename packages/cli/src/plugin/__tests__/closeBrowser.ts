/**
 * Close a test's browser without letting a slow shutdown fail the suite.
 * `browser.close()` resolves once Chrome's process has closed its pipes and
 * Playwright has removed the temporary profile, and on a loaded machine
 * that was measured at 20 to 90 s after the last context was already
 * closed: a teardown timing, not something any test proves. Waited a
 * bounded while; whatever Chrome is left is killed by Playwright's own exit
 * handler when the test process ends.
 */
export async function closeBrowser(
  browser: { close(): Promise<void> } | null | undefined,
  ms = 15_000,
): Promise<void> {
  if (!browser) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise<void>((r) => (timer = setTimeout(r, ms))),
  ])
  clearTimeout(timer)
}
