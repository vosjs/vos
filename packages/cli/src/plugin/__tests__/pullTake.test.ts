/**
 * `vos pull <take> --check` and `--since`: the take path walks the changelog
 * from the tracked base (or the one named) and, under --check, reports without
 * touching the directory. Pinned against a local server so the assertion is
 * about what the CLI asks and what it writes, not about vos.so.
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pullTake } from '../sync'
import type { Server } from 'node:http'
import type { Reporter } from '../output'

let server: Server | null = null
afterEach(() => {
  server?.close()
  server = null
})

const HEAD = 'ver_head0000'
const BASE = 'ver_base0000'
const OLDER = 'ver_older000'

function serve(seen: string[]): Promise<string> {
  return new Promise((resolveUrl) => {
    server = createServer((req, res) => {
      seen.push(req.url ?? '')
      const send = (status: number, out: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(out))
      }
      const url = new URL(req.url ?? '/', 'http://x')
      if (url.pathname === '/api/vos/vos_1') {
        return send(200, { vos: { id: 'vos_1', currentVersionId: HEAD } })
      }
      if (url.pathname === '/api/vos/vos_1/changes') {
        const since = url.searchParams.get('since')
        const changes =
          since === OLDER
            ? [
                {
                  versionNumber: 2,
                  origin: 'studio',
                  summary: 'zoom z1 level 2 → 3',
                },
                { versionNumber: 3, origin: 'studio', summary: 'trim tail' },
              ]
            : [{ versionNumber: 3, origin: 'studio', summary: 'trim tail' }]
        return send(200, { head: { id: HEAD }, changes, protected: ['z1'] })
      }
      if (url.pathname === `/api/vos/vos_1/versions/${HEAD}/doc`) {
        return send(200, {
          docSchemaVersion: 2,
          source: { videoKey: 'recording.webm', meta: { durationMs: 1000 } },
          segments: [{ in: 0, out: 1 }],
        })
      }
      if (url.pathname === '/api/vos/vos_1/versions') {
        return send(200, { versions: [{ id: HEAD, versionNumber: 3 }] })
      }
      send(404, { error: `unexpected ${url.pathname}` })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolveUrl(`http://127.0.0.1:${port}`)
    })
  })
}

function quiet(): { r: Reporter; lines: string[] } {
  const lines: string[] = []
  const r: Reporter = {
    log: (m: string) => {
      lines.push(m)
    },
    event: () => {},
    done: () => {},
  } as unknown as Reporter
  return { r, lines }
}

async function take(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vos-pull-'))
  await writeFile(
    join(dir, 'doc.json'),
    JSON.stringify({ source: { videoKey: 'recording.webm' } }),
  )
  await writeFile(
    join(dir, 'vos.json'),
    JSON.stringify({ vosId: 'vos_1', versionId: BASE, pushedAt: 'x' }),
  )
  return dir
}

describe('pullTake --check / --since', () => {
  it('--check reports the versions behind and writes nothing', async () => {
    const seen: string[] = []
    const origin = await serve(seen)
    const dir = await take()
    const before = await readFile(join(dir, 'doc.json'), 'utf8')
    const { r, lines } = quiet()
    const result = await pullTake(dir, { origin, key: 'k', check: true }, r)
    expect(result.checked).toBe(true)
    expect(result.behind).toBe(1)
    expect(result.changed).toBe(false)
    expect(result.protected).toEqual(['z1'])
    expect(await readFile(join(dir, 'doc.json'), 'utf8')).toBe(before)
    expect(
      JSON.parse(await readFile(join(dir, 'vos.json'), 'utf8')).versionId,
    ).toBe(BASE)
    expect(seen.some((u) => u.includes(`/changes?since=${BASE}`))).toBe(true)
    expect(seen.some((u) => u.includes('/doc'))).toBe(false)
    expect(lines.some((l) => l.includes('trim tail'))).toBe(true)
  })

  it('--since walks from the named base instead of the tracked one', async () => {
    const seen: string[] = []
    const origin = await serve(seen)
    const dir = await take()
    const { r } = quiet()
    const result = await pullTake(
      dir,
      { origin, key: 'k', check: true, since: OLDER },
      r,
    )
    expect(result.behind).toBe(2)
    expect(seen.some((u) => u.includes(`/changes?since=${OLDER}`))).toBe(true)
    expect(seen.some((u) => u.includes(`/changes?since=${BASE}`))).toBe(false)
  })

  it('--since naming the head is up to date, even when the tracked base is older', async () => {
    const seen: string[] = []
    const origin = await serve(seen)
    const dir = await take()
    const { r } = quiet()
    const result = await pullTake(
      dir,
      { origin, key: 'k', check: true, since: HEAD },
      r,
    )
    expect(result.behind).toBe(0)
    expect(seen.some((u) => u.includes('/changes'))).toBe(false)
  })

  it('--check on a take linked with --vos and no base still reports the head', async () => {
    const seen: string[] = []
    const origin = await serve(seen)
    const dir = await mkdtemp(join(tmpdir(), 'vos-pull-'))
    await writeFile(join(dir, 'doc.json'), JSON.stringify({ source: {} }))
    const { r, lines } = quiet()
    const result = await pullTake(
      dir,
      { origin, key: 'k', check: true, vos: 'vos_1' },
      r,
    )
    expect(result.checked).toBe(true)
    expect(result.behind).toBeNull()
    expect(result.versionId).toBe(HEAD)
    expect(existsSync(join(dir, 'vos.json'))).toBe(false)
    expect(lines.some((l) => l.includes('--since'))).toBe(true)
  })

  it('without --check the pull still syncs doc.json and repoints the base', async () => {
    const seen: string[] = []
    const origin = await serve(seen)
    const dir = await take()
    const { r } = quiet()
    const result = await pullTake(dir, { origin, key: 'k' }, r)
    expect(result.checked).toBeUndefined()
    expect(result.changed).toBe(true)
    expect(result.versionNumber).toBe(3)
    expect(
      JSON.parse(await readFile(join(dir, 'vos.json'), 'utf8')).versionId,
    ).toBe(HEAD)
    expect(
      JSON.parse(await readFile(join(dir, 'doc.json'), 'utf8')).segments,
    ).toEqual([{ in: 0, out: 1 }])
  })
})
