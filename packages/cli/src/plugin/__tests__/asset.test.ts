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
import { UsageError } from '../args'
import type { Server } from 'node:http'

let server: Server | undefined

interface Seen {
  method: string
  url: string
  body: Record<string, unknown> | null
  headers?: Record<string, string | string[] | undefined>
}

function serve(seen: Seen[]): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: Record<string, unknown> | null = null
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
      } catch {
        // a raw media body (the recording door) is not JSON
      }
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body,
        ...(req.url === '/api/assets/recording'
          ? { headers: req.headers }
          : {}),
      })
      const send = (status: number, payload: Record<string, unknown>) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const url = req.url ?? ''
      if (url === '/api/folders') {
        return send(200, { folders: [{ id: 'f-1', slug: 'reel', parentId: null }] })
      }
      if (url === '/api/assets/recording' && req.method === 'POST') {
        return send(201, { id: 'snd-1', url: '/api/assets/snd-1/file', size: 8 })
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

  it('push sends a sound to the recording door, typed by its bytes and filed when asked', async () => {
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
    const upload = seen.find((s) => s.url === '/api/assets/recording')
    expect(upload?.method).toBe('POST')
    expect(upload?.headers?.['content-type']).toMatch(/^audio\//)
    expect(upload?.headers?.['x-folder-id']).toBe('f-1')
    expect(seen.some((s) => s.url === '/api/assets/upload')).toBe(false)
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
