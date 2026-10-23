import { describe, expect, it } from 'vitest'
import {
  fileNameProblem,
  guardVerdict,
  guardedSteps,
  hostedRefusals,
  validateActions,
} from '../actions'
import {
  conditionMiss,
  keptValue,
  sameJson,
  sayCondition,
  sayDuration,
} from '../waits'
import { nameFromUrl, outputName, plainName, readAllBytes } from '../outputs'
import { splitSegmentsAtSkips } from '../plan'

/**
 * The step vocabulary beyond the gestures, held where both hosts read it:
 * `guard`, `expect`, `await` and `download` validate in specific words,
 * a guard is confirmed or refused before a capture, a hosted recorder
 * refuses what it cannot do, a download lands under a plain name, and a
 * fresh plan cuts its segments where an await cut the footage.
 */
const one = (step: Record<string, unknown>) =>
  validateActions({ steps: [step] })

describe('zoom', () => {
  it('takes a true or false mark on a gesture', () => {
    expect(
      validateActions({
        steps: [
          { do: 'drag', x: 1, y: 1, tx: 9, ty: 9, zoom: true },
          { do: 'type', selector: '#a', text: 'x', zoom: true },
          { do: 'hover', selector: '#a', zoom: false },
          { do: 'press', key: 'Escape', zoom: false },
          { do: 'paste', text: 'hi', zoom: true },
          { do: 'click', selector: '#a', zoom: true },
        ],
      }),
    ).toEqual([])
  })

  it('refuses another value, and a mark on a step that shows nothing', () => {
    expect(one({ do: 'click', selector: '#a', zoom: 'yes' })).toEqual([
      'steps[0]: zoom must be true or false',
    ])
    expect(one({ do: 'wait', ms: 500, zoom: true })).toEqual([
      'steps[0]: zoom marks a gesture (click, drag, type, paste, press, hover); a wait shows nothing to zoom on',
    ])
  })
})

describe('guard', () => {
  it('takes "spend" on a click, a press or a type with an id', () => {
    expect(
      validateActions({
        steps: [
          { id: 'buy', do: 'click', selector: '#buy', guard: 'spend' },
          { id: 'send', do: 'press', key: 'Enter', guard: 'spend' },
          { id: 'pay', do: 'type', selector: '#c', text: '1', guard: 'spend' },
        ],
      }),
    ).toEqual([])
  })

  it('refuses another value, another verb, and a guarded step with no id', () => {
    expect(
      one({ id: 'x', do: 'click', selector: '#a', guard: 'costly' }),
    ).toEqual(['steps[0]: guard must be "spend"'])
    expect(
      one({ id: 'x', do: 'hover', selector: '#a', guard: 'spend' }),
    ).toEqual([
      'steps[0]: guard sits on a click, a press or a type, the steps that commit something; a hover spends nothing',
    ])
    expect(one({ do: 'click', selector: '#a', guard: 'spend' })).toEqual([
      'steps[0]: a guarded step needs an id, which is what --confirm <id> names',
    ])
  })

  it('runs only when every guarded step is confirmed, and names a typo', () => {
    const actions = {
      steps: [
        { do: 'wait' as const, ms: 100 },
        {
          id: 'generate',
          do: 'click' as const,
          selector: '#gen',
          guard: 'spend' as const,
        },
      ],
    }
    expect(guardedSteps(actions)).toEqual([
      { step: 1, id: 'generate', do: 'click', guard: 'spend' },
    ])
    expect(guardVerdict(actions, ['generate'])).toEqual({ ok: true })
    expect(guardVerdict({ steps: [{ do: 'wait', ms: 1 }] }, [])).toEqual({
      ok: true,
    })
    const refused = guardVerdict(actions, [])
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.unconfirmed).toEqual(['generate'])
    expect(refused.message).toContain('#1 generate (click) is guarded (spend)')
    expect(refused.message).toContain('Add --confirm generate')
    expect(refused.message).toMatch(/Nothing was recorded\.$/)
    const typo = guardVerdict(actions, ['generate', 'genrate'])
    expect(typo.ok).toBe(false)
    if (typo.ok) return
    expect(typo.unknown).toEqual(['genrate'])
    expect(typo.message).toContain(
      '--confirm genrate names no guarded step (the guarded ones: generate)',
    )
  })
})

describe('expect', () => {
  it('takes exactly one of selector, text, gone or js', () => {
    expect(
      validateActions({
        steps: [
          { do: 'expect', selector: '#go' },
          { do: 'expect', selector: '#go', enabled: true, timeout: 2.5 },
          { do: 'expect', text: 'Saved' },
          { do: 'expect', gone: '.spinner' },
        ],
      }),
    ).toEqual([])
    expect(one({ do: 'expect' })).toEqual([
      'steps[0]: expect needs exactly one of selector, text, gone or js',
    ])
    expect(one({ do: 'expect', selector: '#a', text: 'b' })).toEqual([
      'steps[0]: expect needs exactly one of selector, text, gone or js (it has selector and text)',
    ])
    expect(one({ do: 'expect', text: '  ' })).toEqual([
      'steps[0]: expect text must be a non-empty string',
    ])
  })

  it('reads enabled only with a selector, and a timeout in seconds', () => {
    expect(one({ do: 'expect', text: 'x', enabled: true })).toEqual([
      "steps[0]: expect enabled is about the selector's element, so it needs a selector",
    ])
    expect(one({ do: 'expect', selector: '#a', enabled: 'yes' })).toEqual([
      'steps[0]: expect enabled must be true or false',
    ])
    expect(one({ do: 'expect', selector: '#a', timeout: 0 })).toEqual([
      'steps[0]: expect timeout must be a number of seconds above 0',
    ])
  })

  it('says what it waited for and why it missed', () => {
    expect(sayCondition({ selector: '#a' })).toBe("'#a' to appear")
    expect(sayCondition({ selector: '#a', enabled: true })).toBe(
      "'#a' to be enabled",
    )
    expect(sayCondition({ text: 'Done' })).toBe('text "Done" to show')
    expect(
      conditionMiss(
        { selector: 'text=Generate video', enabled: true },
        { holds: false, visible: true },
        5000,
      ),
    ).toBe("'text=Generate video' stayed disabled for 5 s")
    expect(
      conditionMiss({ selector: '#a' }, { holds: false, visible: false }, 5000),
    ).toBe("'#a' never appeared in 5 s")
    expect(conditionMiss({ gone: '#s' }, { holds: false }, 2500)).toBe(
      "'#s' was still there after 2.5 s",
    )
    expect(sayDuration(200_000)).toBe('3 min 20 s')
  })
})

describe('a js check', () => {
  it('takes js in an expect and in an await, with equals beside it', () => {
    expect(
      validateActions({
        steps: [
          { do: 'expect', js: 'window.app.count() === 14' },
          { do: 'expect', js: 'window.app.count()', equals: 14, timeout: 2 },
          {
            do: 'expect',
            js: 'window.app.selection()',
            equals: { ids: ['a', 'b'], tool: 'select' },
          },
          { do: 'await', until: { js: 'window.app.ready' } },
          { do: 'await', until: { js: 'window.app.count()', equals: 3 } },
        ],
      }),
    ).toEqual([])
  })

  it('refuses equals with no js, a value JSON cannot say, and an empty expression', () => {
    expect(one({ do: 'expect', selector: '#a', equals: 3 })).toEqual([
      'steps[0]: expect equals is the value a js expression must answer, so it needs js',
    ])
    expect(one({ do: 'expect', js: 'x', equals: { n: Number.NaN } })).toEqual([
      'steps[0]: expect equals must be a JSON value (a number, a string, true, false, null, a list or an object of them)',
    ])
    expect(one({ do: 'expect', js: ' ' })).toEqual([
      'steps[0]: expect js must be a non-empty string',
    ])
    expect(one({ do: 'expect', js: 'a', text: 'b' })).toEqual([
      'steps[0]: expect needs exactly one of selector, text, gone or js (it has text and js)',
    ])
    expect(one({ do: 'await', until: { text: 'x', equals: 1 } })).toEqual([
      'steps[0]: await until equals is the value a js expression must answer, so it needs js',
    ])
  })

  it('says what it waited for, and the value it got when it missed', () => {
    expect(sayCondition({ js: 'window.app.count()', equals: 14 })).toBe(
      'js `window.app.count()` to equal 14',
    )
    expect(sayCondition({ js: 'window.app.ready' })).toBe(
      'js `window.app.ready` to hold',
    )
    expect(
      conditionMiss(
        { js: 'window.app.count()', equals: 14 },
        { holds: false, value: 15, said: '15' },
        5000,
      ),
    ).toBe('js `window.app.count()` was 15, not 14, for 5 s')
    expect(
      conditionMiss(
        { js: 'window.app.count() === 14' },
        { holds: false, value: false, said: 'false' },
        1000,
      ),
    ).toBe('js `window.app.count() === 14` was false for 1 s')
    expect(
      conditionMiss(
        { js: 'window.app.count()' },
        {
          holds: false,
          threw: "Cannot read properties of undefined (reading 'count')",
        },
        5000,
      ),
    ).toBe(
      "js `window.app.count()` threw for 5 s (Cannot read properties of undefined (reading 'count'))",
    )
  })

  it('compares as JSON, whatever the key order', () => {
    expect(
      sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }),
    ).toBe(true)
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameJson([1, 2], [2, 1])).toBe(false)
    expect(sameJson(null, {})).toBe(false)
  })

  it('keeps a value on the step while it fits, its JSON cut short when it does not', () => {
    expect(keptValue({ shapes: 3 })).toEqual({ shapes: 3 })
    expect(keptValue(undefined)).toBeUndefined()
    const long = keptValue('x'.repeat(5000))
    expect(typeof long).toBe('string')
    expect((long as string).length).toBe(2048)
  })

  it('is refused on a hosted take, in an expect and in an await', () => {
    expect(
      hostedRefusals({
        steps: [
          { do: 'expect', js: 'window.app.count() === 1' },
          { do: 'await', until: { js: 'window.app.ready' } },
          { do: 'expect', text: 'Saved' },
        ],
      }),
    ).toEqual([
      'steps[0] checks a js expression, which runs as code in the page, and a hosted browser runs no script it was handed: record it on this machine, or check what the page shows (selector, text or gone)',
      'steps[1] waits on a js expression, which runs as code in the page, and a hosted browser runs no script it was handed: record it on this machine, or check what the page shows (selector, text or gone)',
    ])
  })
})

describe('await', () => {
  it('takes until with exactly one condition, and its timings', () => {
    expect(
      validateActions({
        steps: [
          {
            id: 'render',
            do: 'await',
            until: { selector: '#result' },
            timeout: 900,
            poll: 5,
            reload: true,
            onTimeout: 'continue',
          },
          { do: 'await', until: { text: 'Ready' } },
          { do: 'await', until: { gone: '.spinner' } },
        ],
      }),
    ).toEqual([])
    expect(one({ do: 'await' })).toEqual([
      'steps[0]: await needs until, one of { "selector" }, { "text" }, { "gone" } or { "js" }',
    ])
    expect(one({ do: 'await', until: {} })).toEqual([
      'steps[0]: await until needs exactly one of selector, text, gone or js',
    ])
    expect(one({ do: 'await', until: { selector: '#a', gone: '#b' } })).toEqual(
      [
        'steps[0]: await until needs exactly one of selector, text, gone or js (it has selector and gone)',
      ],
    )
    expect(one({ do: 'await', until: { element: '#a' } })).toEqual([
      'steps[0]: await until takes selector, text, gone or js (with equals), not element',
      'steps[0]: await until needs exactly one of selector, text, gone or js',
    ])
  })

  it('refuses a bad timeout, poll, reload or onTimeout', () => {
    expect(
      one({
        do: 'await',
        until: { text: 'x' },
        timeout: -1,
        poll: 'often',
        reload: 1,
        onTimeout: 'retry',
      }),
    ).toEqual([
      'steps[0]: await timeout must be a number of seconds above 0',
      'steps[0]: await poll must be a number of seconds above 0',
      'steps[0]: await reload must be true or false',
      'steps[0]: await onTimeout must be "fail" or "continue"',
    ])
  })

  it('makes every cut a segment boundary in a fresh plan', () => {
    expect(splitSegmentsAtSkips([{ in: 0, out: 10 }], [])).toEqual([
      { in: 0, out: 10 },
    ])
    expect(
      splitSegmentsAtSkips([{ in: 0, out: 10 }], [{ at: 6 }, { at: 2.5 }]),
    ).toEqual([
      { in: 0, out: 2.5 },
      { in: 2.5, out: 6 },
      { in: 6, out: 10 },
    ])
    // A cut at an edge or past the footage splits nothing.
    expect(
      splitSegmentsAtSkips(
        [{ in: 0, out: 10 }],
        [{ at: 0 }, { at: 10 }, { at: 12 }],
      ),
    ).toEqual([{ in: 0, out: 10 }])
    // A split clip keeps its arrival first and its leaving last.
    expect(
      splitSegmentsAtSkips(
        [
          {
            in: 0,
            out: 10,
            anim: { enter: 'fade', exit: 'slide' },
          },
        ],
        [{ at: 4 }],
      ),
    ).toEqual([
      { in: 0, out: 4, anim: { enter: 'fade' } },
      { in: 4, out: 10, anim: { exit: 'slide' } },
    ])
  })
})

describe('download', () => {
  it('takes exactly one of selector or src, and a plain name', () => {
    expect(
      validateActions({
        steps: [
          { do: 'download', selector: 'text=Export', as: 'report.csv' },
          { do: 'download', src: 'video' },
        ],
      }),
    ).toEqual([])
    expect(one({ do: 'download' })).toEqual([
      'steps[0]: download needs exactly one of selector (a control that downloads) or src (a video, audio or img element whose source is fetched)',
    ])
    expect(one({ do: 'download', src: 'video', as: '../x.mp4' })).toEqual([
      'steps[0]: download as "../x.mp4" must be a plain file name, with no path separator',
    ])
    expect(one({ do: 'download', src: 'video', as: 'a..b' })).toEqual([
      'steps[0]: download as "a..b" must be a plain file name, with no ".."',
    ])
    expect(one({ do: 'download', src: 'video', as: 7 })).toEqual([
      'steps[0]: download as is not a string',
    ])
  })

  it('refuses every name that is not plain', () => {
    expect(fileNameProblem('clip.mp4')).toBeNull()
    expect(fileNameProblem('a/b.mp4')).toContain('path separator')
    expect(fileNameProblem('a\\b.mp4')).toContain('path separator')
    expect(fileNameProblem('..')).toContain('".."')
    expect(fileNameProblem('.env')).toContain('hidden')
    expect(fileNameProblem('a\nb')).toContain('control characters')
    expect(fileNameProblem('')).toBe('must be a file name')
  })

  it('names a file from the step, else the page, made plain and unique', () => {
    expect(plainName('report.csv', 'x')).toBe('report.csv')
    expect(plainName('../../etc/passwd', 'x')).toBe('passwd')
    expect(plainName('..', 'download-3')).toBe('download-3')
    expect(plainName('.hidden', 'x')).toBe('hidden')
    expect(nameFromUrl('https://cdn.test/v/My%20Clip.mp4?sig=abc')).toBe(
      'My Clip.mp4',
    )
    expect(nameFromUrl('blob:https://app.test/1234')).toBe('')
    const used = new Set(['clip.mp4', 'clip-2.mp4'])
    expect(outputName(undefined, 'clip.mp4', 'x', used)).toBe('clip-3.mp4')
    expect(outputName('mine.mp4', 'clip.mp4', 'x', used)).toBe('mine.mp4')
    expect(outputName(undefined, '', 'download-1.webm', new Set())).toBe(
      'download-1.webm',
    )
  })

  it('reads a byte stream whole, and refuses one past its ceiling', async () => {
    async function* chunks() {
      yield new Uint8Array([1, 2])
      yield 'ab'
      yield new Uint8Array([3]).buffer
    }
    expect([...(await readAllBytes(chunks()))]).toEqual([1, 2, 97, 98, 3])
    await expect(readAllBytes(chunks(), 3)).rejects.toThrow(/larger than/)
  })
})

describe('a hosted recorder', () => {
  it('refuses a guarded step and a download, in words', () => {
    expect(hostedRefusals({ steps: [{ do: 'wait', ms: 1 }] })).toEqual([])
    expect(
      hostedRefusals({
        steps: [
          { id: 'buy', do: 'click', selector: '#b', guard: 'spend' },
          { do: 'download', selector: '#dl' },
          { do: 'await', until: { text: 'Ready' } },
        ],
      }),
    ).toEqual([
      'steps[0] (buy) is guarded (spend), and a hosted take has no way to confirm it: record it on this machine with --confirm buy',
      "steps[1] is a download, which a hosted take does not keep: record it on this machine, where the file lands in the take's outputs/",
    ])
  })
})
