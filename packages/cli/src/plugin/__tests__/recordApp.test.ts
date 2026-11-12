import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import type { DesktopDriver } from '../recordApp'
import type { RecordRequest } from '@vosjs/driver'

// `vos record --app`: the verb, over a driver handed in. The real helper is
// @vosjs/driver's and is tested there against a real window; here the driver
// is a stand-in that writes the take a real one writes, so what is held is
// the verb: what it asks the driver for, what it refuses, and that the take
// it leaves is planned like any other.

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vos-record-app-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
afterEach(() => {
  vi.restoreAllMocks()
})

const FIELD = { x: 16, y: 60, w: 320, h: 28 }
const BUTTON = { x: 560, y: 6, w: 80, h: 22 }

/** The track a person leaves: travel, a press, a sentence typed in a field, a press. */
const TRACK = [
  ...Array.from({ length: 40 }, (_, i) => ({
    t: 1200 + i * 16,
    x: 120 + i * 12,
    y: 330 - i * 8,
    type: 'move',
  })),
  { t: 2358, x: 600, y: 17, type: 'down', button: 0, rect: BUTTON },
  { t: 2430, x: 600, y: 17, type: 'up', button: 0 },
  { t: 3055, x: 176, y: 74, type: 'key', rect: FIELD },
  { t: 3414, x: 176, y: 74, type: 'key', rect: FIELD },
  { t: 3790, x: 176, y: 74, type: 'key', rect: FIELD },
  { t: 5399, x: 600, y: 17, type: 'down', button: 0, rect: BUTTON },
  { t: 5470, x: 600, y: 17, type: 'up', button: 0 },
]

interface FakeOptions {
  screenRecording?: boolean
  accessibility?: boolean
  /** What `record` fails with, as the driver's errors are shaped. */
  fail?: { code: string; message: string }
  heldFrames?: number
}

/** A driver that records nothing and writes the take a real one writes. */
function fakeDriver(o: FakeOptions = {}) {
  const requests: RecordRequest[] = []
  const driver: DesktopDriver = {
    check: async () => ({
      version: '0.1.2',
      protocol: 1,
      screenRecording: o.screenRecording ?? true,
      accessibility: o.accessibility ?? true,
      path: '/helper',
      bundleId: '',
      os: 'test',
    }),
    windows: async () => [
      {
        id: 41,
        app: 'TextEdit',
        appId: 'com.apple.TextEdit',
        titled: true,
        frame: { x: 185, y: 83, w: 656, h: 422 },
      },
      {
        id: 42,
        app: 'TextEdit',
        appId: 'com.apple.TextEdit',
        titled: false,
        frame: { x: 394, y: 338, w: 520, h: 222 },
      },
    ],
    record: (request) => {
      requests.push(request)
      if (o.fail) {
        const error = Object.assign(new Error(o.fail.message), {
          code: o.fail.code,
        })
        const failed = Promise.reject(error)
        failed.catch(() => {})
        return {
          pid: undefined,
          ready: failed,
          done: failed,
          stop: () => failed,
        }
      }
      const write = async () => {
        await mkdir(request.out, { recursive: true })
        await writeFile(join(request.out, 'recording.mp4'), 'not a real video')
        await writeFile(join(request.out, 'cursor.json'), JSON.stringify(TRACK))
        await writeFile(
          join(request.out, 'meta.json'),
          JSON.stringify({
            dpr: 2,
            zoom: 1,
            t0: 1794475400000,
            durationMs: 6692,
            width: 656,
            height: 422,
            fps: 60,
            captureWidth: 1312,
            captureHeight: 844,
            captureSurface: 'app',
            platform: 'mac',
            producer: 'desktop',
            cornerRadius: 18.2,
            app: { name: 'TextEdit', id: 'com.apple.TextEdit' },
          }),
        )
      }
      const stopped = (reason: 'stop' | 'cap') =>
        ({
          event: 'stopped',
          reason,
          durationMs: 6692,
          frames: 386,
          idleFrames: 0,
          droppedFrames: 0,
          bytes: 16,
          events: TRACK.length,
          windowMoved: false,
          resized: false,
          sourceUpdates: 0,
          filterRefreshes: 0,
          heldFrames: o.heldFrames ?? 0,
          files: {
            recording: join(request.out, 'recording.mp4'),
            cursor: join(request.out, 'cursor.json'),
            meta: join(request.out, 'meta.json'),
          },
          clock: { t0Host: 0, arrivalLagMsMean: 0, arrivalLagMsMax: 0 },
        }) as never
      // A real take ends at its ceiling; the stand-in ends at once, as if it had.
      const done = write().then(() => stopped('cap'))
      return {
        pid: 1,
        ready: Promise.resolve({
          event: 'ready',
          protocol: 1,
          window: request.window ?? 41,
          app: 'TextEdit',
          frame: { x: 185, y: 83, w: 656, h: 422 },
          scale: 2,
          captureWidth: 1312,
          captureHeight: 844,
          filter: 'others-out',
          accessibility: true,
          cornerRadius: 18.2,
        } as never),
        done,
        stop: () => done,
      }
    },
  }
  return { driver, requests }
}

/** Runs the verb and gathers what it printed: the `done` object (it is run with --json) and its notes. */
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
  // --background none and --max-duration keep the verb off the network.
  const code = await cmdRecordApp(
    [...argv, '--background', 'none', '--max-duration', '600'],
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
    done: events.find((e) => e.event === 'done'),
    events,
    text: out.join(''),
    notes: err.join(''),
  }
}

describe('isDesktopRecord: which `vos record` is a desktop take', () => {
  it('is one that names an app, a window, or asks for the list', () => {
    expect(isDesktopRecord(['--app', 'TextEdit'])).toBe(true)
    expect(isDesktopRecord(['--app=TextEdit', '--out', 'take'])).toBe(true)
    expect(isDesktopRecord(['--window', '41'])).toBe(true)
    expect(isDesktopRecord(['--windows'])).toBe(true)
  })
  it('is not a page take', () => {
    expect(isDesktopRecord(['--actions', 'actions.json'])).toBe(false)
    expect(isDesktopRecord(['actions.json', '--out', 'take'])).toBe(false)
    expect(isDesktopRecord(['--hosted', '--actions', 'a.json'])).toBe(false)
  })
})

describe('vos record --app', () => {
  it('asks the driver for the app, into the take, with a ceiling and the pointer', async () => {
    const out = join(dir, 'take-app')
    const { code, requests } = await run([
      '--app',
      'TextEdit',
      '--out',
      out,
      '--json',
    ])
    expect(code).toBe(0)
    expect(requests).toEqual([
      { app: 'TextEdit', out, maxSeconds: 600, pointer: true, frames: true },
    ])
  })

  it('leaves a take that is planned like any other: a doc, with the zooms the track calls for', async () => {
    const out = join(dir, 'take-planned')
    const { done } = await run(['--app', 'TextEdit', '--out', out, '--json'])
    for (const file of [
      'recording.mp4',
      'cursor.json',
      'meta.json',
      'doc.json',
    ])
      expect(existsSync(join(out, file)), file).toBe(true)
    // a desktop take keeps no screencast frames, so it makes no place for them
    expect(existsSync(join(out, 'frames'))).toBe(false)

    const doc = JSON.parse(await readFile(join(out, 'doc.json'), 'utf8'))
    expect(doc.source.meta.captureSurface).toBe('app')
    expect(doc.source.meta.cornerRadius).toBe(18.2)
    expect(doc.source.cursor).toHaveLength(TRACK.length)
    expect(doc.frame.browserBar.kind).toBe('none')
    expect(doc.zoom.length).toBeGreaterThan(0)

    expect(done).toMatchObject({
      out,
      recording: 'recording.mp4',
      durationMs: 6692,
      cursor: { events: TRACK.length, clicks: 2, typing: 3 },
      zooms: doc.zoom.length,
    })
  })

  it('--seconds is the length of the take, never past the ceiling', async () => {
    const a = await run([
      '--app',
      'TextEdit',
      '--out',
      join(dir, 's1'),
      '--seconds',
      '20',
      '--json',
    ])
    expect(a.requests[0].maxSeconds).toBe(20)
    const b = await run([
      '--app',
      'TextEdit',
      '--out',
      join(dir, 's2'),
      '--seconds',
      '9000',
      '--json',
    ])
    expect(b.requests[0].maxSeconds).toBe(600)
  })

  it('--window names one window by its id', async () => {
    const { requests } = await run([
      '--window',
      '42',
      '--out',
      join(dir, 'w'),
      '--json',
    ])
    expect(requests[0]).toMatchObject({ window: 42 })
    expect('app' in requests[0]).toBe(false)
  })

  it('without Accessibility it records all the same, asks for no bounds, and says what that costs', async () => {
    const { code, requests, notes } = await run(
      ['--app', 'TextEdit', '--out', join(dir, 'no-ax')],
      { accessibility: false },
    )
    expect(code).toBe(0)
    expect(requests[0].frames).toBe(false)
    expect(notes).toMatch(/Accessibility is not granted/)
    expect(notes).toMatch(/zoom cannot fit the control/)
  })

  it("says when another app's window was held out of the take", async () => {
    const { done, notes } = await run(
      ['--app', 'TextEdit', '--out', join(dir, 'held'), '--json'],
      { heldFrames: 7 },
    )
    expect((done!.notes as string[]).join(' ')).toMatch(
      /7 frames were held back/,
    )
    // --json keeps notes off stderr: they are in the done event
    expect(notes).toBe('')
  })
})

describe('vos record --app refuses, in words', () => {
  it('with no Screen Recording: whose grant it is and where to switch it on', async () => {
    await expect(
      run(['--app', 'TextEdit', '--out', join(dir, 'no-sr')], {
        screenRecording: false,
      }),
    ).rejects.toThrow(
      /Screen Recording is not granted to the app this was run from/,
    )
    expect(existsSync(join(dir, 'no-sr'))).toBe(false)
  })

  it('a window that is not on screen: how to see what is', async () => {
    await expect(
      run(['--app', 'Nope', '--out', join(dir, 'nope')], {
        fail: {
          code: 'no-window',
          message: 'No window on screen matches the request.',
        },
      }),
    ).rejects.toThrow(/vos record --windows lists/)
  })

  it("any other failure is the driver's own sentence", async () => {
    await expect(
      run(['--app', 'TextEdit', '--out', join(dir, 'fail')], {
        fail: {
          code: 'start-failed',
          message:
            'The take did not begin within 20 s. It was starting the capture.',
        },
      }),
    ).rejects.toThrow(/did not begin within 20 s/)
  })

  it('bad arguments are usage', async () => {
    await expect(
      run(['--window', 'abc', '--out', join(dir, 'u1')]),
    ).rejects.toThrow(/--window expects a number/)
    await expect(
      run(['--window', '1.5', '--out', join(dir, 'u1')]),
    ).rejects.toThrow(/--window expects a window id/)
    await expect(
      run(['--app', 'TextEdit', '--seconds', '0', '--out', join(dir, 'u2')]),
    ).rejects.toThrow(/--seconds expects a length above 0/)
  })
})

describe('vos record --windows', () => {
  it('lists what can be recorded, and marks an alert as one', async () => {
    const { code, text, requests } = await run(['--windows'])
    expect(code).toBe(0)
    expect(requests).toHaveLength(0)
    expect(text).toMatch(/41\s+TextEdit\s+656×422/)
    expect(text).toMatch(
      /42\s+TextEdit\s+520×222\s+\(untitled: an alert or a panel\)/,
    )
    expect(text).toMatch(/vos record --app/)
  })

  it('as JSON, the windows themselves', async () => {
    const { done } = await run(['--windows', '--json'])
    expect((done!.windows as { id: number }[]).map((w) => w.id)).toEqual([
      41, 42,
    ])
  })
})
