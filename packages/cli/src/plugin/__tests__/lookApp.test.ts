import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  appControlLine,
  cmdLookApp,
  isDesktopLook,
  withinLimit,
} from '../lookApp'
import { fakeDriver } from './fakeDesktopDriver'

// `vos look --app`: the listing a script is written from, over a stand-in
// driver. The real outline is @vosjs/driver's, tested there on a real window.

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vos-look-app-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
afterEach(() => {
  vi.restoreAllMocks()
})

async function look(argv: string[], o: Parameters<typeof fakeDriver>[0] = {}) {
  const out: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const code = await cmdLookApp(argv, { driver: fakeDriver(o).driver })
  return { code, text: out.join('') }
}

describe('vos look --app', () => {
  it('is the desktop look when an app or a window is named', () => {
    expect(isDesktopLook(['--app', 'TextEdit'])).toBe(true)
    expect(isDesktopLook(['--window=41'])).toBe(true)
    expect(isDesktopLook(['https://example.com', '--click', 'a'])).toBe(false)
  })

  it('lists each control with its selector, and says which names it alone', async () => {
    const out = join(dir, 'l1')
    const { code, text } = await look(['--app', 'TextEdit', '--out', out])
    expect(code).toBe(0)
    expect(existsSync(join(out, 'look.png'))).toBe(true)
    expect(text).toMatch(/Looked at TextEdit \(656×422 points\)/)
    expect(text).toMatch(/4 controls:/)
    expect(text).toMatch(
      /button "Save"\n {6}button\[id='save'\] {2}UNIQUE {2}@ 560,6 80×22/,
    )
    expect(text).toMatch(/button "Again" {2}\[disabled\]/)
    expect(text).toMatch(
      /button\[name='Again'\]:nth\(0\) {2}AMBIGUOUS \(by position among its namesakes\)/,
    )
    expect(text).toMatch(
      /button:nth\(3\) {2}AMBIGUOUS \(no name: by position alone\)/,
    )
    expect(text).toMatch(/vos record --app "TextEdit" --actions actions.json/)
  })

  it('as JSON, the controls themselves', async () => {
    const { text } = await look([
      '--window',
      '41',
      '--out',
      join(dir, 'l2'),
      '--json',
    ])
    const done = JSON.parse(text.trim().split('\n').at(-1)!)
    expect(done).toMatchObject({
      event: 'done',
      ok: true,
      app: 'TextEdit',
      more: 0,
    })
    expect(done.controls[0]).toEqual({
      role: 'button',
      name: 'Save',
      id: 'save',
      rect: { x: 560, y: 6, w: 80, h: 22 },
      disabled: false,
      selector: "button[id='save']",
      match: 'unique',
    })
    expect(done.controls[2].match).toBe('ambiguous')
  })

  it('says which grant is missing', async () => {
    await expect(
      look(['--app', 'TextEdit', '--out', join(dir, 'l3')], {
        accessibility: false,
      }),
    ).rejects.toThrow(/Accessibility is not granted/)
    await expect(
      look(['--app', 'TextEdit', '--out', join(dir, 'l3')], {
        screenRecording: false,
      }),
    ).rejects.toThrow(/Screen Recording is not granted/)
    await expect(look(['--out', join(dir, 'l3')])).rejects.toThrow(
      /vos look --app/,
    )
  })

  it('says so when an Electron app has not built its tree, and what to do', async () => {
    const { code, text } = await look(
      ['--app', 'Code', '--out', join(dir, 'l5')],
      { kind: 'electron', built: false },
    )
    expect(code).toBe(0)
    expect(text).toMatch(
      /is an Electron app, and it has not built its accessibility tree/,
    )
    expect(text).toMatch(/--force-renderer-accessibility/)
    const json = await look(
      ['--pid', '4100', '--out', join(dir, 'l5b'), '--json'],
      { kind: 'chromium', built: false },
    )
    expect(JSON.parse(json.text.trim().split('\n').at(-1)!)).toMatchObject({
      kind: 'chromium',
      built: false,
    })
  })

  it('says when the outline carries a path the picture does not show', async () => {
    const { text } = await look(['--app', 'Code', '--out', join(dir, 'l6')], {
      firstName: '~/work/acme-client/src/launch.js',
    })
    expect(text).toMatch(
      /note: 1 name above carries a file path the picture does not show/,
    )
    const clean = await look(['--app', 'Code', '--out', join(dir, 'l6b')])
    expect(clean.text).not.toMatch(/carr(y|ies) a file path/)
  })

  it('--actions --until walks the script to a step, for real, and then looks', async () => {
    const file = join(dir, 'walk.json')
    await writeFile(
      file,
      JSON.stringify({
        steps: [
          { do: 'click', selector: "button[id='save']", id: 'open', ms: 0 },
          { do: 'press', keys: 'Enter', id: 'after', ms: 0 },
        ],
      }),
    )
    const fake = fakeDriver()
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const code = await cmdLookApp(
      [
        '--app',
        'TextEdit',
        '--actions',
        file,
        '--until',
        'open',
        '--out',
        join(dir, 'l7'),
        '--json',
      ],
      { driver: fake.driver },
    )
    expect(code).toBe(0)
    expect(fake.requests[0]).toMatchObject({
      app: 'TextEdit',
      drive: true,
      pointer: false,
    })
    // The step asked for ran; the one after it did not.
    expect(fake.commands.map((c) => c.do)).toEqual(['now', 'locate', 'click'])
    const done = JSON.parse(out.join('').trim().split('\n').at(-1)!)
    expect(done).toMatchObject({
      ok: true,
      until: 'open',
      reached: true,
      steps: 1,
    })

    // A guarded step PAST the one the walk stops at is not pressed, so it
    // needs no --confirm; one the walk runs does, and a desktop refusal
    // names the walk, not a rehearsal a desktop script has not got.
    const guarded = join(dir, 'guarded.json')
    await writeFile(
      guarded,
      JSON.stringify({
        app: 'TextEdit',
        steps: [
          { do: 'click', selector: "button[id='save']", id: 'open', ms: 0 },
          {
            do: 'click',
            selector: "button[id='save']",
            id: 'send',
            guard: 'spend',
            ms: 0,
          },
        ],
      }),
    )
    await expect(
      look(['--actions', guarded, '--until', 'open']),
    ).resolves.toBeDefined()
    await expect(
      look(['--actions', guarded, '--until', 'send']),
    ).rejects.toThrow(
      /guarded \(spend\)[\s\S]*--confirm send[\s\S]*vos look --actions … --until/,
    )

    await expect(
      look(['--app', 'TextEdit', '--actions', file, '--until', 'nowhere']),
    ).rejects.toThrow(/no step of the script has that id/)
    await expect(
      look(['--app', 'TextEdit', '--until', 'open']),
    ).rejects.toThrow(/--actions and --until go together/)
  })

  it('past its limit, a listing keeps what can be acted on before words, in order', () => {
    const control = (role: string, i: number) =>
      ({
        role,
        name: `${role} ${i}`,
        id: '',
        selector: `${role}:nth(${i})`,
        match: 'unique',
        rect: { x: 0, y: i, w: 1, h: 1 },
        disabled: false,
      }) as Parameters<typeof withinLimit>[0][number]
    // A document's lines, then the panel beside it.
    const all = [
      control('button', 0),
      ...Array.from({ length: 8 }, (_, i) => control('text', i + 1)),
      control('popup', 9),
      control('checkbox', 10),
    ]
    const kept = withinLimit(all, 5)
    expect(kept.map((c) => c.name)).toEqual([
      'button 0',
      'text 1',
      'text 2',
      'popup 9',
      'checkbox 10',
    ])
    expect(withinLimit(all, 50)).toHaveLength(all.length)
    // More controls than the limit: the first ones, and no words.
    expect(withinLimit(all, 2).map((c) => c.name)).toEqual([
      'button 0',
      'popup 9',
    ])
  })

  it('a control with no selector worth trusting still says where it is', () => {
    expect(
      appControlLine({
        role: 'slider',
        name: '',
        id: '',
        rect: { x: 10.4, y: 20.6, w: 100, h: 12 },
        disabled: false,
        selector: 'slider',
        match: 'unique',
      }),
    ).toBe('  slider\n      slider  UNIQUE  @ 10,21 100×12')
  })
})
