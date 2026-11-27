import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import { cmdRecordApp, isDesktopRecord } from '../recordApp'
import { deskParts } from '../recordStage'
import { STAGE_WINDOWS, TRACK, fakeDriver } from './fakeDesktopDriver'
import type { FakeOptions } from './fakeDesktopDriver'

// `vos record --app A --app B`: a stage. The capture and its rules are
// @vosjs/driver's and are tested there against real windows; here the driver
// is a stand-in, so what is held is the verb: what makes a request a stage,
// what it asks the driver for, what it refuses, and that the take it leaves
// is planned as a stage is.

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vos-record-stage-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
afterEach(() => {
  vi.restoreAllMocks()
})

async function run(argv: string[], o: FakeOptions = {}) {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk))
    return true
  })
  const fake = fakeDriver(o)
  const code = await cmdRecordApp(
    [...argv, '--background', 'none', '--max-duration', '600', '--json'],
    { driver: fake.driver },
  )
  const events = out
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        return { text: line }
      }
    })
  return {
    code,
    requests: fake.requests,
    commands: fake.commands,
    done: events.find((e) => e.event === 'done'),
    notes: err.join(''),
  }
}

describe('which `vos record` is a stage', () => {
  it('is a desktop take', () => {
    expect(isDesktopRecord(['--app', 'Linear', '--app', 'Terminal'])).toBe(true)
    expect(isDesktopRecord(['--stage', '--pid', '41'])).toBe(true)
    expect(isDesktopRecord(['--desk', 'menubar'])).toBe(true)
  })

  it('one --app is still a take of one window', async () => {
    const out = join(dir, 'one')
    const { requests } = await run(['--app', 'TextEdit', '--out', out])
    expect(requests).toEqual([
      { app: 'TextEdit', out, maxSeconds: 600, pointer: true, frames: true },
    ])
  })
})

describe('vos record --app A --app B', () => {
  it('asks the driver for a stage of the named apps, and nothing of the desk', async () => {
    const out = join(dir, 'two')
    const { code, requests } = await run([
      '--app',
      'Linear',
      '--app',
      'Terminal',
      '--out',
      out,
    ])
    expect(code).toBe(0)
    expect(requests).toEqual([
      {
        apps: ['Linear', 'Terminal'],
        out,
        maxSeconds: 600,
        pointer: true,
        frames: true,
      },
    ])
  })

  it('--stage with one app is that app’s every window; --pid names a process', async () => {
    const a = await run(['--app', 'Figma', '--stage', '--out', join(dir, 'a')])
    expect(a.requests[0]).toMatchObject({ apps: ['Figma'] })
    expect('app' in a.requests[0]!).toBe(false)
    const b = await run(['--pid', '4100', '--stage', '--out', join(dir, 'b')])
    expect(b.requests[0]).toMatchObject({ pids: [4100] })
  })

  it('--float asks for the windows with nothing behind them, alone or with one app', async () => {
    const a = await run([
      '--app',
      'A',
      '--app',
      'B',
      '--float',
      '--out',
      join(dir, 'f'),
    ])
    expect(a.requests[0]).toMatchObject({ apps: ['A', 'B'], float: true })
    expect(a.done).toMatchObject({ stage: { float: true } })
    // one app floats too: asking for it is asking for a stage
    const b = await run(['--app', 'A', '--float', '--out', join(dir, 'g')])
    expect(b.requests[0]).toMatchObject({ apps: ['A'], float: true })
    expect(isDesktopRecord(['record', '--float'])).toBe(true)
  })

  it('--desk keeps parts of the desk, by name, and says what a kept menu bar shows', async () => {
    const { requests, done } = await run([
      '--app',
      'Raycast',
      '--desk',
      'wallpaper,menubar',
      '--out',
      join(dir, 'desk'),
    ])
    expect(requests[0]).toMatchObject({
      apps: ['Raycast'],
      desk: ['menubar', 'wallpaper'],
    })
    expect(done).toMatchObject({
      stage: { desk: ['menubar', 'wallpaper'] },
      notes: expect.arrayContaining([
        expect.stringMatching(/the menu bar is in the picture/),
      ]),
    })
    expect(deskParts(['dock', 'menubar'])).toEqual(['menubar', 'dock'])
  })

  it('leaves a take planned as a stage: the camera inside the window that was worked in', async () => {
    const out = join(dir, 'planned')
    const { done } = await run([
      '--app',
      'Linear',
      '--app',
      'Terminal',
      '--out',
      out,
    ])
    for (const file of [
      'recording.mp4',
      'cursor.json',
      'meta.json',
      'doc.json',
    ])
      expect(existsSync(join(out, file)), file).toBe(true)

    const doc = JSON.parse(await readFile(join(out, 'doc.json'), 'utf8'))
    expect(doc.source.meta.captureSurface).toBe('desktop')
    expect(doc.source.meta.apps.map((a: { name: string }) => a.name)).toEqual([
      'Linear',
      'Terminal',
    ])
    expect(doc.source.cursor).toHaveLength(TRACK.length)
    expect(doc.frame.browserBar.kind).toBe('none')

    // Every press and ping of the track is in the first window: every span
    // the planner proposed is aimed inside it, and stands at least as close
    // as the whole window in the frame.
    const [win] = STAGE_WINDOWS(['Linear', 'Terminal'])
    const whole = Math.min(1728 / win!.w, 1084 / win!.h) * 0.85
    expect(doc.zoom.length).toBeGreaterThan(0)
    for (const z of doc.zoom) {
      expect(z.level).toBeGreaterThanOrEqual(whole - 0.01)
      expect(z.cx * 1728).toBeGreaterThanOrEqual(win!.x)
      expect(z.cx * 1728).toBeLessThanOrEqual(win!.x + win!.w)
      expect(z.cy * 1084).toBeGreaterThanOrEqual(win!.y)
      expect(z.cy * 1084).toBeLessThanOrEqual(win!.y + win!.h)
    }

    expect(done).toMatchObject({
      out,
      recording: 'recording.mp4',
      stage: { apps: ['Linear', 'Terminal'], desk: [], windows: 2 },
      cursor: { events: TRACK.length, clicks: 2, typing: 3 },
    })
  })
})

describe('what a stage refuses, in words', () => {
  const refused = async (
    argv: string[],
    words: RegExp,
    o: FakeOptions = {},
  ) => {
    await expect(run([...argv, '--out', join(dir, 'no')], o)).rejects.toThrow(
      words,
    )
  }

  it('a program: a stage is performed or scripted', async () => {
    await refused(
      ['--app', 'Linear', '--stage', '--play', 'play.mjs'],
      /takes no program yet/,
    )
  })

  it('--app flags that are not the stage a script names', async () => {
    const script = join(dir, 'stage-other.json')
    await writeFile(
      script,
      JSON.stringify({
        apps: ['Linear', 'Terminal'],
        steps: [{ do: 'wait', ms: 10 }],
      }),
    )
    await refused(
      ['--app', 'Linear', '--app', 'Notes', '--actions', script],
      /the script's stage is Linear, Terminal/,
    )
  })

  it('one window, a stage of nothing, and a part of the desk that is not one', async () => {
    await refused(
      ['--app', 'A', '--app', 'B', '--window', '41'],
      /--window names one window/,
    )
    await refused(['--stage'], /a stage names its apps/)
    await refused(['--desk', 'dock'], /a stage names its apps/)
    await refused(
      ['--app', 'A', '--desk', 'everything'],
      /There is no part that is everything/,
    )
  })

  it('--float with a part of the desk: one or the other', async () => {
    await expect(
      run(['--app', 'A', '--app', 'B', '--float', '--desk', 'dock']),
    ).rejects.toThrow(/--float is the windows with nothing behind them/)
  })

  it('a driver that does not know a floating stage: said as what to install, and no take is left', async () => {
    const out = join(dir, 'oldfloat')
    await expect(
      run(['--app', 'A', '--app', 'B', '--float', '--out', out], {
        noFloat: true,
      }),
    ).rejects.toThrow(/a floating stage needs @vosjs\/driver 0\.6\.0 or later/)
    expect(existsSync(join(out, 'meta.json'))).toBe(false)
  })

  it('a driver that does not know a stage: said as what to install, and no take is left', async () => {
    const out = join(dir, 'old')
    await expect(
      run(['--app', 'A', '--app', 'B', '--out', out], { noStage: true }),
    ).rejects.toThrow(/needs @vosjs\/driver 0\.5\.0 or later/)
    expect(existsSync(join(out, 'meta.json'))).toBe(false)
  })
})
