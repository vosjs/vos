import { describe, expect, it } from 'vitest'
import { formatShotList, sayId, sayTarget, shotList } from '../shotList'
import type { ActionsFile } from '../actions'

describe('sayTarget', () => {
  it('says the words a selector names, and the selector when it names none', () => {
    expect(sayTarget('text=Collections')).toBe('"Collections"')
    expect(sayTarget("button:has-text('Show late only')")).toBe(
      '"Show late only"',
    )
    expect(sayTarget("[aria-label='Compare v2']")).toBe('"Compare v2"')
    expect(sayTarget('[placeholder="Search"]')).toBe('the "Search" field')
    expect(sayTarget('#filter-late')).toBe('`#filter-late`')
  })
})

describe('sayId', () => {
  it('reads an id as a name when it is one', () => {
    expect(sayId('new-order')).toBe('new order')
    expect(sayId('openBilling')).toBe('open billing')
    expect(sayId('late')).toBe('late')
    expect(sayId('s3')).toBeNull()
    expect(sayId('12')).toBeNull()
    expect(sayId(undefined)).toBeNull()
  })
})

describe('shotList', () => {
  const actions: ActionsFile = {
    url: 'http://localhost:4101/dashboard',
    viewport: { width: 1280, height: 720 },
    setup: [{ do: 'goto', url: 'http://localhost:4101/login' }],
    steps: [
      { do: 'wait', ms: 800 },
      {
        id: 'late',
        do: 'click',
        selector: "button:has-text('Show late only')",
      },
      { do: 'wait', ms: 1500 },
      { do: 'hover', selector: '.card:last-child', ms: 900 },
      { id: 'new-order', do: 'click', selector: '#new-order' },
      { do: 'type', selector: '#customer', text: 'Juniper Roasters' },
      { do: 'click', selector: '#save-order', caption: 'The new row' },
      { do: 'wait', ms: 2000 },
    ],
  }

  it('turns the script into numbered beats with the holds the script asked for', () => {
    const list = shotList(actions)
    expect(list.beats.map((b) => b.line)).toEqual([
      'Click "Show late only"',
      'Rest the pointer on `.card:last-child`',
      'Click new order (`#new-order`)',
      'Type "Juniper Roasters" into `#customer`',
      'The new row: Click `#save-order`',
    ])
    // a wait after a beat is that beat's hold; a leading wait is nobody's
    expect(list.beats[0].holdS).toBe(1.5)
    expect(list.beats[1].holdS).toBe(0.9)
    expect(list.beats[4].holdS).toBe(2)
    expect(list.setup).toBe(1)
    expect(list.aboutS).toBeGreaterThan(5)
  })

  it('says a press and a replacing type in words', () => {
    const list = shotList({
      url: 'http://localhost:4101/',
      steps: [
        { do: 'type', selector: '#q', text: 'juniper', replace: true },
        { do: 'press', key: 'Enter' },
        { do: 'press', key: 'Escape', selector: '[role=dialog]' },
        { do: 'type', selector: '.cm-line', text: ';', at: 'end' },
      ],
    })
    expect(list.beats.map((b) => b.line)).toEqual([
      'Replace what is in `#q` with "juniper"',
      'Press Enter',
      'Press Escape in `[role=dialog]`',
      'Type ";" into `.cm-line`, at the end',
    ])
  })

  it('says checks, off-camera waits and downloads, and marks a step that spends', () => {
    const list = shotList({
      steps: [
        { do: 'expect', selector: 'text=Generate video', enabled: true },
        {
          id: 'generate',
          do: 'click',
          selector: 'text=Generate video',
          guard: 'spend',
        },
        { do: 'await', until: { text: 'Your video is ready' } },
        { do: 'expect', gone: '.spinner' },
        { do: 'download', selector: 'text=Download', as: 'demo.mp4' },
        { do: 'download', src: 'video' },
      ],
    })
    expect(list.beats.map((b) => b.line)).toEqual([
      'Check that "Generate video" is enabled',
      'Click "Generate video" (this spends something real: do it only if you mean to)',
      'Wait until "Your video is ready" shows on the page (off camera: pause the recording meanwhile)',
      'Check that `.spinner` is gone',
      'Download the file "Download" gives, as demo.mp4',
      'Download what `video` plays',
    ])
  })

  it('reads as instructions to a person', () => {
    const text = formatShotList(shotList(actions))
    expect(text).toContain(
      'Record this with the vosso extension in your own signed-in browser',
    )
    expect(text).toContain(
      'Start on http://localhost:4101/dashboard, signed in',
    )
    expect(text).toContain(
      '1 setup step (sign in, dismiss banners) are yours to do first',
    )
    expect(text).toContain('1. Click "Show late only". Hold 1.5 s.')
    expect(text).toContain('5. The new row: Click `#save-order`. Hold 2 s.')
    expect(text).toContain('Press the icon again to stop')
    // no selector syntax leaks where the script gave words
    expect(text).not.toContain('has-text')
  })
})

describe('the canvas gestures in words', () => {
  it('says chords, sequences, held modifiers, drawn strokes, multi-clicks and pastes', () => {
    const list = shotList({
      steps: [
        { do: 'press', keys: 'Mod+Z' },
        { do: 'press', keys: ['v', 'Escape'] },
        { do: 'press', keys: 'Shift+D' },
        { do: 'drag', selector: '#box', tx: 300, ty: 200, modifiers: ['Alt'] },
        { do: 'drag', path: 'loop.json' },
        {
          do: 'drag',
          path: [
            [0, 0],
            [5, 5],
            [9, 9],
          ],
          modifiers: ['Shift'],
        },
        { do: 'click', selector: 'text=Title', count: 2 },
        { do: 'click', selector: 'text=Layer', button: 'right' },
        { do: 'paste', text: 'hello', selector: '[placeholder="Name"]' },
        { do: 'paste', file: 'logo.svg' },
      ],
    })
    expect(list.beats.map((b) => b.line)).toEqual([
      'Press ⌘/Ctrl+Z',
      'Press v then Escape',
      'Press Shift+D',
      'Hold Alt/Option and drag `#box` across',
      'Draw the stroke in loop.json, in one press',
      'Hold Shift and draw the stroke of 3 points, in one press',
      'Double-click "Title"',
      'Click "Layer" with the right button',
      'Copy "hello", then paste it into the "Name" field (⌘/Ctrl+V)',
      'Copy the file logo.svg, then paste it (⌘/Ctrl+V)',
    ])
  })
})
