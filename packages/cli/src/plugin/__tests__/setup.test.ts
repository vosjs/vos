import { describe, expect, it } from 'vitest'
import { validateActions } from '../actions'
import {
  SetupError,
  parseHeaders,
  resolveSetupText,
  runSetup,
  teardownLine,
  validateSetup,
} from '../setup'

describe('setup steps in actions.json', () => {
  const steps = [{ do: 'wait', ms: 100 }]

  it('validates a sign-in that reads its secret from the environment', () => {
    expect(
      validateActions({
        steps,
        setup: [
          { do: 'goto', url: 'http://localhost:3000/login' },
          { do: 'type', selector: '#email', text: 'demo@acme.test' },
          { do: 'type', selector: '#password', text: { env: 'DEMO_PASSWORD' } },
          { do: 'press', key: 'Enter' },
          { do: 'click', selector: '#accept-cookies', ms: 300 },
          { do: 'wait', ms: 500 },
        ],
      }),
    ).toEqual([])
  })

  it('refuses a literal typed into a password field: it would live in a committed file', () => {
    expect(
      validateSetup([{ do: 'type', selector: '#password', text: 'hunter2' }]),
    ).toEqual([
      'setup[0]: a literal value typed into #password would live in actions.json, which is committed and pushed. Use { "env": "NAME" }',
    ])
  })

  it('names what is missing', () => {
    expect(validateSetup([{ do: 'hover', selector: '#x' }])).toEqual([
      'setup[0]: "do" must be one of wait, click, type, press, goto, if',
    ])
    expect(
      validateSetup([{ do: 'type', selector: '#x', text: { env: 1 } }]),
    ).toEqual([
      'setup[0]: type needs text, a string or { "env": "NAME" } read at run time',
    ])
    expect(validateSetup([{ do: 'press' }])).toEqual([
      'setup[0]: press needs a key',
    ])
    expect(validateSetup([{ do: 'if' }])).toEqual([
      'setup[0]: if needs a selector',
    ])
  })
})

describe('resolveSetupText', () => {
  it('reads the variable at run time and says when it is not set', () => {
    expect(resolveSetupText({ env: 'X' }, { X: 's3cret' })).toEqual({
      value: 's3cret',
      secret: true,
    })
    expect(resolveSetupText('plain', {})).toEqual({
      value: 'plain',
      secret: false,
    })
    expect(() => resolveSetupText({ env: 'X' }, {})).toThrow(
      'the environment variable X is not set',
    )
    expect(() => resolveSetupText({ env: 'X' }, { X: '' })).toThrow('not set')
  })
})

describe('runSetup', () => {
  // A page stub: the verbs the setup touches, nothing else.
  const page = (
    opts: { missing?: string[]; filled: string[] } = { filled: [] },
  ) => {
    const gone = new Set(opts.missing ?? [])
    return {
      goto: async () => null,
      keyboard: { press: async () => {} },
      locator: (sel: string) => ({
        first: () => ({
          waitFor: async () => {
            if (gone.has(sel)) throw new Error('timeout')
          },
          click: async () => {},
          fill: async (v: string) => {
            opts.filled.push(v)
          },
        }),
      }),
    }
  }
  const sleep = async () => {}

  it('runs the steps and logs the field, never the value', async () => {
    const filled: string[] = []
    const r = await runSetup(
      page({ filled }) as never,
      [
        { do: 'type', selector: '#email', text: 'demo@acme.test' },
        { do: 'type', selector: '#password', text: { env: 'PW' } },
        { do: 'press', key: 'Enter' },
      ],
      { sleep, env: { PW: 'orchard-lantern-42' } },
    )
    expect(r.ran).toBe(3)
    expect(filled).toEqual(['demo@acme.test', 'orchard-lantern-42'])
    expect(r.lines.join('\n')).not.toContain('orchard-lantern-42')
    expect(r.lines[1]).toBe('setup #1 type ${PW} into #password')
    // even the literal address is logged as a length, since a log rides --json events
    expect(r.lines[0]).toBe('setup #0 type 14 chars into #email')
  })

  it('stops at a selector that never appears, and says which', async () => {
    const r = await runSetup(
      page({ missing: ['#accept'], filled: [] }) as never,
      [
        { do: 'click', selector: '#ok' },
        { do: 'click', selector: '#accept' },
        { do: 'wait', ms: 1 },
      ],
      { sleep },
    )
    expect(r.ran).toBe(1)
    expect(r.failed).toEqual({
      step: 1,
      do: 'click',
      selector: '#accept',
      error: 'timeout',
    })
    const err = new SetupError(r.failed!)
    expect(err.message).toContain('setup #1 click #accept')
    expect(err.message).toContain('Nothing was recorded')
  })

  it('passes a sign-in guarded by if when the session is already signed in', async () => {
    const filled: string[] = []
    const r = await runSetup(
      page({ missing: ['#email'], filled }) as never,
      [
        { do: 'if', selector: '#email' },
        { do: 'type', selector: '#email', text: 'demo@acme.test' },
        { do: 'type', selector: '#password', text: { env: 'PW' } },
        { do: 'press', key: 'Enter' },
      ],
      { sleep, env: { PW: 'orchard-lantern-42' } },
    )
    expect(r.failed).toBeUndefined()
    expect(r.skipped).toEqual({ step: 0, selector: '#email', rest: 3 })
    expect(r.ran).toBe(1)
    expect(filled).toEqual([])
    expect(r.lines).toEqual([
      'setup #0 if #email: not on the page, the 3 step(s) after it skipped',
    ])
  })

  it('surfaces a missing variable instead of typing nothing', async () => {
    await expect(
      runSetup(
        page() as never,
        [{ do: 'type', selector: '#password', text: { env: 'NOPE' } }],
        { sleep, env: {} },
      ),
    ).rejects.toThrow('NOPE is not set')
  })
})

describe('teardown steps in actions.json', () => {
  const steps = [{ do: 'wait', ms: 100 }]

  it('takes the setup’s verbs, env text included', () => {
    expect(
      validateActions({
        steps,
        teardown: [
          { do: 'goto', url: 'http://localhost:3000/settings/keys' },
          { do: 'click', selector: '#revoke', ms: 300 },
          { do: 'type', selector: '#confirm', text: 'revoke' },
          { do: 'type', selector: '#password', text: { env: 'DEMO_PASSWORD' } },
          { do: 'press', key: 'Enter' },
          { do: 'wait', ms: 500 },
        ],
      }),
    ).toEqual([])
  })

  it('names teardown[i] in every message', () => {
    expect(
      validateActions({
        steps,
        teardown: [
          { do: 'hover', selector: '#x' },
          { do: 'type', selector: '#password', text: 'hunter2' },
          { do: 'goto', url: 'file:///etc/passwd' },
          { do: 'press' },
        ],
      }),
    ).toEqual([
      'teardown[0]: "do" must be one of wait, click, type, press, goto, if',
      'teardown[1]: a literal value typed into #password would live in actions.json, which is committed and pushed. Use { "env": "NAME" }',
      'teardown[2]: goto file:///etc/passwd is not an http(s) address, and the recorder opens only http and https pages',
      'teardown[3]: press needs a key',
    ])
    expect(validateActions({ steps, teardown: { do: 'wait' } })).toEqual([
      'teardown must be an array of steps',
    ])
  })
})

describe('runSetup as a teardown', () => {
  const sleep = async () => {}
  const page = (opts: { missing?: string[]; hang?: string[] } = {}) => ({
    goto: async () => null,
    keyboard: { press: async () => {} },
    locator: (sel: string) => ({
      first: () => ({
        waitFor: async () => {
          if (opts.missing?.includes(sel))
            throw new Error(
              `locator.waitFor: Timeout 8000ms exceeded.\nCall log:\n  - waiting for locator('${sel}')`,
            )
          if (opts.hang?.includes(sel)) await new Promise(() => {})
        },
        click: async () => {},
        fill: async () => {},
      }),
    }),
  })

  it('logs as teardown, and reports the step it stopped at with its reason', async () => {
    const r = await runSetup(
      page({ missing: ['#confirm'] }) as never,
      [
        { do: 'click', selector: '#revoke' },
        { do: 'click', selector: '#confirm' },
        { do: 'press', key: 'Enter' },
      ],
      { sleep, phase: 'teardown' },
    )
    expect(r.lines).toEqual(['teardown #0 click #revoke'])
    expect(r.ran).toBe(1)
    expect(r.failed).toEqual({
      step: 1,
      do: 'click',
      selector: '#confirm',
      error: 'locator.waitFor: Timeout 8000ms exceeded.',
    })
  })

  it('ends at an if whose selector is gone: nothing to undo, never a failure', async () => {
    const clicked: string[] = []
    const looked: number[] = []
    const watched = {
      ...page({ missing: ['[aria-label="Actions for CI deploy"]'] }),
      locator: (sel: string) => ({
        first: () => ({
          waitFor: async (o: { timeout: number }) => {
            looked.push(o.timeout)
            if (sel === '[aria-label="Actions for CI deploy"]')
              throw new Error('locator.waitFor: Timeout 3000ms exceeded.')
          },
          click: async () => {
            clicked.push(sel)
          },
          fill: async () => {},
        }),
      }),
    }
    const r = await runSetup(
      watched as never,
      [
        { do: 'press', key: 'Escape' },
        { do: 'if', selector: '[aria-label="Actions for CI deploy"]' },
        { do: 'click', selector: '[aria-label="Actions for CI deploy"]' },
        { do: 'click', selector: '[role="menuitem"]:has-text("Revoke")' },
        { do: 'click', selector: '[role="alertdialog"] button' },
      ],
      { sleep, phase: 'teardown' },
    )
    expect(r.failed).toBeUndefined()
    expect(r.ran).toBe(2)
    expect(r.skipped).toEqual({
      step: 1,
      selector: '[aria-label="Actions for CI deploy"]',
      rest: 3,
    })
    expect(clicked).toEqual([])
    // It looks for the default 3 s, never the 8 s a step waits.
    expect(looked).toEqual([3000])
    expect(r.lines).toEqual([
      'teardown #0 press Escape',
      'teardown #1 if [aria-label="Actions for CI deploy"]: not on the page, the 3 step(s) after it skipped',
    ])
  })

  it('runs past an if whose selector is there, and a failure after it still fails', async () => {
    const r = await runSetup(
      page({ missing: ['#confirm'] }) as never,
      [
        { do: 'if', selector: '#row', ms: 500 },
        { do: 'click', selector: '#revoke' },
        { do: 'click', selector: '#confirm' },
      ],
      { sleep, phase: 'teardown' },
    )
    expect(r.skipped).toBeUndefined()
    expect(r.lines.slice(0, 2)).toEqual([
      'teardown #0 if #row: on the page',
      'teardown #1 click #revoke',
    ])
    expect(r.failed).toEqual({
      step: 2,
      do: 'click',
      selector: '#confirm',
      error: 'locator.waitFor: Timeout 8000ms exceeded.',
    })
  })

  it('reports a variable that is not set instead of throwing', async () => {
    const r = await runSetup(
      page() as never,
      [{ do: 'type', selector: '#why', text: { env: 'NOPE' } }],
      { sleep, env: {}, phase: 'teardown' },
    )
    expect(r.failed?.step).toBe(0)
    expect(r.failed?.error).toContain('teardown: the environment variable NOPE')
  })

  it('stops a step that runs past the whole bound', async () => {
    const started = Date.now()
    const r = await runSetup(
      page({ hang: ['#stuck'] }) as never,
      [
        { do: 'click', selector: '#revoke' },
        { do: 'click', selector: '#stuck' },
      ],
      { sleep, phase: 'teardown', boundMs: 200 },
    )
    expect(Date.now() - started).toBeLessThan(2000)
    expect(r.ran).toBe(1)
    expect(r.failed).toEqual({
      step: 1,
      do: 'click',
      selector: '#stuck',
      error: 'the teardown ran past its 200 ms bound',
    })
  })

  it('never carries a value a type step was filling', async () => {
    const leaky = {
      ...page(),
      locator: () => ({
        first: () => ({
          waitFor: async () => {},
          fill: async (v: string) => {
            throw new Error(`could not fill "${v}"`)
          },
        }),
      }),
    }
    const r = await runSetup(
      leaky as never,
      [{ do: 'type', selector: '#pw', text: { env: 'PW' } }],
      { sleep, env: { PW: 'orchard-lantern-42' }, phase: 'teardown' },
    )
    expect(r.failed?.error).toBe('the field could not be filled')
    expect(JSON.stringify(r)).not.toContain('orchard-lantern-42')
  })

  it('says itself in one line', () => {
    expect(teardownLine({ ran: 3, of: 3 })).toBe('teardown: 3 step(s) ran')
    expect(
      teardownLine({
        ran: 2,
        of: 4,
        failed: {
          step: 2,
          do: 'click',
          selector: '#confirm',
          error: 'locator.waitFor: Timeout 8000ms exceeded.',
        },
      }),
    ).toBe(
      'TEARDOWN FAILED at teardown[2] (click #confirm): locator.waitFor: Timeout 8000ms exceeded. What the take created may still be in the product; remove it by hand.',
    )
    expect(
      teardownLine({
        ran: 0,
        of: 1,
        failed: { step: 0, do: 'press', error: 'the page closed' },
      }),
    ).toContain('at teardown[0] (press): the page closed.')
    expect(
      teardownLine({
        ran: 2,
        of: 5,
        skipped: { step: 1, selector: '#row', rest: 3 },
      }),
    ).toBe(
      'teardown: nothing to undo, #row is not on the page (teardown[1] if); 2 step(s) ran, 3 skipped',
    )
  })
})

describe('--header', () => {
  it('parses name=value pairs, keeping = inside the value', () => {
    expect(
      parseHeaders(['x-vercel-protection-bypass=abc=def', 'Cookie=a=1']),
    ).toEqual({ 'x-vercel-protection-bypass': 'abc=def', Cookie: 'a=1' })
    expect(parseHeaders(undefined)).toEqual({})
    expect(() => parseHeaders(['novalue'])).toThrow('name=value')
  })
})
