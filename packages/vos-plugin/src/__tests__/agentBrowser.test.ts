import { describe, expect, it } from 'vitest'
import {
  convertAgentBrowser,
  parseAgentBrowserLog,
  splitCommand,
} from '../agentBrowser'
import { validateActions } from '../actions'

// The record shapes are agent-browser 0.36's, as measured: a single
// command's --json is {success,data,error}, a batch record is
// {command,result,success,error}; the lifecycle object every result carries
// is elided (the converter never reads it).
const snapshot = {
  command: ['snapshot', '-i', '-u'],
  data: {
    origin: 'https://vos.so/',
    refs: {
      e23: { name: 'vosso home', role: 'link' },
      e24: { name: 'Make', role: 'button' },
      e27: { name: 'Docs', role: 'link' },
      e30: { role: 'textbox', name: 'Search' },
    },
    snapshot:
      '- link "vosso home" [ref=e23, url=https://vos.so/]\n- button "Make" [expanded=false, ref=e24]\n- link "Docs" [ref=e27, url=https://vos.so/docs]\n- textbox "Search" [ref=e30]\n',
  },
  success: true,
  error: null,
}

const walk = [
  {
    command: ['open', 'https://vos.so'],
    data: { title: 'vosso', url: 'https://vos.so/' },
    success: true,
    error: null,
  },
  {
    command: ['set', 'viewport', '1440', '900'],
    data: { width: 1440, height: 900, deviceScaleFactor: 1 },
    success: true,
    error: null,
  },
  snapshot,
  {
    command: ['hover', '@e24'],
    data: { hovered: '@e24' },
    success: true,
    error: null,
  },
  {
    command: ['click', '@e27'],
    data: { clicked: '@e27' },
    success: true,
    error: null,
  },
  {
    command: ['get', 'url'],
    data: { url: 'https://vos.so/docs' },
    success: true,
    error: null,
  },
  {
    command: ['wait', '--load', 'networkidle'],
    data: { state: 'networkidle' },
    success: true,
    error: null,
  },
  {
    command: ['scroll', 'down', '500'],
    data: { scrolled: true },
    success: true,
    error: null,
  },
  {
    command: ['fill', '@e30', 'record'],
    data: { filled: '@e30' },
    success: true,
    error: null,
  },
  {
    command: ['keyboard', 'type', 'ing'],
    data: { typed: 'ing' },
    success: true,
    error: null,
  },
  {
    command: ['press', 'Enter'],
    data: { pressed: 'Enter' },
    success: true,
    error: null,
  },
  {
    command: ['mouse', 'move', '100', '100'],
    data: { moved: true },
    success: true,
    error: null,
  },
  {
    command: ['wait', '300'],
    data: { ms: 300, waited: 'timeout' },
    success: true,
    error: null,
  },
  { command: ['close'], data: { closed: true }, success: true, error: null },
]

describe('convertAgentBrowser', () => {
  it('turns a verified walk into steps the recorder replays', () => {
    const r = convertAgentBrowser(walk)
    expect(validateActions(r.actions)).toEqual([])
    expect(r.actions.url).toBe('https://vos.so')
    expect(r.actions.viewport).toEqual({ width: 1440, height: 900 })
    expect(r.actions.steps).toEqual([
      { do: 'hover', selector: 'role=button[name="Make"]', id: 'ab4' },
      {
        do: 'click',
        selector: 'a[href="/docs"], a[href="https://vos.so/docs"]',
        id: 'ab5',
      },
      { do: 'wait', ms: 500, id: 'ab7' },
      { do: 'scroll', dy: 500, id: 'ab8' },
      {
        do: 'type',
        selector: 'role=textbox[name="Search"]',
        text: 'record',
        id: 'ab9',
      },
      {
        do: 'type',
        selector: 'role=textbox[name="Search"]',
        text: 'ing',
        id: 'ab10',
      },
      {
        do: 'type',
        selector: 'role=textbox[name="Search"]',
        text: '\n',
        id: 'ab11',
      },
      { do: 'move', x: 100, y: 100, id: 'ab12' },
      { do: 'wait', ms: 300, id: 'ab13' },
    ])
    expect(r.steps).toBe(9)
    // open, set viewport, snapshot, get url, close: read and session verbs
    expect(r.ignored).toBe(5)
    expect(r.skipped).toBe(0)
    expect(r.notes).toEqual([
      'line 7: `wait --load networkidle` became 500 ms — the recorder waits for the page itself',
      'line 9: fill became type — the recorder types into the field as it is; an empty field reads the same, a prefilled one does not',
      'line 11: press Enter became a newline typed into the last field',
    ])
  })

  it('a ref used after the snapshot that named it is gone is skipped by name', () => {
    const r = convertAgentBrowser([
      { command: ['click', '@e27'], data: { clicked: '@e27' }, success: true },
    ])
    expect(r.actions.steps).toEqual([])
    expect(r.skipped).toBe(1)
    expect(r.notes[0]).toMatch(/@e27 is not in the last snapshot/)
  })

  it('a step that failed in the walk is not replayed, and the error rides the note', () => {
    const r = convertAgentBrowser([
      snapshot,
      {
        command: ['click', '@e999'],
        result: null,
        success: false,
        error: 'Unknown ref: e999',
      },
    ])
    expect(r.skipped).toBe(1)
    expect(r.notes[0]).toContain('Unknown ref: e999')
  })

  it('CSS targets pass through; find locators become Playwright selectors', () => {
    const r = convertAgentBrowser([
      {
        command: ['click', 'a[href="/docs"]'],
        data: { clicked: 'a[href="/docs"]' },
        success: true,
      },
      {
        command: ['find', 'text', 'Guides', 'click'],
        data: { clicked: "[data-agent-browser-located='true']" },
        success: true,
      },
      {
        command: ['find', 'role', 'button', 'click', '--name', 'Submit'],
        data: {},
        success: true,
      },
      {
        command: ['find', 'label', 'Email', 'fill', 'a@b.c'],
        data: {},
        success: true,
      },
      {
        command: ['find', 'placeholder', 'Search...', 'fill', 'query'],
        data: {},
        success: true,
      },
      {
        command: ['find', 'testid', 'login-form', 'click'],
        data: {},
        success: true,
      },
      {
        command: ['find', 'text', 'Sign In', 'click', '--exact'],
        data: {},
        success: true,
      },
      {
        command: ['find', 'nth', '2', '.card', 'hover'],
        data: {},
        success: true,
      },
      {
        command: ['find', 'role', 'heading', 'text', '--name', 'Welcome'],
        data: { text: 'Welcome' },
        success: true,
      },
    ])
    expect(
      r.actions.steps.map((s) => ('selector' in s ? s.selector : s.do)),
    ).toEqual([
      'a[href="/docs"]',
      'text=Guides',
      'role=button[name="Submit"]',
      'internal:label="Email"i',
      '[placeholder="Search..."]',
      '[data-testid="login-form"]',
      'text="Sign In"',
    ])
    expect(r.actions.steps[3]).toMatchObject({ do: 'type', text: 'a@b.c' })
    expect(r.skipped).toBe(1)
    expect(r.notes[0]).toMatch(/find nth is a position/)
    expect(r.ignored).toBe(1)
  })

  it('what the recorder cannot follow is named, never dropped', () => {
    const r = convertAgentBrowser([
      { command: ['open', 'https://vos.so'], data: {}, success: true },
      { command: ['open', 'https://vos.so/docs'], data: {}, success: true },
      {
        command: ['press', 'Meta+k'],
        data: { pressed: 'Meta+k' },
        success: true,
      },
      {
        command: ['scroll', 'left', '100'],
        data: { scrolled: true },
        success: true,
      },
      { command: ['mouse', 'click', '10', '10'], data: {}, success: true },
      { command: ['drag', '#a', '#b'], data: {}, success: true },
      { command: ['keyboard', 'type', 'x'], data: {}, success: true },
      { command: ['frobnicate'], data: {}, success: true },
    ])
    expect(r.actions.steps).toEqual([])
    expect(r.skipped).toBe(7)
    expect(r.notes.map((n) => n.split(' — ')[0])).toEqual([
      'line 2: skipped',
      'line 3: skipped',
      'line 4: skipped',
      'line 5: skipped',
      'line 6: skipped',
      'line 7: skipped',
      'line 8: skipped',
    ])
    expect(r.notes[0]).toContain('a second open')
    expect(r.notes[1]).toContain('no key verb')
    expect(r.notes[5]).toContain('before any click or fill')
  })

  it('--url and --viewport override what the walk said; scroll defaults to 300 down', () => {
    const r = convertAgentBrowser(
      [
        { command: ['open', 'http://localhost:3000'], data: {}, success: true },
        { command: ['scroll'], data: { scrolled: true }, success: true },
        { command: ['scroll', 'up'], data: { scrolled: true }, success: true },
      ],
      {
        url: 'https://staging.example',
        viewport: { width: 1280, height: 720 },
      },
    )
    expect(r.actions.url).toBe('https://staging.example')
    expect(r.actions.viewport).toEqual({ width: 1280, height: 720 })
    expect(
      r.actions.steps.map((s) => (s.do === 'scroll' ? s.dy : null)),
    ).toEqual([300, -300])
  })
})

describe('parseAgentBrowserLog', () => {
  it('reads a JSONL of records or one batch array, and names what is not a record', () => {
    const jsonl = [
      JSON.stringify({
        command: ['open', 'https://vos.so'],
        data: {},
        success: true,
      }),
      '',
      JSON.stringify({
        command: 'click "a[href=\\"/docs\\"]"',
        data: {},
        success: true,
      }),
      JSON.stringify({ success: true, data: { clicked: '@e27' }, error: null }),
      'not json',
    ].join('\n')
    const r = parseAgentBrowserLog(jsonl)
    expect(r.records).toHaveLength(2)
    expect(r.problems).toEqual([
      'line 4: no "command" — keep each call as {command:[…], …result} (the batch shape); a bare --json result does not say what ran',
      'line 5: not JSON',
    ])
    const batch = parseAgentBrowserLog(
      JSON.stringify([
        {
          command: ['hover', '@e25'],
          error: null,
          result: { hovered: '@e25' },
          success: true,
        },
        {
          command: ['click', '@e999'],
          error: 'Unknown ref: e999',
          result: null,
          success: false,
        },
      ]),
    )
    expect(batch.records).toHaveLength(2)
    expect(batch.problems).toEqual([])
    expect(parseAgentBrowserLog('  \n').problems).toEqual(['the log is empty'])
  })
})

describe('splitCommand', () => {
  it('splits shell-style, quotes grouping and escapes kept', () => {
    expect(splitCommand('click "a[href=\\"/docs\\"]"')).toEqual([
      'click',
      'a[href="/docs"]',
    ])
    expect(splitCommand("find text 'Sign In' click --exact")).toEqual([
      'find',
      'text',
      'Sign In',
      'click',
      '--exact',
    ])
    expect(splitCommand('fill @e2 record')).toEqual(['fill', '@e2', 'record'])
    expect(splitCommand('  ')).toEqual([])
  })
})
