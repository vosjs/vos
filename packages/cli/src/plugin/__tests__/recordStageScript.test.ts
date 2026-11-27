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
import { cmdRecordApp, scriptNamesApp } from '../recordApp'
import { fakeDriver } from './fakeDesktopDriver'
import type { FakeOptions } from './fakeDesktopDriver'

// A scripted stage: an actions.json that names `apps`, whose steps say which
// app they act on. The driver is a stand-in (the real one is tested against
// real windows in @vosjs/driver), so what is held is the verb and the step
// loop: what the driver is asked for, that every command carries its app,
// and that the take it leaves keeps its steps like any scripted take.

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vos-record-stage-script-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
afterEach(() => {
  vi.restoreAllMocks()
})

async function run(argv: string[], o: FakeOptions = {}) {
  const out: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
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
    commands: fake.commands as (Record<string, unknown> & { do: string })[],
    done: events.find((e) => e.event === 'done'),
  }
}

const script = async (name: string, body: unknown) => {
  const file = join(dir, name)
  await writeFile(file, JSON.stringify(body))
  return file
}

describe('a script that names apps is a stage’s', () => {
  it('is a desktop script', async () => {
    expect(
      await scriptNamesApp(
        await script('is.json', { apps: ['Linear', 'Terminal'], steps: [] }),
      ),
    ).toBe(true)
  })

  it('records a stage of its apps, driven, and every command says which app it acts on', async () => {
    const out = join(dir, 'scripted')
    const file = await script('two.json', {
      apps: ['Linear', 'Terminal'],
      steps: [
        // Names no app: the stage's first.
        { do: 'click', selector: "button[id='save']", id: 'save' },
        {
          do: 'type',
          app: 'Terminal',
          selector: "textfield[id='title']",
          text: 'git status',
          id: 'run',
        },
        // Names none: stays with Terminal.
        { do: 'click', selector: "button[id='save']", id: 'again' },
      ],
    })
    const { code, requests, commands, done } = await run([
      '--actions',
      file,
      '--out',
      out,
    ])
    expect(code).toBe(0)
    expect(requests.at(-1)).toMatchObject({
      apps: ['Linear', 'Terminal'],
      drive: true,
      pointer: true,
    })
    expect('app' in requests.at(-1)!).toBe(false)
    expect('size' in requests.at(-1)!).toBe(false)

    const acts = commands.filter((c) => c.do !== 'now')
    expect(acts.every((c) => typeof c.app === 'string')).toBe(true)
    expect(acts.find((c) => c.do === 'type')?.app).toBe('Terminal')
    // The first step names none and is the stage's first app's; everything
    // from the step that names Terminal on is Terminal's.
    const clicks = acts.filter((c) => c.do === 'click').map((c) => c.app)
    expect(clicks[0]).toBe('Linear')
    expect(clicks.slice(1).every((a) => a === 'Terminal')).toBe(true)
    expect(clicks.length).toBeGreaterThanOrEqual(2)

    const meta = JSON.parse(await readFile(join(out, 'meta.json'), 'utf8'))
    expect(meta.captureSurface).toBe('desktop')
    expect(meta.steps.map((s: { id: string }) => s.id)).toEqual([
      'save',
      'run',
      'again',
    ])
    const kept = JSON.parse(await readFile(join(out, 'actions.json'), 'utf8'))
    expect(kept.apps).toEqual(['Linear', 'Terminal'])
    expect('app' in kept).toBe(false)
    expect(done).toMatchObject({
      steps: 3,
      stage: { apps: ['Linear', 'Terminal'] },
    })
  })

  it('a drag may end in another app: its far end is looked for there', async () => {
    const file = await script('drag.json', {
      apps: ['Finder', 'Linear'],
      steps: [
        {
          do: 'drag',
          selector: "button[id='save']",
          to: { app: 'Linear', selector: "textfield[id='title']" },
        },
      ],
    })
    const { code, commands } = await run([
      '--actions',
      file,
      '--out',
      join(dir, 'drag'),
    ])
    expect(code).toBe(0)
    const drag = commands.find((c) => c.do === 'drag')!
    expect(drag).toMatchObject({
      app: 'Finder',
      selector: "button[id='save']",
      to: { app: 'Linear', selector: "textfield[id='title']" },
    })
    // The end was waited for in the other app before anything was picked up.
    expect(
      commands.some(
        (c) =>
          c.do === 'locate' &&
          c.app === 'Linear' &&
          c.selector === "textfield[id='title']",
      ),
    ).toBe(true)
  })

  it('a mask says which app its element is in, and the driver is told', async () => {
    const file = await script('mask.json', {
      apps: ['Linear', 'Terminal'],
      mask: [{ app: 'Linear', selector: "button[id='save']" }],
      steps: [{ do: 'wait', ms: 10 }],
    })
    const { requests } = await run([
      '--actions',
      file,
      '--out',
      join(dir, 'mask'),
    ])
    expect(requests.at(-1)).toMatchObject({
      mask: [{ app: 'Linear', selector: "button[id='save']" }],
    })
  })

  it('refuses, before anything is recorded, what a stage’s script gets wrong', async () => {
    const refused = async (body: unknown, words: RegExp) => {
      const file = await script(`bad-${Math.random()}.json`, body)
      await expect(
        run(['--actions', file, '--out', join(dir, 'bad')]),
      ).rejects.toThrow(words)
    }
    const steps = [{ do: 'wait', ms: 10 }]
    await refused(
      { apps: ['A', 'B'], app: 'A', steps },
      /one app \(app\) or a stage of several \(apps\), not both/,
    )
    await refused(
      { apps: ['A', 'B'], viewport: { width: 800, height: 600 }, steps },
      /viewport sizes one window/,
    )
    await refused(
      {
        apps: ['A', 'B'],
        steps: [{ do: 'click', app: 'C', selector: "button[id='save']" }],
      },
      /app "C" is not on the stage/,
    )
    await refused(
      { apps: ['A', 'B'], mask: [{ selector: "button[id='save']" }], steps },
      /a mask says which app its element is in/,
    )
    await refused(
      {
        app: 'A',
        steps: [{ do: 'click', app: 'A', selector: "button[id='save']" }],
      },
      /this script has no apps/,
    )
  })
})
