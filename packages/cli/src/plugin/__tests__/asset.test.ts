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
