import { describe, expect, it } from 'vitest'
import { hostedRefusals, validateActions } from '../actions'
import { StepSignals } from '../peers'

/**
 * `peers`, held where both hosts read it: a peer is checked in the take's
 * own step words plus its own (a verb only the filmed page takes, a field
 * only a take step carries, a trigger naming no take step), a hosted take
 * refuses peers, and the take's step boundaries are promises a peer's step
 * waits on, which never fire once the take is over.
 */
const take = (peers: unknown) =>
  validateActions({
    url: 'https://app.example.test/board',
    steps: [
      { id: 'open', do: 'wait', ms: 200 },
      { id: 'draw', do: 'click', x: 100, y: 100 },
    ],
    peers,
  })

describe('peers', () => {
  it('takes peers whose steps start with a take step, after one, or in turn', () => {
    expect(
      take([
        {
          id: 'bob',
          storageState: 'bob.json',
          steps: [
            { after: 'open', do: 'click', x: 300, y: 200 },
            { do: 'type', selector: '#name', text: 'Bob', at: 'end' },
            { with: 'draw', do: 'drag', x: 10, y: 10, tx: 80, ty: 40 },
            {
              do: 'drag',
              path: [
                [10, 10],
                [20, 30],
              ],
            },
            { do: 'expect', text: 'Ada is here' },
          ],
        },
        {
          id: 'cy',
          url: 'https://app.example.test/board?as=cy',
          viewport: { width: 800, height: 600 },
          steps: [{ do: 'hover', x: 5, y: 5 }],
        },
      ]),
    ).toEqual([])
  })

  it('refuses what belongs to the filmed page, in the peer’s own address', () => {
    expect(
      take([
        {
          id: 'bob',
          steps: [
            { do: 'await', until: { text: 'x' } },
            { do: 'paste', text: 'hi' },
            { id: 'buy', do: 'click', x: 1, y: 1, guard: 'spend' },
            { do: 'click', x: 1, y: 1, read: '#a', caption: 'Bob clicks' },
            { do: 'drag', path: 'loop.json' },
          ],
        },
      ]),
    ).toEqual([
      'peers[0].steps[0]: a peer step is one of wait, move, hover, click, type, press, scroll, drag, expect; an await belongs to the filmed page (wait for what the peer did with the take’s own await or expect)',
      'peers[0].steps[1]: a peer step is one of wait, move, hover, click, type, press, scroll, drag, expect; a paste belongs to the filmed page',
      'peers[0].steps[2]: no guard on a peer step: a guard is pressed only on the filmed page, under --confirm',
      'peers[0].steps[3]: no read on a peer step: read keeps words from the filmed page',
      'peers[0].steps[3]: no caption on a peer step: a caption is a beat of the film, which is the take’s',
      'peers[0].steps[4]: a peer draws its path inline (an array of points), never from a file',
    ])
  })

  it('refuses a zoom mark on a peer step, true or false: a peer is never on the cursor track', () => {
    expect(
      take([
        {
          id: 'bob',
          steps: [
            { do: 'click', x: 1, y: 1, zoom: true },
            {
              do: 'drag',
              from: { x: 1, y: 1 },
              to: { x: 9, y: 9 },
              zoom: false,
            },
          ],
        },
      ]).filter((e) => e.includes('zoom')),
    ).toEqual([
      'peers[0].steps[0]: no zoom on a peer step: a zoom mark picks a moment on the cursor track, and a peer is never on it',
      'peers[0].steps[1]: no zoom on a peer step: a zoom mark picks a moment on the cursor track, and a peer is never on it',
    ])
  })

  it('refuses a trigger naming no take step, both triggers, and a bad step in the take’s words', () => {
    expect(
      take([
        {
          id: 'bob',
          steps: [
            { with: 'nope', do: 'wait', ms: 1 },
            { with: 'open', after: 'draw', do: 'wait', ms: 1 },
            { do: 'click' },
          ],
        },
      ]),
    ).toEqual([
      'peers[0].steps[0]: with "nope" names no take step (the take\'s steps with ids: open, draw); give the take step an id',
      "peers[0].steps[1]: with or after, not both (with starts as the take's step starts, after once it ends)",
      'peers[0].steps[2]: click needs a selector, or x and y (a viewport point)',
    ])
  })

  it('refuses a malformed peer, a duplicate id, and too many', () => {
    expect(take({ id: 'x' })).toEqual([
      'peers must be an array of { id, url?, viewport?, storageState?, steps }',
    ])
    expect(
      take([
        { id: 'bob', steps: [{ do: 'wait', ms: 1 }] },
        { id: 'bob', steps: [] },
        {
          id: 'has space',
          url: 'file:///etc/passwd',
          viewport: 1,
          session: 'x',
          steps: [{ do: 'wait', ms: 1 }],
        },
      ]),
    ).toEqual([
      'peers[1]: duplicate peer id "bob"',
      'peers[1]: steps must be a non-empty array',
      'peers[2]: id must be a short word (letters, digits, - and _, at most 32), which lines and meta.peers name the peer by',
      'peers[2]: url file:///etc/passwd is not an http(s) address, and the recorder opens only http and https pages',
      'peers[2]: viewport must be { width, height }',
      'peers[2]: a peer takes id, url, viewport, storageState and steps, not session',
    ])
    const five = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      steps: [{ do: 'wait', ms: 1 }],
    }))
    expect(take(five)).toEqual([
      'peers names 5 peers; a take holds at most 4 (each is a whole browser)',
    ])
  })

  it('is refused on a hosted take', () => {
    expect(
      hostedRefusals({
        steps: [{ do: 'wait', ms: 1 }],
        peers: [{ id: 'bob', steps: [{ do: 'wait', ms: 1 }] }],
      }),
    ).toEqual([
      'the script has peers (more browsers on the page, off camera), and a hosted take runs one browser: record it on this machine',
    ])
    expect(
      hostedRefusals({ steps: [{ do: 'wait', ms: 1 }], peers: [] }),
    ).toEqual([])
  })
})

describe('the take’s step boundaries', () => {
  it('fire as the take reaches them, say when one already has, and never fire once the take is over', async () => {
    const s = new StepSignals(['open', 'draw', 'done'])
    const first = s.when({})
    const withDraw = s.when({ with: 'draw' })
    const afterDraw = s.when({ after: 'draw' })
    const afterDone = s.when({ after: 'done' })
    const order: string[] = []
    void first.ready.then(() => order.push('begin'))
    void withDraw.ready.then(() => order.push('with draw'))
    void afterDraw.ready.then(() => order.push('after draw'))
    s.begin()
    s.start('open')
    s.end('open')
    s.start('draw')
    await Promise.resolve()
    expect(order).toEqual(['begin', 'with draw'])
    s.end('draw')
    expect(await afterDraw.ready).toBe(true)
    // Asked again once it has fired: ready at once, and said to be late.
    expect(s.when({ with: 'draw' }).already).toBe(true)
    s.close()
    expect(await afterDone.ready).toBe(false)
    expect(await s.when({ with: 'unknown' }).ready).toBe(false)
    expect(s.isClosed).toBe(true)
  })
})
