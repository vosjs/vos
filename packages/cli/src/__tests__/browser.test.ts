/**
 * Every browser the CLI launches carries `BROWSER_SWITCHES` ahead of the
 * caller's own switches. The one that matters: without
 * `--disable-updater-scheduler`, Google Chrome on macOS hands its stdout and
 * stderr to its updater 19 s after launch, and `close()` waits for the
 * updater to finish (measured: 4 to 6 s for one browser, 10 to 15 minutes
 * for nine at once; under 1.2 s with the switch).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const launch = vi.fn()
const launchPersistentContext = vi.fn()
vi.mock('playwright', () => ({
  chromium: { launch, launchPersistentContext },
}))

const { BROWSER_SWITCHES, launchBrowser } = await import('../browser')
const { withProfile } = await import('../plugin/session')

beforeEach(() => {
  launch.mockReset()
  launchPersistentContext.mockReset()
  delete process.env.VOS_BROWSER_PATH
})

describe('the switches every launched browser carries', () => {
  it('turns off the updater that would hold the browser’s pipes past close', () => {
    expect(BROWSER_SWITCHES).toContain('--disable-updater-scheduler')
  })

  it('puts them before the caller’s own switches, on system Chrome', async () => {
    launch.mockResolvedValue({})
    await launchBrowser(['--use-fake-ui-for-media-stream'])
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0][0]).toMatchObject({
      channel: 'chrome',
      args: [...BROWSER_SWITCHES, '--use-fake-ui-for-media-stream'],
    })
  })

  it('keeps them on the bundled fallback and on VOS_BROWSER_PATH', async () => {
    launch.mockRejectedValueOnce(new Error('no chrome')).mockResolvedValue({})
    await launchBrowser()
    expect(launch.mock.calls[1][0]).toEqual({ args: [...BROWSER_SWITCHES] })

    launch.mockReset().mockResolvedValue({})
    process.env.VOS_BROWSER_PATH = '/opt/chrome'
    await launchBrowser([], { headless: false })
    expect(launch.mock.calls[0][0]).toEqual({
      args: [...BROWSER_SWITCHES],
      headless: false,
      executablePath: '/opt/chrome',
    })
  })

  it('rides a session profile too', async () => {
    launchPersistentContext.mockResolvedValue({ close: async () => {} })
    await withProfile('/tmp/profile', async () => 'done')
    expect(launchPersistentContext.mock.calls[0][1]).toMatchObject({
      channel: 'chrome',
      args: [...BROWSER_SWITCHES],
      ignoreDefaultArgs: ['--use-mock-keychain'],
    })
  })
})
