/**
 * A re-record replaces the footage, never the cut. This records a tiny
 * take through `vos record`, edits its cut, and records again: without
 * `--reuse` the cut is kept in doc.prev.json and the result says where and
 * how to apply it (twice in a row too: an untouched plan never takes the
 * cut's place), and with `--reuse` the cut lands on the new footage in the
 * same command. Skipped, and said, where no browser launches.
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
import type { Server } from 'node:http'

let server: Server | undefined
let base = ''
let skip = ''

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><html><head><title>Reuse</title></head>
<body style="margin:0;height:100vh;background:#eee">
<button id="go" style="margin:40px;padding:10px 16px">Go</button>
</body></html>`)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  try {
    const { launchBrowser } = await import('../../browser')
    await (await launchBrowser()).close()
  } catch (e) {
    skip = e instanceof Error ? e.message.split('\n')[0] : String(e)
  }
}, 60_000)

afterAll(() => {
  server?.close()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The done event a `--json` record prints. */
async function record(
  actions: string,
  out: string,
  extra: string[] = [],
): Promise<{ code: number; done: Record<string, unknown> }> {
  const lines: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    lines.push(String(c))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const code = await run([
    'record',
    '--actions',
    actions,
    '--url',
    base,
    '--out',
    out,
    '--background',
    'none',
    '--json',
    ...extra,
  ])
  vi.restoreAllMocks()
  const done = lines
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .find((e) => e.event === 'done')
  return { code, done: done ?? {} }
}

const MARK = '#123456'

describe('recording again into a take keeps its cut', () => {
  it('without --reuse keeps it aside and says so; twice in a row too; with --reuse applies it', async () => {
    if (skip) {
      console.warn(`skipped: no browser (${skip})`)
      return
    }
    const dir = await mkdtemp(join(tmpdir(), 'vos-reuse-'))
    const actions = join(dir, 'actions.json')
    await writeFile(
      actions,
      JSON.stringify({
        viewport: { width: 640, height: 360 },
        steps: [
          { do: 'wait', ms: 300 },
          { do: 'click', selector: '#go' },
          { do: 'wait', ms: 300 },
        ],
      }),
    )
    const out = join(dir, 'take')
    const docOf = async (name: string) =>
      JSON.parse(await readFile(join(out, name), 'utf8')) as {
        frame: { background: string }
      }

    // The first take, then a person's cut on it.
    expect((await record(actions, out)).code).toBe(0)
    const cut = await docOf('doc.json')
    cut.frame.background = MARK
    await writeFile(join(out, 'doc.json'), JSON.stringify(cut))

    // Again, no --reuse: the cut waits in doc.prev.json, and the result
    // names it and the command that applies it.
    const again = await record(actions, out)
    expect(again.code).toBe(0)
    expect(again.done.previousCut).toBe(join(out, 'doc.prev.json'))
    expect(again.done.next_step).toBe(`vos plan ${out} --reuse`)
    expect((await docOf('doc.json')).frame.background).not.toBe(MARK)
    expect((await docOf('doc.prev.json')).frame.background).toBe(MARK)

    // And again: the plan in doc.json was never edited, so it does not
    // take the cut's place.
    const third = await record(actions, out)
    expect(third.code).toBe(0)
    expect((await docOf('doc.prev.json')).frame.background).toBe(MARK)

    // With --reuse the cut lands on the new footage in the same command.
    const reused = await record(actions, out, ['--reuse'])
    expect(reused.code).toBe(0)
    expect((await docOf('doc.json')).frame.background).toBe(MARK)
    expect(reused.done.reuse).toMatchObject({
      from: join(out, 'doc.prev.json'),
    })
    expect(reused.done.next_step).toBeUndefined()
    // A reused cut is the cut: no planned mark beside it.
    expect(existsSync(join(out, '.doc-planned'))).toBe(false)
  }, 180_000)

  it('refuses --reuse on a take with no cut, before a browser opens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vos-reuse-none-'))
    const actions = join(dir, 'actions.json')
    await writeFile(
      actions,
      JSON.stringify({
        url: 'http://127.0.0.1:9/',
        steps: [{ do: 'wait', ms: 1 }],
      }),
    )
    const err: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      err.push(String(c))
      return true
    })
    const code = await run([
      'record',
      '--actions',
      actions,
      '--out',
      join(dir, 'take'),
      '--reuse',
    ])
    expect(code).toBe(2)
    expect(err.join('')).toContain('has no cut to keep')
  })
})
