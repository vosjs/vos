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
import { run } from '../run'

// `vos validate actions.json` on a desktop app's script: one that names its
// app is held to what a desktop take runs, `--app` says so for one that does
// not, and a page's refusal says how a desktop script differs. A cold agent
// was once told only "type needs a selector" for a script that was right.

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vos-validate-desktop-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
afterEach(() => {
  vi.restoreAllMocks()
})

async function validate(name: string, script: unknown, flags: string[] = []) {
  const file = join(dir, `${name}.json`)
  await writeFile(file, JSON.stringify(script))
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
  const code = await run(['validate', file, ...flags])
  return { code, out: out.join(''), err: err.join('') }
}

const BLIND = [{ do: 'type', focus: false, text: 'node greet.js' }]

describe('vos validate, a desktop app’s script', () => {
  it('passes a script that names its app, and says it is a desktop one', async () => {
    const r = await validate('named', { app: 'Code', steps: BLIND })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/valid actions file for a desktop app \(Code\)/)
  })

  it('takes --app or --pid for a script that does not name its app', async () => {
    const byApp = await validate('flag', { steps: BLIND }, ['--app', 'Code'])
    expect(byApp.code).toBe(0)
    expect(byApp.out).toMatch(/valid actions file for a desktop app/)
    const byPid = await validate('pid', { steps: BLIND }, ['--pid', '4100'])
    expect(byPid.code).toBe(0)
  })

  it('without either, says how a desktop script differs', async () => {
    const r = await validate('page', { steps: BLIND })
    expect(r.code).toBe(2)
    expect(r.err).toMatch(
      /steps\[0\]: type needs a selector \(a desktop app's script may leave it out with focus: false, and says so by naming "app"; vos validate --app checks one that does not\)/,
    )
  })

  it('holds a desktop script to what a desktop take can run', async () => {
    const r = await validate('refused', {
      app: 'Code',
      steps: [
        { do: 'click', selector: "row[name='src']" },
        { do: 'paste', text: 'x' },
      ],
    })
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/not a script a desktop take can run/)
    expect(r.err).toMatch(/steps\[1\]: paste is not on a desktop take yet/)
  })

  it('a page’s script is validated as before', async () => {
    const r = await validate('web', {
      url: 'https://example.com',
      steps: [{ do: 'click', selector: '#go' }],
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/: valid actions file\n?$/)
  })
})
