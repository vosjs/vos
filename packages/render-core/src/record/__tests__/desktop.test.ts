import { describe, expect, it } from 'vitest'
import { validateActions } from '../actions'
import {
  DESKTOP_FIND_MS,
  desktopChord,
  desktopProblems,
  runDesktopSteps,
  textSelector,
} from '../desktop'
import type { ActionsFile } from '../actions'
import type { DesktopAnswer, DesktopCommand, DesktopSession } from '../desktop'

// The desktop step loop, over a session that stands in for the helper: it
// keeps the take's clock, knows a few elements by selector, and says what it
// was asked to do. What is held here is the loop: which commands a step
// becomes, how it waits, what it reports, and what it refuses.

function fakeClock() {
  let t = 1000
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    spend: (ms: number) => {
      t += ms
    },
  }
}

interface Element {
  rect: { x: number; y: number; w: number; h: number }
  name?: string
  enabled?: boolean
  /** Appears this many ms into the take. */
  from?: number
  /** Gone from this many ms into the take. */
  until?: number
}

function fakeSession(
  elements: Record<string, Element>,
  o: { fail?: Record<string, { code: string; message: string }> } = {},
) {
  const clock = fakeClock()
  // The take began 250 ms before this side's clock read 1000.
  const take = () => clock.now() - 750
  const sent: DesktopCommand[] = []
  const COST: Record<string, number> = {
    locate: 4,
    now: 0,
    click: 420,
    hover: 300,
    type: 600,
    press: 60,
    scroll: 300,
    drag: 900,
    move: 250,
  }
  const there = (selector: string) => {
    const e = elements[selector]
    if (!e) return undefined
    if (e.from !== undefined && take() < e.from) return undefined
    if (e.until !== undefined && take() >= e.until) return undefined
    return e
  }
  const session: DesktopSession = {
    send: async (command) => {
      sent.push(command)
      const failure = o.fail?.[command.do]
      if (failure) return { ok: false, ...failure }
      const tStart = take()
      const selector = 'selector' in command ? command.selector : undefined
      const e = selector !== undefined ? there(selector) : undefined
      if (command.do === 'locate') {
        clock.spend(COST.locate!)
        return e
          ? {
              ok: true,
              tStart,
              tEnd: take(),
              count: 1,
              enabled: e.enabled ?? true,
              rect: e.rect,
              ...(e.name ? { name: e.name } : {}),
            }
          : { ok: true, tStart, tEnd: take(), count: 0 }
      }
      if (selector !== undefined && !e)
        return {
          ok: false,
          code: 'not-found',
          message: `Nothing in the window matches ${selector}.`,
        }
      clock.spend(COST[command.do] ?? 0)
      const answer: DesktopAnswer = {
        ok: true,
        tStart,
        tEnd: take(),
        ...(e ? { rect: e.rect, count: 1, enabled: e.enabled ?? true } : {}),
        ...(command.do === 'click' ? { pressed: e?.enabled !== false } : {}),
      }
      return answer
    },
  }
  return { session, clock, sent, take }
}

const SAVE = { rect: { x: 15, y: 53, w: 82, h: 30 }, name: 'Save' }
const TITLE = { rect: { x: 15, y: 95, w: 202, h: 26 }, name: 'Title' }

const run = (
  elements: Record<string, Element>,
  actions: ActionsFile,
  opts: Parameters<typeof runDesktopSteps>[3] = {},
  o: Parameters<typeof fakeSession>[1] = {},
) => {
  const fake = fakeSession(elements, o)
  const logs: string[] = []
  return runDesktopSteps(fake.session, actions, (m) => logs.push(m), {
    clock: fake.clock,
    ...opts,
  }).then((result) => ({ ...fake, logs, result }))
}

describe('desktopProblems', () => {
  it('lets a script of desktop steps through', () => {
    const actions: ActionsFile = {
      app: 'TextEdit',
      viewport: { width: 900, height: 600 },
      steps: [
        { do: 'click', selector: "button[name='Save']", id: 'save' },
        { do: 'type', selector: 'textarea', text: 'hello' },
        { do: 'press', keys: ['Mod+S', 'Enter'] },
        { do: 'scroll', dy: 200 },
        { do: 'hover', x: 10, y: 10 },
        { do: 'drag', selector: 'slider', tx: 300, ty: 40 },
        { do: 'expect', text: 'Saved', timeout: 10 },
        { do: 'wait', ms: 500 },
      ],
    }
    expect(validateActions(actions)).toEqual([])
    expect(desktopProblems(actions)).toEqual([])
  })

  it('refuses what only a page has, each in words', () => {
    const actions = {
      url: 'https://example.com',
      mask: [{ selector: '.email' }],
      ready: 'networkidle',
      settle: true,
      steps: [
        { do: 'paste', text: 'x' },
        { do: 'download', selector: 'a' },
        { do: 'await', until: { selector: 'x' } },
        { do: 'expect', js: 'true' },
        { do: 'click', selector: 'x', button: 'middle' },
        { do: 'drag', path: [[0, 0]] },
        { do: 'press', keys: 'Meta++' },
        { do: 'click', selector: 'x', settle: true },
      ],
    } as unknown as ActionsFile
    const problems = desktopProblems(actions)
    expect(problems).toHaveLength(12)
    expect(problems[0]).toMatch(/^url is not part of a desktop script/)
    expect(problems.join('\n')).toMatch(/steps\[2\]: await .* use expect/)
    expect(problems.join('\n')).toMatch(/steps\[3\]: expect js runs in a page/)
  })

  it('a script names a url or an app, never both', () => {
    expect(
      validateActions({
        url: 'https://example.com',
        app: 'TextEdit',
        steps: [{ do: 'wait', ms: 1 }],
      }),
    ).toContain('a script records a url or an app, not both')
    expect(
      validateActions({ app: '  ', steps: [{ do: 'wait', ms: 1 }] }),
    ).toContain('app must be an app’s name or bundle id')
  })
})

describe('desktopChord and textSelector', () => {
  it('reads Mod as Command', () => {
    expect(desktopChord('Mod+S')).toBe('Meta+S')
    expect(desktopChord('ControlOrMeta+Shift+P')).toBe('Meta+Shift+P')
    expect(desktopChord('Enter')).toBe('Enter')
    expect(desktopChord('Control+A')).toBe('Control+A')
  })
  it('makes words a selector, quotes kept safe', () => {
    expect(textSelector('Saved')).toBe("*[name*='Saved']")
    expect(textSelector("it's \\ done")).toBe("*[name*='it\\'s \\\\ done']")
  })
})

describe('runDesktopSteps', () => {
  it('turns steps into commands and spans on the take clock', async () => {
    const { result, sent } = await run(
      { "button[id='save']": SAVE, "textfield[id='title']": TITLE },
      {
        steps: [
          { do: 'click', selector: "button[id='save']", id: 'save', ms: 600 },
          {
            do: 'type',
            selector: "textfield[id='title']",
            text: 'hello',
            replace: true,
          },
          { do: 'press', keys: ['Mod+S', 'Enter'] },
          { do: 'wait', ms: 300 },
        ],
      },
    )
    expect(sent.map((c) => c.do)).toEqual([
      'now',
      'locate', // the click waits for its target
      'click',
      'locate', // the type waits for its field
      'click', // focus
      'press', // replace: select all
      'type',
      'press',
      'press',
    ])
    expect(sent[5]).toEqual({ do: 'press', keys: ['Meta+A'] })
    expect(sent[6]).toEqual({ do: 'type', text: 'hello', delayMs: 40 })
    expect(sent[7]).toEqual({ do: 'press', keys: 'Meta+S' })

    const [click, type, press, wait] = result.steps
    expect(click).toMatchObject({
      step: 0,
      id: 'save',
      do: 'click',
      selector: "button[id='save']",
      rect: SAVE.rect,
    })
    // The take was 250 ms in when the script began; a click costs a locate,
    // the click and the 600 ms the step asked to hold.
    expect(click!.tStart).toBe(0.25)
    expect(click!.tEnd).toBeCloseTo(0.25 + (4 + 420 + 600) / 1000, 3)
    expect(type!.tStart).toBe(click!.tEnd)
    expect(type!.rect).toEqual(TITLE.rect)
    expect(press!.selector).toBeUndefined()
    expect(wait!.tEnd - wait!.tStart).toBeCloseTo(0.3, 3)
    for (let i = 1; i < result.steps.length; i++)
      expect(result.steps[i]!.tStart).toBeGreaterThanOrEqual(
        result.steps[i - 1]!.tEnd,
      )
    expect(result.skipped).toEqual([])
    expect(result.stopped).toBeNull()
    expect(result.pace.askedMs).toBeGreaterThan(0)
  })

  it('waits for an element that is not there yet', async () => {
    const { result, sent } = await run(
      { 'button.late': { ...SAVE, from: 1500 } },
      { steps: [{ do: 'click', selector: 'button.late' }] },
    )
    expect(result.skipped).toEqual([])
    expect(sent.filter((c) => c.do === 'locate').length).toBeGreaterThan(5)
    expect(result.steps[0]!.tEnd).toBeGreaterThan(1.5)
  })

  it('skips a step whose element never comes, and goes on', async () => {
    const { result, logs } = await run(
      { "button[id='save']": SAVE },
      {
        steps: [
          { do: 'click', selector: "button[name='Nope']", id: 'nope' },
          { do: 'click', selector: "button[id='save']" },
        ],
      },
    )
    expect(result.skipped).toEqual([
      { step: 0, id: 'nope', do: 'click', selector: "button[name='Nope']" },
    ])
    expect(result.steps[0]).toMatchObject({ skipped: true })
    expect(result.steps[0]!.tEnd - result.steps[0]!.tStart).toBeGreaterThan(
      DESKTOP_FIND_MS / 1000,
    )
    expect(result.steps[1]!.skipped).toBeUndefined()
    expect(logs.join('\n')).toMatch(/nothing matches button\[name='Nope'\]/)
  })

  it('reaches a disabled control and says it was not pressed', async () => {
    const { result } = await run(
      { 'button.off': { ...SAVE, enabled: false } },
      { steps: [{ do: 'click', selector: 'button.off', id: 'off' }] },
    )
    expect(result.disabled).toEqual([
      { step: 0, id: 'off', selector: 'button.off' },
    ])
    expect(result.skipped).toEqual([])
  })

  it('an expect holds when the words appear, and is a skip with a reason when they do not', async () => {
    const saved = textSelector('Saved')
    const held = await run(
      { [saved]: { rect: SAVE.rect, from: 900 } },
      { steps: [{ do: 'expect', text: 'Saved' }] },
    )
    expect(held.result.skipped).toEqual([])
    expect(held.result.steps[0]).toMatchObject({
      do: 'expect',
      selector: 'Saved',
      rect: SAVE.rect,
    })

    const missed = await run(
      {},
      { steps: [{ do: 'expect', text: 'Saved', timeout: 2 }] },
    )
    expect(missed.result.skipped[0]).toMatchObject({
      step: 0,
      do: 'expect',
      reason: 'text "Saved" did not appear within 2 s',
    })

    const gone = await run(
      { sheet: { rect: SAVE.rect, until: 700 } },
      { steps: [{ do: 'expect', gone: 'sheet' }] },
    )
    expect(gone.result.skipped).toEqual([])

    const off = await run(
      { 'button.off': { ...SAVE, enabled: false } },
      {
        steps: [
          { do: 'expect', selector: 'button.off', enabled: true, timeout: 1 },
        ],
      },
    )
    expect(off.result.skipped[0]!.reason).toBe(
      'button.off was still disabled after 1 s',
    )
  })

  it('reads what an element is called when the step asks', async () => {
    const { result } = await run(
      {
        "button[id='save']": SAVE,
        "text[id='status']": { ...TITLE, name: 'Saved 12:01' },
      },
      {
        steps: [
          {
            do: 'click',
            selector: "button[id='save']",
            read: "text[id='status']",
          },
        ],
      },
    )
    expect(result.steps[0]!.text).toBe('Saved 12:01')
  })

  it('stops the take when the app cannot be acted on', async () => {
    const { result } = await run(
      { "button[id='save']": SAVE },
      {
        steps: [
          { do: 'click', selector: "button[id='save']", id: 'save' },
          { do: 'wait', ms: 100 },
        ],
      },
      {},
      {
        fail: {
          click: {
            code: 'not-frontmost',
            message: 'The app could not be brought to the front.',
          },
        },
      },
    )
    expect(result.stopped).toEqual({
      step: 0,
      id: 'save',
      reason: 'The app could not be brought to the front.',
    })
    expect(result.steps).toHaveLength(1)
    expect(result.skipped).toEqual([])
  })

  it('stops at the cap and says the rest did not run', async () => {
    const { result, logs } = await run(
      {},
      {
        steps: [
          { do: 'wait', ms: 5000 },
          { do: 'wait', ms: 5000 },
          { do: 'wait', ms: 5000 },
        ],
      },
      { maxDurationSeconds: 6 },
    )
    expect(result.capped).toBe(true)
    expect(result.steps).toHaveLength(2)
    // The second wait never sleeps past the cap.
    expect(result.steps[1]!.tEnd).toBeCloseTo(6, 2)
    expect(logs.join('\n')).toMatch(/--max-duration 6/)
  })

  it('marks a guarded step the command confirmed', async () => {
    const { result } = await run(
      { "button[name='Buy']": SAVE },
      {
        steps: [
          {
            do: 'click',
            selector: "button[name='Buy']",
            id: 'buy',
            guard: 'spend',
          },
        ],
      },
      { confirm: ['buy'] },
    )
    expect(result.confirmed).toEqual(['buy'])
    expect(result.steps[0]).toMatchObject({ guard: 'spend', confirmed: true })
  })
})
