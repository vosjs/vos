import { describe, expect, it } from 'vitest'
import {
  EXPOSURE_MATCHERS_SRC,
  ExposureLog,
  exposureLine,
  maskInitScript,
} from '../exposure'
import { validateActions } from '../actions'

// The SAME source the recorder evaluates in the page, evaluated here.
const { kindsIn } = new Function(`return ${EXPOSURE_MATCHERS_SRC}`)() as {
  kindsIn: (text: string) => string[]
}

describe('what counts as exposed', () => {
  it('sees a real email address', () => {
    expect(kindsIn('Signed in as jane.doe@realcustomer.com')).toEqual(['email'])
    expect(kindsIn('sam.rivera@gmail.com')).toEqual(['email'])
  })

  it('lets demo data be demo data: addresses that can reach no one', () => {
    for (const safe of [
      'robin@example.com',
      'dana@sub.example.org',
      'demo@northwind.test',
      'a@b.invalid',
      'me@app.localhost',
    ])
      expect(kindsIn(`Signed in as ${safe}`), safe).toEqual([])
    // one safe address does not excuse a real one beside it
    expect(kindsIn('robin@example.com, cc jane@acme.io')).toEqual(['email'])
  })

  it('sees the keys people paste into dashboards', () => {
    // Assembled from parts: a token-shaped LITERAL in a repo is what secret
    // scanners exist to refuse, and these are made up.
    const made = (...parts: string[]) => parts.join('')
    for (const key of [
      made('sk', '_live_', '4eC39HqLyjWDarjtT1zdp7dc'),
      made('pk', '_test_', 'TYooMQauvdEDq54NiTphI7jx'),
      made('gh', 'p_', '16C7e42F292c6912E7710c838347Ae178B4a'),
      made('github', '_pat_', '11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz'),
      made('xo', 'xb-', '2222222222-3333333333333-abcdefghijklmnop'),
      made('AK', 'IA', 'IOSFODNN7EXAMPLE'),
      made('vos', '_sk_', '9f8e7d6c5b4a3210'),
      made(
        'ey',
        'JhbGciOiJIUzI1NiJ9.',
        'ey',
        'JzdWIiOiIxMjM0NTY3ODkwIn0.',
        'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV',
      ),
    ])
      expect(kindsIn(`token: ${key}`), key).toEqual(['key'])
    expect(kindsIn('the desk is asking for a risk_level_high review')).toEqual(
      [],
    )
  })

  it('tells a card number from an order number by the Luhn check', () => {
    expect(kindsIn('4242 4242 4242 4242')).toEqual(['card'])
    expect(kindsIn('Card 5555-5555-5555-4444 on file')).toEqual(['card'])
    expect(kindsIn('Order 1234 5678 9012 3456')).toEqual([])
    expect(kindsIn('Call +1 415 555 0132 0000')).toEqual([])
    expect(kindsIn('0000 0000 0000 0000')).toEqual([])
  })

  it('sees the visible tail of a masked card', () => {
    expect(kindsIn('•••• 4242')).toEqual(['card-tail'])
    expect(kindsIn('Visa ****1881')).toEqual(['card-tail'])
    expect(kindsIn('$812.00 this month, 14 seats')).toEqual([])
  })
})

describe('ExposureLog', () => {
  const hit = {
    kind: 'email' as const,
    selector: 'span.account',
    rect: { x: 900, y: 12, w: 180, h: 20 },
  }

  it('lists a thing once, at the first step it was seen, and counts the rest', () => {
    const log = new ExposureLog()
    log.add(-1, { exposures: [hit] })
    log.add(0, { exposures: [hit] })
    log.add(1, {
      exposures: [hit, { ...hit, kind: 'card-tail', selector: 'div.card' }],
    })
    log.add(2, null) // a scan lost to a navigation is skipped, never fatal
    expect(log.exposures()).toEqual([
      { step: -1, ...hit, seen: 3 },
      { step: 1, ...hit, kind: 'card-tail', selector: 'div.card', seen: 1 },
    ])
  })

  it('says it in words, and never quotes the string', () => {
    const line = exposureLine({ step: -1, ...hit, seen: 3 })
    expect(line).toBe(
      'an email address in span.account (as the page opened, 900,12 180×20)',
    )
  })

  it('reports a mask that reached nothing as hits 0', () => {
    const rules = [
      { selector: '.account', as: 'text' as const, text: 'demo@acme.test' },
      { selector: '#missing' },
    ]
    const log = new ExposureLog(rules)
    log.add(0, { maskHits: { '.account': 1, '#missing': 0 } })
    log.add(1, { maskHits: { '.account': 2, '#missing': 0 } })
    log.add(2, { maskHits: { '.account': 1, '#missing': 0 } })
    expect(log.masks(rules)).toEqual([
      { selector: '.account', as: 'text', hits: 2 },
      { selector: '#missing', as: 'blur', hits: 0 },
    ])
  })
})

describe('mask in actions.json', () => {
  const steps = [{ do: 'wait', ms: 100 }]

  it('validates', () => {
    expect(
      validateActions({
        steps,
        mask: [
          { selector: '.account', as: 'text', text: 'demo@acme.test' },
          { selector: '.card-number' },
        ],
      }),
    ).toEqual([])
    expect(validateActions({ steps, mask: [{ as: 'blur' }] })).toEqual([
      'mask[0]: needs a selector',
    ])
    expect(
      validateActions({ steps, mask: [{ selector: '.a', as: 'text' }] }),
    ).toEqual(['mask[0]: as "text" needs the text to show instead'])
    expect(
      validateActions({ steps, mask: [{ selector: '.a', as: 'pixelate' }] }),
    ).toEqual(['mask[0]: as must be "blur" or "text"'])
    expect(
      validateActions({ steps, mask: [{ selector: '.a', text: 'x' }] }),
    ).toEqual(['mask[0]: text is only read with as "text"'])
  })

  it('carries its rules into the page as data, quotes and all', () => {
    const src = maskInitScript([
      { selector: '[data-user="a\'b"]', as: 'text', text: 'It\'s "demo"' },
    ])
    // parses as a script, and the rule survives intact
    expect(() => new Function(src)).not.toThrow()
    expect(src).toContain(JSON.stringify('[data-user="a\'b"]'))
    expect(src).toContain(JSON.stringify('It\'s "demo"'))
  })
})
