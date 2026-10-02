/**
 * `vos asset rename` against a real in-process HTTP server (the
 * folder.test.ts pattern). The contract under test: rename PATCHes
 * `{ filename }` to the asset route, a server refusal surfaces as an
 * error naming the reason, and missing arguments are a usage error.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cmdAsset } from '../asset'
import { uploadDoor } from './uploadDoor'
import { UsageError } from '../args'
import type { Server } from 'node:http'

let server: Server | undefined

interface Seen {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function serve(seen: Seen[]): Promise<string> {
  const door = uploadDoor((declared) => ({
    id: 'snd-1',
    kind: 'audio',
    filename: declared.filename,
    size: 8,
  }))
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: Record<string, unknown> | null = null
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
      } catch {
        // a part's body is the file's bytes, not JSON
      }
      seen.push({ method: req.method ?? '', url: req.url ?? '', body })
      const send = (status: number, payload: Record<string, unknown>) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const url = req.url ?? ''
      if (url === '/api/folders') {
        return send(200, {
          folders: [{ id: 'f-1', slug: 'reel', parentId: null }],
        })
      }
      const upload = door(req.method ?? '', url, body)
      if (upload) return send(upload.status, upload.payload)
      if (url === '/pic.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        return res.end(Buffer.from('not really a png'))
      }
      if (url.startsWith('/api/assets?') && req.method === 'GET') {
        return send(200, {
          assets: [
            {
              id: 'a-1',
              kind: 'image',
              filename: 'hero.png',
              size: 2048,
              uses: 2,
              intent: 'library',
            },
            {
              id: 'a-2',
              kind: 'video',
              filename: 'recording.webm',
              size: 5 * 1024 * 1024,
              uses: 0,
              intent: 'attached',
            },
          ],
          total: 7,
          kinds: {
            image: { count: 3, bytes: 9 },
            video: { count: 4, bytes: 9 },
          },
        })
      }
      if (url === '/api/user/usage') {
        return send(200, {
          plan: 'free',
          usage: {
            assetBytes: 1024 * 1024 * 1024,
            trashBytes: 100 * 1024 * 1024,
            uploadsToday: { image: 3 },
          },
          limits: {
            storageBytes: 5 * 1024 * 1024 * 1024,
            uploadKinds: { image: { perDay: 100 } },
          },
        })
      }
      if (url === '/api/assets/a-1' && req.method === 'GET') {
        return send(200, {
          asset: { id: 'a-1', kind: 'image', filename: 'hero.png', size: 2048 },
          usedIn: [
            { vosId: 'v-1', title: 'Launch', head: true, versions: 3 },
            { vosId: 'v-2', title: '', draft: true },
          ],
        })
      }
      if (url.startsWith('/api/assets/') && req.method === 'PATCH') {
        if (body?.filename === 'design.txt') {
          return send(400, { error: 'a recipe asset keeps a .md extension' })
        }
        return url.includes('asset-1')
          ? send(200, { id: 'asset-1', filename: body?.filename })
          : send(404, { error: 'Asset not found' })
      }
      send(404, { error: 'not found' })
    })
  })
  return new Promise((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      resolve(
        typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '',
      )
    })
  })
}

afterEach(() => {
  server?.close()
  server = undefined
})

const KEY = ['--key', 'vos_sk_test', '--json']

/** Run a verb under --json and answer the `done` line it printed. */
async function captured(run: () => Promise<number>): Promise<any> {
  const lines: string[] = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    expect(await run()).toBe(0)
  } finally {
    process.stdout.write = write
  }
  return JSON.parse(lines.join('').trim().split('\n').at(-1) ?? '{}')
}

describe('vos asset', () => {
  it('rename PATCHes { filename } to the asset route', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const code = await cmdAsset([
      'rename',
      'asset-1',
      'design.md',
      '--origin',
      origin,
      ...KEY,
    ])
    expect(code).toBe(0)
    expect(seen).toEqual([
      {
        method: 'PATCH',
        url: '/api/assets/asset-1',
        body: { filename: 'design.md' },
      },
    ])
  })

  it('push declares a sound typed by its bytes, as a library file, filed when asked', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = mkdtempSync(join(tmpdir(), 'vos-asset-'))
    const file = join(dir, 'score.ogg')
    writeFileSync(file, Buffer.from('OggS\0\u0002\0\0\0\0\0\0\0\0\0\0'))
    const code = await cmdAsset([
      'push',
      file,
      '--folder',
      'reel',
      '--origin',
      origin,
      ...KEY,
    ])
    expect(code).toBe(0)
    const begin = seen.find((s) => s.url === '/api/assets/uploads')
    expect(begin?.method).toBe('POST')
    expect(begin?.body).toMatchObject({
      filename: 'score.ogg',
      folderId: 'f-1',
      intent: 'library',
      size: 16,
    })
    expect(String(begin?.body?.contentType)).toMatch(/^audio\//)
    expect(String(begin?.body?.sha256)).toMatch(/^[0-9a-f]{64}$/)
    expect(seen.map((s) => `${s.method} ${s.url}`).slice(-2)).toEqual([
      'PUT /api/assets/uploads/up-1/parts/1',
      'POST /api/assets/uploads/up-1/complete',
    ])
  })

  it('push sends a font the same way, and leaves its type to the platform', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = mkdtempSync(join(tmpdir(), 'vos-asset-'))
    const file = join(dir, 'Brand.woff2')
    writeFileSync(file, Buffer.from('wOF2 not really a font'))
    const code = await cmdAsset(['push', file, '--origin', origin, ...KEY])
    expect(code).toBe(0)
    const begin = seen.find((s) => s.url === '/api/assets/uploads')
    expect(begin?.body).toMatchObject({
      filename: 'Brand.woff2',
      intent: 'library',
    })
    expect(begin?.body).not.toHaveProperty('contentType')
    expect(begin?.body).not.toHaveProperty('folderId')
  })

  it('push answers what the platform read, and how to name the file', async () => {
    const origin = await serve([])
    const dir = mkdtempSync(join(tmpdir(), 'vos-asset-'))
    const file = join(dir, 'score.ogg')
    writeFileSync(file, Buffer.from('OggS\0\u0002\0\0\0\0\0\0\0\0\0\0'))
    const out = await captured(() =>
      cmdAsset(['push', file, '--origin', origin, ...KEY]),
    )
    expect(out.uploaded[0]).toMatchObject({
      id: 'snd-1',
      kind: 'audio',
      ref: 'asset:snd-1',
      url: '/api/assets/snd-1/file',
    })
  })

  it('import fetches the address and states where the file came from', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const out = await captured(() =>
      cmdAsset([
        'import',
        `${origin}/pic.png`,
        '--license',
        'CC0',
        '--attribution',
        'A. Person',
        '--origin',
        origin,
        ...KEY,
      ]),
    )
    const begin = seen.find((s) => s.url === '/api/assets/uploads')
    expect(begin?.body).toMatchObject({
      filename: 'pic.png',
      intent: 'library',
    })
    const complete = seen.find((s) => s.url.endsWith('/complete'))
    expect(complete?.body?.provenance).toEqual({
      sourceUrl: `${origin}/pic.png`,
      license: 'CC0',
      attribution: 'A. Person',
    })
    expect(out).toMatchObject({
      license: 'CC0',
      sourceUrl: `${origin}/pic.png`,
    })
  })

  it('import takes only a web address', async () => {
    await expect(cmdAsset(['import', './local.png'])).rejects.toThrowError(
      UsageError,
    )
    await expect(
      cmdAsset(['import', 'file:///etc/passwd']),
    ).rejects.toThrowError(UsageError)
  })

  it('assets ls asks for a page with the filters it was given', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const out = await captured(() =>
      cmdAsset([
        'ls',
        '--kind',
        'image',
        '--q',
        'hero',
        '--sort',
        'size',
        '--origin',
        origin,
        ...KEY,
      ]),
    )
    const asked = new URL(`http://x${seen[0].url}`).searchParams
    expect(Object.fromEntries(asked)).toEqual({
      limit: '50',
      kind: 'image',
      q: 'hero',
      sort: 'size',
    })
    expect(out.total).toBe(7)
    expect(out.assets).toHaveLength(2)
  })

  it('assets usage and why read the account and one file', async () => {
    const origin = await serve([])
    const usage = await captured(() =>
      cmdAsset(['usage', '--origin', origin, ...KEY]),
    )
    expect(usage.usage.assetBytes).toBe(1024 * 1024 * 1024)
    const why = await captured(() =>
      cmdAsset(['why', 'a-1', '--origin', origin, ...KEY]),
    )
    expect(why.usedIn).toHaveLength(2)
    await expect(cmdAsset(['why'])).rejects.toThrowError(UsageError)
  })

  it('a server refusal surfaces with the reason', async () => {
    const origin = await serve([])
    await expect(
      cmdAsset(['rename', 'asset-1', 'design.txt', '--origin', origin, ...KEY]),
    ).rejects.toThrowError(/\.md/)
  })

  it('missing arguments and unknown subcommands are usage errors', async () => {
    await expect(cmdAsset(['rename', 'asset-1'])).rejects.toThrowError(
      UsageError,
    )
    await expect(cmdAsset(['delete', 'asset-1'])).rejects.toThrowError(
      UsageError,
    )
  })
})
