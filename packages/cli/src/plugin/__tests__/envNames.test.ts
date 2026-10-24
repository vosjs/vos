import { describe, expect, it, vi } from 'vitest'
import { announceEnvNames, envNamesNotice } from '../hostedRecord'
import type { ActionsFile } from '../actions'

const withSetup = (setup: unknown): Pick<ActionsFile, 'setup'> =>
  ({ setup }) as unknown as Pick<ActionsFile, 'setup'>

describe('the env names a script reads are said before any value is', () => {
  it('lists each name once, from the setup, and never a value', () => {
    const notice = envNamesNotice(
      withSetup([
        { do: 'goto', url: 'https://example.com/login' },
        { do: 'type', selector: '#email', text: { env: 'DEMO_EMAIL' } },
        { do: 'type', selector: '#pw', text: { env: 'DEMO_PASSWORD' } },
        { do: 'type', selector: '#code', text: { env: 'DEMO_EMAIL' } },
        { do: 'type', selector: '#note', text: 'a literal' },
      ]),
    )
    expect(notice?.names).toEqual(['DEMO_EMAIL', 'DEMO_PASSWORD'])
    expect(notice?.line).toBe(
      'the setup reads these environment variables from this shell: DEMO_EMAIL, DEMO_PASSWORD (names only; a value is never printed or stored)',
    )
    expect(notice?.line).not.toContain('a literal')
  })

  it('names the teardown’s variables too, and says who reads them', () => {
    const both = envNamesNotice({
      setup: [{ do: 'type', selector: '#pw', text: { env: 'DEMO_PW' } }],
      teardown: [
        { do: 'type', selector: '#pw', text: { env: 'DEMO_PW' } },
        { do: 'type', selector: '#why', text: { env: 'REVOKE_REASON' } },
      ],
    } as unknown as Pick<ActionsFile, 'setup' | 'teardown'>)
    expect(both?.names).toEqual(['DEMO_PW', 'REVOKE_REASON'])
    expect(both?.line).toMatch(
      /^the setup and teardown read these environment variables from this shell: DEMO_PW, REVOKE_REASON/,
    )
    const teardownOnly = envNamesNotice({
      teardown: [{ do: 'type', selector: '#why', text: { env: 'WHY' } }],
    } as unknown as Pick<ActionsFile, 'setup' | 'teardown'>)
    expect(teardownOnly?.line).toMatch(
      /^the teardown reads this environment variable from this shell: WHY/,
    )
  })

  it('says one name in the singular', () => {
    expect(
      envNamesNotice(
        withSetup([{ do: 'type', selector: '#pw', text: { env: 'PW' } }]),
      )?.line,
    ).toMatch(/^the setup reads this environment variable from this shell: PW/)
  })

  it('is silent for a script that reads nothing', () => {
    expect(envNamesNotice(withSetup(undefined))).toBeNull()
    expect(
      envNamesNotice(
        withSetup([{ do: 'type', selector: '#q', text: 'hello' }]),
      ),
    ).toBeNull()
    const r = { log: vi.fn(), event: vi.fn() }
    announceEnvNames(withSetup(undefined), r)
    expect(r.log).not.toHaveBeenCalled()
    expect(r.event).not.toHaveBeenCalled()
  })

  it('announces as one line and one env event, names only', () => {
    const r = { log: vi.fn(), event: vi.fn() }
    announceEnvNames(
      withSetup([{ do: 'type', selector: '#pw', text: { env: 'DEMO_PW' } }]),
      r,
    )
    expect(r.log).toHaveBeenCalledTimes(1)
    expect(r.log.mock.calls[0][0]).toContain('DEMO_PW')
    expect(r.event).toHaveBeenCalledWith({ event: 'env', names: ['DEMO_PW'] })
  })
})
