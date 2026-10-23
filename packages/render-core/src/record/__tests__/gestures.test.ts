import { describe, expect, it } from 'vitest'
import { hostedRefusals, scriptFiles, validateActions } from '../actions'
import {
  chordProblem,
  modifierBits,
  overrunLine,
  overrunOf,
  pathDurationMs,
  pressSequence,
  readPath,
  resolveChord,
  schedulePath,
  splitChord,
} from '../gestures'
import { pasteTypeOf } from '../paste'
import { inlineScript, loadScriptFiles } from '../scriptFiles'
import { appSettled, settleOn } from '../settle'

/**
 * The canvas gestures, held where both hosts read them: a press takes
 * chords, plain keys and sequences; a drag holds modifiers and draws a
 * path (inline or from a file); a click counts and picks its button; a
 * paste takes words or a file; a gesture may wait on the app; and a paced
 * gesture that runs past its script is reported.
 */
const one = (step: Record<string, unknown>) =>
  validateActions({ steps: [step] })

describe('press takes chords, plain keys and sequences', () => {
  it('accepts a chord, a letter, a sequence and the old named key', () => {
    expect(
      validateActions({
        steps: [
          { do: 'press', keys: 'Shift+D' },
          { do: 'press', keys: 'Mod+Z' },
          { do: 'press', keys: 'Meta+Shift+z' },
          { do: 'press', keys: 'r' },
          { do: 'press', keys: ['v', 'Escape'] },
          { do: 'press', keys: 'Shift++' },
          { do: 'press', keys: 'F5' },
          { do: 'press', keys: 'Control+KeyA' },
          { do: 'press', key: 'Escape' },
        ],
      }),
    ).toEqual([])
  })

  it('refuses an unknown modifier, a dangling chord, an unknown key and both forms', () => {
    expect(one({ do: 'press', keys: 'Hyper+D' })).toEqual([
      'steps[0]: press keys "Hyper+D": "Hyper" is not a modifier (one of Shift, Control, Alt, Meta, Mod, ControlOrMeta)',
    ])
    expect(one({ do: 'press', keys: 'Shift+' })).toEqual([
      'steps[0]: press keys "Shift+" ends without a key',
    ])
    expect(one({ do: 'press', keys: ['v', 'Escapee'] })[0]).toMatch(
      /^steps\[0\]: press keys\[1\] "Escapee": "Escapee" is not a key/,
    )
    expect(one({ do: 'press', keys: [] })).toEqual([
      'steps[0]: press keys must name at least one key',
    ])
    expect(one({ do: 'press', key: 'Enter', keys: 'r' })[0]).toMatch(
      /takes key or keys, not both/,
    )
    // The old form stays as strict as it was: a character is not a key.
    expect(one({ do: 'press', key: 'r' })[0]).toMatch(/press needs a key/)
  })

  it('resolves Mod for the browser and splits a chord', () => {
    expect(resolveChord('Mod+Z')).toBe('ControlOrMeta+Z')
    expect(resolveChord('Shift+D')).toBe('Shift+D')
    expect(splitChord('Shift++')).toEqual({ mods: ['Shift'], key: '+' })
    expect(chordProblem('Shift')).toBeNull()
    expect(chordProblem('Shift+Alt')).toBe(
      '"Shift+Alt" ends on a modifier, not a key',
    )
    expect(pressSequence({ keys: ['v', 'Escape'] })).toEqual(['v', 'Escape'])
    expect(pressSequence({ key: 'Enter' })).toEqual(['Enter'])
  })
})

describe('click counts and picks its button', () => {
  it('accepts a double, a triple and the right or middle button', () => {
    expect(
      validateActions({
        steps: [
          { do: 'click', selector: '#a', count: 2 },
          { do: 'click', selector: '#a', count: 3, button: 'left' },
          { do: 'click', selector: '#a', button: 'right' },
          { do: 'click', selector: '#a', button: 'middle' },
        ],
      }),
    ).toEqual([])
  })

  it('refuses another count or button', () => {
    expect(one({ do: 'click', selector: '#a', count: 4 })).toEqual([
      'steps[0]: click count must be 1, 2 (a double click) or 3 (a triple click)',
    ])
    expect(one({ do: 'click', selector: '#a', button: 'back' })).toEqual([
      'steps[0]: click button must be "left", "right" or "middle"',
    ])
  })
})

describe('drag holds modifiers and draws a path', () => {
  it('accepts modifiers, an inline path of tuples or objects, and a path file', () => {
    expect(
      validateActions({
        steps: [
          {
            do: 'drag',
            selector: '.box',
            tx: 300,
            ty: 200,
            modifiers: ['Alt', 'Shift'],
          },
          {
            do: 'drag',
            path: [
              [10, 10],
              [20, 20],
              [30, 25],
            ],
            ms: 400,
          },
          {
            do: 'drag',
            path: [
              [10, 10, 0],
              [20, 20, 16, 0.4],
            ],
          },
          {
            do: 'drag',
            path: [
              { x: 1, y: 2 },
              { x: 3, y: 4, pressure: 0.2 },
            ],
          },
          { do: 'drag', path: 'loop.json', modifiers: ['Mod'] },
        ],
      }),
    ).toEqual([])
  })

  it('refuses a path beside a start or an end, a bad point, mixed timing, a path outside its directory, a bad modifier', () => {
    expect(
      one({
        do: 'drag',
        selector: '#a',
        tx: 1,
        ty: 1,
        path: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toEqual([
      'steps[0]: a drag with a path starts at its first point and ends at its last, so it takes no selector, tx, ty',
    ])
    expect(one({ do: 'drag', path: [[0, 0]] })).toEqual([
      'steps[0]: drag path needs at least two points',
    ])
    expect(
      one({
        do: 'drag',
        path: [
          [0, 0],
          ['a', 1],
        ],
      }),
    ).toEqual(['steps[0]: drag path point 1 x and y must be numbers (CSS px)'])
    expect(
      one({
        do: 'drag',
        path: [
          [0, 0, 0],
          [1, 1],
        ],
      })[0],
    ).toMatch(/every point carries a time or none does/)
    expect(
      one({
        do: 'drag',
        path: [
          [0, 0, 50],
          [1, 1, 10],
        ],
      }),
    ).toEqual([
      "steps[0]: drag path point 1's time runs backwards (times never decrease)",
    ])
    expect(
      one({
        do: 'drag',
        path: [
          [0, 0, 0, 2],
          [1, 1, 5],
        ],
      }),
    ).toEqual(['steps[0]: drag path point 0 pressure must be from 0 to 1'])
    expect(one({ do: 'drag', path: '../loop.json' })[0]).toMatch(
      /drag path "\.\.\/loop\.json" must be a plain file name/,
    )
    expect(
      one({ do: 'drag', x: 1, y: 1, tx: 2, ty: 2, modifiers: ['Hyper'] })[0],
    ).toMatch(
      /drag modifiers must be a list of "Alt", "Shift", "Meta", "Control", "Mod"/,
    )
    expect(
      one({ do: 'drag', x: 1, y: 1, tx: 2, ty: 2, modifiers: ['Alt', 'Alt'] }),
    ).toEqual(['steps[0]: drag modifiers names a modifier twice'])
    // The straight drag keeps its rule.
    expect(one({ do: 'drag', x: 1, y: 1 })).toEqual([
      'steps[0]: drag needs tx and ty (CSS px), or a path',
    ])
  })

  it('schedules a timed path by its times and an untimed one evenly over ms', () => {
    const timed = readPath([
      [0, 0, 100],
      [5, 5, 140],
      [9, 9, 300],
    ])
    if ('problems' in timed) throw new Error('bad path')
    expect(schedulePath(timed, 999).map((p) => p.at)).toEqual([0, 40, 200])
    const even = readPath({
      points: [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ],
    })
    if ('problems' in even) throw new Error('bad path')
    const s = schedulePath(even, 400)
    expect(s.map((p) => p.at)).toEqual([0, 100, 200, 300, 400])
    expect(pathDurationMs(s)).toBe(400)
    expect(pathDurationMs(schedulePath(even, undefined))).toBe(700)
  })

  it('reads Mod as Meta on a Mac and Control elsewhere for a pen stroke', () => {
    expect(modifierBits(['Mod', 'Shift'], 'mac')).toBe(4 | 8)
    expect(modifierBits(['Mod'], 'linux')).toBe(2)
    expect(modifierBits(['Alt'], undefined)).toBe(1)
  })
})

describe('paste', () => {
  it('takes words or a file of a type a paste carries, into a selector or the focus', () => {
    expect(
      validateActions({
        steps: [
          { do: 'paste', text: 'hello' },
          { do: 'paste', file: 'logo.svg', selector: '.canvas' },
          { do: 'paste', file: 'shot.png' },
        ],
      }),
    ).toEqual([])
    expect(pasteTypeOf('a.SVG')).toBe('image/svg+xml')
    expect(pasteTypeOf('a.exe')).toBeNull()
  })

  it('refuses both, neither, an unknown type and a path', () => {
    expect(one({ do: 'paste' })[0]).toMatch(/exactly one of text .* or file/)
    expect(one({ do: 'paste', text: 'a', file: 'b.png' })[0]).toMatch(
      /exactly one/,
    )
    expect(one({ do: 'paste', file: 'run.exe' })[0]).toMatch(
      /"run.exe" is not a type a paste takes/,
    )
    expect(one({ do: 'paste', file: 'img/a.png' })[0]).toMatch(
      /must be a plain file name/,
    )
  })

  it('names the files a script reads beside itself', () => {
    expect(
      scriptFiles({
        steps: [
          { do: 'paste', file: 'a.png' },
          { do: 'drag', path: 'p.json' },
          {
            do: 'drag',
            path: [
              [0, 0],
              [1, 1],
            ],
          },
        ],
      }),
    ).toEqual([
      { step: 0, name: 'a.png', as: 'paste' },
      { step: 1, name: 'p.json', as: 'path' },
    ])
  })

  it('reads them before the take, and refuses one it cannot read or parse', async () => {
    const files = {
      'loop.json': '[[1,2,0],[3,4,20]]',
      'bad.json': '{nope',
      'short.json': '[[1,2]]',
      'a.png': '\u0089PNG',
    } as Record<string, string>
    const source = {
      read: async (name: string) => {
        if (!(name in files)) throw new Error('ENOENT')
        return new TextEncoder().encode(files[name])
      },
    }
    const ok = await loadScriptFiles(
      {
        steps: [
          { do: 'drag', path: 'loop.json' },
          { do: 'paste', file: 'a.png' },
        ],
      },
      source,
    )
    if ('problem' in ok) throw new Error(ok.problem)
    expect(ok.paths.get(0)?.points.map((p) => [p.x, p.y, p.at])).toEqual([
      [1, 2, 0],
      [3, 4, 20],
    ])
    expect(ok.pastes.get(1)?.type).toBe('image/png')
    const missing = await loadScriptFiles(
      { steps: [{ do: 'drag', path: 'gone.json' }] },
      source,
    )
    expect('problem' in missing && missing.problem).toMatch(
      /steps\[0\] names "gone.json", which could not be read beside the actions file/,
    )
    const bad = await loadScriptFiles(
      { steps: [{ do: 'drag', path: 'bad.json' }] },
      source,
    )
    expect('problem' in bad && bad.problem).toMatch(/is not JSON/)
    const short = await loadScriptFiles(
      { steps: [{ do: 'drag', path: 'short.json' }] },
      source,
    )
    expect('problem' in short && short.problem).toMatch(
      /needs at least two points/,
    )
    const noSource = await loadScriptFiles(
      { steps: [{ do: 'drag', path: 'loop.json' }] },
      undefined,
    )
    expect('problem' in noSource && noSource.problem).toMatch(
      /no actions directory to read it from: write the points inline as path/,
    )
  })
})

describe('a hosted recorder', () => {
  it('refuses a paste and a path read from a file, and runs an inline path', () => {
    expect(
      hostedRefusals({
        steps: [
          { do: 'paste', text: 'x' },
          { do: 'drag', path: 'loop.json' },
          {
            do: 'drag',
            path: [
              [0, 0],
              [5, 5],
            ],
          },
        ],
      }),
    ).toEqual([
      'steps[0] is a paste, and a hosted browser has no clipboard to paste from: record it on this machine',
      'steps[1] draws a path from the file "loop.json", and a hosted take carries the script alone: write the points inline as path',
    ])
  })
})

describe('settle', () => {
  it('is a gesture’s, by step or by the script, and validated as such', () => {
    expect(settleOn({ do: 'drag' }, true)).toBe(true)
    expect(settleOn({ do: 'drag', settle: false }, true)).toBe(false)
    expect(settleOn({ do: 'click', settle: true }, undefined)).toBe(true)
    expect(settleOn({ do: 'wait' }, true)).toBe(false)
    expect(
      validateActions({
        settle: true,
        steps: [{ do: 'click', selector: '#a', settle: false }],
      }),
    ).toEqual([])
    expect(
      validateActions({ settle: 'yes', steps: [{ do: 'wait', ms: 1 }] }),
    ).toEqual(['settle must be true or false'])
    expect(one({ do: 'wait', ms: 1, settle: true })[0]).toMatch(
      /settle follows a gesture/,
    )
  })

  it('waits until neither the DOM nor the frames have changed for the quiet, at most the cap', async () => {
    let t = 0
    let dom = 0
    let frames = 0
    const page = { evaluate: async <T>() => dom as T }
    // The DOM changes until 400 ms, a frame lands at 700 ms.
    const sleep = async (ms: number) => {
      t += ms
      if (t <= 400) dom++
      if (t === 700) frames++
    }
    const res = await appSettled(page, () => frames, {
      sleep,
      now: () => t,
      quietMs: 300,
    })
    expect(res.settled).toBe(true)
    expect(res.ms).toBe(1000)
    t = 0
    const never = await appSettled(
      { evaluate: async <T>() => t as T },
      () => 0,
      { sleep: async (ms) => void (t += ms), now: () => t, capMs: 600 },
    )
    expect(never).toEqual({ settled: false, ms: 600 })
  })
})

describe('the overrun report', () => {
  it('reports a paced gesture more than a fifth past its plan, and says it in one line', () => {
    expect(overrunOf(1000, 1150)).toBeNull()
    expect(overrunOf(1000, 2100)).toBe(1100)
    expect(overrunOf(50, 500)).toBeNull()
    expect(overrunLine([])).toBeNull()
    expect(
      overrunLine([
        { step: 2, do: 'drag', plannedMs: 1000, tookMs: 2000, overrunMs: 1000 },
        {
          step: 5,
          id: 'loop',
          do: 'drag',
          plannedMs: 1000,
          tookMs: 2200,
          overrunMs: 1200,
        },
      ]),
    ).toBe(
      '2 steps ran 2.1× slower than scripted (#2 drag, #5 (loop) drag): the page could not keep up; add settle or raise ms',
    )
  })
})

describe('the script a take keeps', () => {
  it('writes a path a file held inline, with its times and pressure, and leaves the rest alone', async () => {
    const source = {
      read: async (name: string) =>
        new TextEncoder().encode(
          name === 'timed.json'
            ? '[[5,5,100],[9,9,160,0.5]]'
            : '[{"x":1,"y":1},{"x":2,"y":2,"pressure":0.3}]',
        ),
    }
    const actions = {
      steps: [
        { do: 'drag' as const, path: 'timed.json' },
        { do: 'drag' as const, path: 'even.json', ms: 300 },
        { do: 'paste' as const, text: 'hi' },
      ],
    }
    const files = await loadScriptFiles(actions, source)
    if ('problem' in files) throw new Error(files.problem)
    const kept = inlineScript(actions, files)
    expect(kept.steps).toEqual([
      {
        do: 'drag',
        path: [
          [5, 5, 0],
          [9, 9, 60, 0.5],
        ],
      },
      {
        do: 'drag',
        path: [[1, 1], { x: 2, y: 2, pressure: 0.3 }],
        ms: 300,
      },
      { do: 'paste', text: 'hi' },
    ])
    expect(validateActions(kept)).toEqual([])
    expect(hostedRefusals(kept)).toEqual([
      'steps[2] is a paste, and a hosted browser has no clipboard to paste from: record it on this machine',
    ])
  })
})
