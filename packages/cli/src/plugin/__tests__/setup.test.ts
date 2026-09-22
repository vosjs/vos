import { describe, expect, it } from 'vitest'
import { validateActions } from '../actions'
import {
  SetupError,
  parseHeaders,
  resolveSetupText,
  runSetup,
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
      'setup[0]: "do" must be one of wait, click, type, press, goto',
    ])
    expect(
      validateSetup([{ do: 'type', selector: '#x', text: { env: 1 } }]),
    ).toEqual([
      'setup[0]: type needs text, a string or { "env": "NAME" } read at run time',
    ])
    expect(validateSetup([{ do: 'press' }])).toEqual([
      'setup[0]: press needs a key',
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
    expect(r.failed).toEqual({ step: 1, do: 'click', selector: '#accept' })
    const err = new SetupError(r.failed!)
    expect(err.message).toContain('setup #1 click #accept')
    expect(err.message).toContain('Nothing was recorded')
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

describe('--header', () => {
  it('parses name=value pairs, keeping = inside the value', () => {
    expect(
      parseHeaders(['x-vercel-protection-bypass=abc=def', 'Cookie=a=1']),
    ).toEqual({ 'x-vercel-protection-bypass': 'abc=def', Cookie: 'a=1' })
    expect(parseHeaders(undefined)).toEqual({})
    expect(() => parseHeaders(['novalue'])).toThrow('name=value')
  })
})
