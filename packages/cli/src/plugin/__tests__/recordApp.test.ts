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
import { cmdRecordApp, isDesktopRecord, scriptNamesApp } from '../recordApp'
import { BUTTON, TRACK, fakeDriver } from './fakeDesktopDriver'
import type { FakeOptions } from './fakeDesktopDriver'

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
    commands: fake.commands,
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
      /42\s+TextEdit\s+520×222\s+pid 4100\s+\(untitled: an alert or a panel\)/,
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

describe('vos record --app --actions: a scripted desktop take', () => {
  const script = async (name: string, actions: unknown) => {
    const file = join(dir, `${name}.actions.json`)
    await writeFile(file, JSON.stringify(actions))
    return file
  }
  const SAVE_AND_TYPE = {
    viewport: { width: 900, height: 600 },
    steps: [
      { do: 'click', selector: "button[id='save']", id: 'save', ms: 0 },
      { do: 'type', selector: "textfield[id='title']", text: 'hi', ms: 0 },
      { do: 'press', keys: 'Mod+S', ms: 0 },
    ],
  }

  it('drives the app the script names, at the size it asks for, and keeps its steps', async () => {
    const out = join(dir, 's1')
    const file = await script('s1', SAVE_AND_TYPE)
    const { code, requests, commands, done } = await run([
      '--app',
      'TextEdit',
      '--actions',
      file,
      '--out',
      out,
      '--json',
    ])
    expect(code).toBe(0)
    expect(requests[0]).toMatchObject({
      app: 'TextEdit',
      drive: true,
      size: { w: 900, h: 600 },
      pointer: true,
    })
    expect(commands.map((c) => c.do)).toEqual([
      'now',
      'locate',
      'click',
      'locate',
      'click',
      'focused',
      'type',
      'press',
    ])
    expect(commands.at(-1)).toEqual({ do: 'press', keys: 'Meta+S' })

    // The take keeps the step spans and the script, as a page's does.
    const meta = JSON.parse(await readFile(join(out, 'meta.json'), 'utf8'))
    expect(meta.captureSurface).toBe('app')
    expect(meta.steps).toHaveLength(3)
    expect(meta.steps[0]).toMatchObject({
      step: 0,
      id: 'save',
      do: 'click',
      selector: "button[id='save']",
      rect: BUTTON,
    })
    expect(meta.steps[1].tStart).toBeGreaterThanOrEqual(meta.steps[0].tEnd)
    const kept = JSON.parse(await readFile(join(out, 'actions.json'), 'utf8'))
    expect(kept.app).toBe('TextEdit')
    expect(kept.steps).toHaveLength(3)
    expect(existsSync(join(out, 'doc.json'))).toBe(true)

    expect(done).toMatchObject({ steps: 3, skipped: [], disabled: [] })
    expect(done!.strictFailed).toBeUndefined()
  })

  it('a script that names its app needs no --app', async () => {
    const file = await script('s2', {
      app: 'TextEdit',
      steps: [{ do: 'wait', ms: 10 }],
    })
    expect(await scriptNamesApp(file)).toBe(true)
    expect(await scriptNamesApp(await script('s2b', SAVE_AND_TYPE))).toBe(false)
    expect(await scriptNamesApp(join(dir, 'missing.json'))).toBe(false)
    const { code, requests } = await run([file, '--out', join(dir, 's2')])
    expect(code).toBe(0)
    expect(requests[0]).toMatchObject({ app: 'TextEdit', drive: true })
    expect(requests[0]!.size).toBeUndefined()
  })

  it('stops at the first step that misses, and --strict fails what onSkip: continue lets through', async () => {
    const steps = [
      { do: 'click', selector: "button[id='save']", ms: 0 },
      { do: 'expect', text: 'Saved', timeout: 0.2, id: 'saved' },
      { do: 'press', keys: 'Enter', id: 'after', ms: 0 },
    ]
    const stops = await script('s3', { steps })
    const base = (file: string, out: string) => [
      '--app',
      'TextEdit',
      '--actions',
      file,
      '--out',
      join(dir, out),
    ]
    // By default the take ends at the miss: the key after it is never pressed.
    const stopped = await run([...base(stops, 's3'), '--json'])
    expect(stopped.code).toBe(1)
    expect(stopped.done).toMatchObject({ ok: false, steps: 2 })
    expect((stopped.done!.stopped as { reason: string }).reason).toMatch(
      /#1 saved expect missed \(text "Saved" did not appear within 0.2 s\), and a desktop take stops at the first miss/,
    )
    expect(stopped.commands.some((c) => c.do === 'press')).toBe(false)
    const said = await run(base(stops, 's3b'))
    expect(said.text).toMatch(/^FAILED: the take stopped at step #1/)

    // A script that says so goes on; the miss is then --strict's to fail.
    const goes = await script('s3c', { onSkip: 'continue', steps })
    const loose = await run(base(goes, 's3c'))
    expect(loose.code).toBe(0)
    expect(loose.text).toMatch(
      /SKIPPED: #1 saved expect: text "Saved" did not appear within 0.2 s/,
    )
    expect(loose.commands.some((c) => c.do === 'press')).toBe(true)
    const strict = await run([...base(goes, 's3d'), '--strict', '--json'])
    expect(strict.code).toBe(2)
    expect(strict.done).toMatchObject({ strictFailed: true })
  })

  it('refuses to type onto a row, and types where the keyboard is when no field is named', async () => {
    const blind = await script('s4', {
      steps: [{ do: 'type', text: 'hello', focus: false, id: 'write', ms: 0 }],
    })
    const args = ['--app', 'TextEdit', '--actions', blind, '--json']
    const ok = await run([...args, '--out', join(dir, 's4')])
    expect(ok.code).toBe(0)
    expect(ok.commands.map((c) => c.do)).toEqual(['now', 'focused', 'type'])

    const onRow = await run([...args, '--out', join(dir, 's4b')], {
      focus: { role: 'row', name: 'src' },
    })
    expect(onRow.code).toBe(1)
    expect(onRow.commands.some((c) => c.do === 'type')).toBe(false)
    expect((onRow.done!.stopped as { reason: string }).reason).toMatch(
      /the keyboard is on a row \("src"\), where typed keys are commands/,
    )
  })

  it('--pid names a process, the one way to tell two instances apart', async () => {
    const { code, requests } = await run([
      '--pid',
      '4100',
      '--seconds',
      '3',
      '--out',
      join(dir, 'p1'),
    ])
    expect(code).toBe(0)
    expect(requests[0]).toMatchObject({ pid: 4100 })
    expect(requests[0]!.app).toBeUndefined()
    await expect(run(['--pid', 'x', '--out', join(dir, 'p2')])).rejects.toThrow(
      /--pid expects/,
    )
    expect(isDesktopRecord(['--pid', '4100'])).toBe(true)
  })

  it('refuses, before anything is recorded, what a desktop take cannot run', async () => {
    const page = await script('r1', {
      url: 'https://example.com',
      steps: [{ do: 'await', until: { selector: 'x' } }],
    })
    await expect(
      run(['--app', 'TextEdit', '--actions', page, '--out', join(dir, 'r1')]),
    ).rejects.toThrow(
      /not a script a desktop take can run[\s\S]*url is not part[\s\S]*await/,
    )

    const ok = await script('r2', SAVE_AND_TYPE)
    const base = [
      '--app',
      'TextEdit',
      '--actions',
      ok,
      '--out',
      join(dir, 'r2'),
    ]
    await expect(run([...base, '--dry-run'])).rejects.toThrow(/no rehearsal/)
    await expect(run([...base, '--seconds', '5'])).rejects.toThrow(
      /a scripted take ends with its last step/,
    )
    await expect(run(base, { accessibility: false })).rejects.toThrow(
      /Accessibility is not granted[\s\S]*A script finds and presses/,
    )

    const guarded = await script('r3', {
      steps: [
        {
          do: 'click',
          selector: "button[id='save']",
          id: 'buy',
          guard: 'spend',
        },
      ],
    })
    const g = [
      '--app',
      'TextEdit',
      '--actions',
      guarded,
      '--out',
      join(dir, 'r3'),
    ]
    await expect(run(g)).rejects.toThrow(/--confirm buy/)
    const confirmed = await run([...g, '--confirm', 'buy', '--json'])
    expect(confirmed.code).toBe(0)
    expect(confirmed.done!.confirmed).toEqual(['buy'])
  })
})
