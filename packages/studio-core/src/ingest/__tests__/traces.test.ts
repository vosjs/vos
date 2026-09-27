import { describe, expect, it } from 'vitest'
import {
  CLICK_HOLD_MS,
  cursorFromCsv,
  cursorFromPlaywrightTrace,
  cursorFromRecords,
  cursorFromTrace,
  traceKindOf,
} from '../traces'

// The measured shape of a Playwright 1.58 trace (version 8), cut down to the
// lines the adapter reads: the context's options, the page's creation (where
// the video starts), a selector click that landed on a point, a fill, a mouse
// move, a mouse click and a wheel. Times are monotonic ms.
const PW_LINES = [
  `{"version":8,"type":"context-options","origin":"library","browserName":"chromium","options":{"viewport":{"width":1280,"height":720}},"wallTime":1790451422831,"monotonicTime":1556.297}`,
  `{"type":"before","callId":"call@6","startTime":1556.991,"class":"BrowserContext","method":"newPage","params":{}}`,
  `{"type":"after","callId":"call@6","endTime":1585.969,"result":{"page":"<Page>"}}`,
  `{"type":"before","callId":"call@10","startTime":1587.574,"class":"Frame","method":"goto","params":{"url":"https://fixture.local/"}}`,
  `{"type":"after","callId":"call@10","endTime":1600.1}`,
  `{"type":"before","callId":"call@16","startTime":2397.017,"class":"Frame","method":"click","params":{"selector":"#a","timeout":30000}}`,
  `{"type":"input","callId":"call@16","point":{"x":260,"y":220}}`,
  `{"type":"after","callId":"call@16","endTime":2432.754,"point":{"x":260,"y":220}}`,
  `{"type":"before","callId":"call@20","startTime":3135.143,"class":"Frame","method":"fill","params":{"selector":"#q","value":"hello"}}`,
  `{"type":"input","callId":"call@20"}`,
  `{"type":"after","callId":"call@20","endTime":3160.2}`,
  `{"type":"before","callId":"call@24","startTime":3643.855,"class":"Page","method":"mouseMove","params":{"x":600,"y":400}}`,
  `{"type":"after","callId":"call@24","endTime":3646.61,"point":{"x":600,"y":400}}`,
  `{"type":"before","callId":"call@26","startTime":3647.234,"class":"Page","method":"mouseClick","params":{"x":860,"y":520}}`,
  `{"type":"after","callId":"call@26","endTime":3649.152,"point":{"x":860,"y":520}}`,
  `{"type":"before","callId":"call@30","startTime":4251.098,"class":"Page","method":"mouseWheel","params":{"deltaX":0,"deltaY":200}}`,
  `{"type":"after","callId":"call@30","endTime":4252.0}`,
]
const PW = PW_LINES.join('\n') + '\n'

describe('cursorFromPlaywrightTrace', () => {
  it('places every gesture on the video clock, from the page creation', () => {
    const r = cursorFromPlaywrightTrace(PW)
    expect(r.kind).toBe('playwright')
    expect(r.notes).toEqual([])
    expect(r.viewport).toEqual({ width: 1280, height: 720 })
    expect(r.placed).toBe(5)
    expect(r.dropped).toBe(0)
    // Zero is newPage (1556.991); the selector click moved at 840.026.
    const types = r.events.map((e) => `${e.type}@${e.t}`)
    expect(types[0]).toBe('move@840.026')
    const down = r.events.find((e) => e.type === 'down')!
    expect(down).toMatchObject({ x: 260, y: 220, button: 0 })
    // Pressed CLICK_HOLD_MS before the call ended, and never before the
    // call began: this call took 35.7 ms, so the press sits at its start.
    expect(down.t).toBe(840.026)
    const up = r.events.find((e) => e.type === 'up')!
    expect(up.t - down.t).toBeCloseTo(CLICK_HOLD_MS, 6)
    // The fill typed where the last press landed: a typing ping, no text.
    const key = r.events.find((e) => e.type === 'key')!
    expect(key).toMatchObject({ x: 260, y: 220 })
    expect(JSON.stringify(r.events)).not.toContain('hello')
    // mouse.move then mouse.click at their own points; the wheel where it sat.
    expect(
      r.events.filter((e) => e.type === 'move').map((e) => [e.x, e.y]),
    ).toEqual([
      [260, 220],
      [600, 400],
      [860, 520],
    ])
    const scroll = r.events.find((e) => e.type === 'scroll')!
    expect(scroll).toMatchObject({ x: 860, y: 520 })
    // Sorted by time.
    for (let i = 1; i < r.events.length; i++)
      expect(r.events[i].t).toBeGreaterThanOrEqual(r.events[i - 1].t)
    // t0 is the wall clock at the page's creation.
    expect(r.t0).toBe(Math.round(1790451422831 + (1556.991 - 1556.297)))
  })

  it('shifts every time by the offset and drops what falls before the video', () => {
    const r = cursorFromPlaywrightTrace(PW, { offsetMs: -1000 })
    expect(r.events.every((e) => e.t >= 0)).toBe(true)
    expect(r.notes.some((n) => /before the video/.test(n))).toBe(true)
  })

  it('names a press the trace never placed, and a wheel before any position', () => {
    const lines = [
      PW_LINES[1],
      `{"type":"before","callId":"c1","startTime":1700,"class":"Page","method":"mouseWheel","params":{"deltaY":10}}`,
      `{"type":"before","callId":"c2","startTime":1800,"class":"Frame","method":"click","params":{"selector":"#gone"}}`,
      `{"type":"after","callId":"c2","endTime":1900,"error":{"message":"timeout"}}`,
    ]
    const r = cursorFromPlaywrightTrace(lines.join('\n'))
    expect(r.events).toEqual([])
    expect(r.placed).toBe(0)
    expect(r.dropped).toBe(2)
    expect(r.notes[0]).toMatch(/mouseWheel .* before any pointer position/)
    expect(r.notes[1]).toMatch(/click #gone .* landed nowhere/)
  })

  it('says when the text is not a trace at all', () => {
    const r = cursorFromPlaywrightTrace('{"hello":1}\n')
    expect(r.events).toEqual([])
    expect(r.notes[0]).toMatch(/not a Playwright trace/)
  })
})

describe('cursorFromCsv', () => {
  it('reads t,x,y,type with or without a header, expanding click into a press', () => {
    const a = cursorFromCsv(
      't,x,y,type\n0,10,10,move\n500,100,80,click\n900,100,300,scroll\n',
    )
    const b = cursorFromCsv('0,10,10\n500,100,80,click\n900,100,300,scroll\n')
    expect(a.events).toEqual(b.events)
    expect(a.events.map((e) => e.type)).toEqual([
      'move',
      'move',
      'down',
      'up',
      'scroll',
    ])
    expect(a.events[3].t).toBe(500 + CLICK_HOLD_MS)
    expect(a.placed).toBe(3)
    expect(a.notes).toEqual([])
  })

  it('names a bad line instead of guessing', () => {
    const r = cursorFromCsv('t,x,y,type\n0,a,10,move\n10,1,1,fly\n')
    expect(r.events).toEqual([])
    expect(r.notes).toEqual([
      'line 2: t, x and y must be numbers',
      'line 3: unknown type "fly" (move, down, up, click, scroll)',
    ])
  })

  it('refuses a header without the three columns', () => {
    const r = cursorFromCsv('time,px,py\n1,2,3\n')
    expect(r.notes[0]).toMatch(/needs t, x and y/)
  })
})

describe('cursorFromRecords', () => {
  it('places records that carry a time and a point, reading epoch times relative to the first', () => {
    const r = cursorFromRecords([
      { ts: 1790451422831, command: ['open', 'https://x'] },
      {
        ts: 1790451423331,
        command: ['click', '@e27'],
        point: { x: 40, y: 50 },
        rect: { x: 20, y: 40, w: 40, h: 20 },
      },
      { ts: 1790451423900, type: 'scroll', x: 40, y: 50 },
    ])
    expect(r.placed).toBe(2)
    expect(r.notes).toEqual([])
    expect(r.events.map((e) => [e.type, e.t])).toEqual([
      ['move', 500],
      ['down', 500],
      ['up', 500 + CLICK_HOLD_MS],
      ['scroll', 1069],
    ])
    expect(r.events[1].rect).toEqual({ x: 20, y: 40, w: 40, h: 20 })
  })

  it('names agent-browser records that carry no time or no point, one line each', () => {
    const jsonl = [
      JSON.stringify({ command: ['snapshot', '-i'], result: { refs: {} } }),
      JSON.stringify({
        command: ['click', '@e27'],
        result: '@e27',
        success: true,
      }),
      JSON.stringify({ ts: 1000, command: ['click', '@e28'] }),
    ].join('\n')
    const r = cursorFromRecords(jsonl)
    expect(r.events).toEqual([])
    expect(r.dropped).toBe(2)
    expect(r.notes).toHaveLength(2)
    expect(r.notes[0]).toMatch(
      /carry no time .* agent-browser's own log has none/,
    )
    expect(r.notes[1]).toMatch(/carry no point/)
  })
})

describe('cursorFromTrace', () => {
  it('routes by name, and by the text when a .jsonl is a Playwright trace', () => {
    expect(traceKindOf('trace.zip')).toBe('zip')
    expect(traceKindOf('steps.jsonl')).toBe('jsonl')
    expect(traceKindOf('demo.webm')).toBeNull()
    expect(cursorFromTrace('trace.trace', PW).kind).toBe('playwright')
    expect(cursorFromTrace('walk.jsonl', PW).kind).toBe('playwright')
    expect(
      cursorFromTrace('walk.jsonl', '{"ts":1,"type":"move","x":1,"y":2}\n')
        .kind,
    ).toBe('records')
    expect(cursorFromTrace('cursor.csv', 't,x,y\n0,1,2\n').kind).toBe('csv')
  })
})
