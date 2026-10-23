/**
 * Close a test's browser without letting a slow shutdown fail the suite.
 * `browser.close()` resolves once every holder of the browser's stdio pipes
 * has closed them and Playwright has removed the temporary profile. The
 * slow closes that were measured (20 to 90 s, minutes with several browsers
 * at once) were Google Chrome's updater on macOS, which the browser spawns
 * 19 s after launch with its stdout and stderr; `launchBrowser` now turns
 * that off (`BROWSER_SWITCHES`). This stays as the guard for whatever else
 * a browser hands its pipes to: a teardown timing, not something any test
 * proves. Waited a bounded while; whatever Chrome is left is killed by
 * Playwright's own exit handler when the test process ends.
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
