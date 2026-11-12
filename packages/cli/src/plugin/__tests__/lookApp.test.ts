import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
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
import { appControlLine, cmdLookApp, isDesktopLook } from '../lookApp'
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
