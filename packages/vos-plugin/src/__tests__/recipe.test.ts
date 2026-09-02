/**
 * `vos recipe push` against a real in-process HTTP server (the
 * asset.test.ts pattern). The contract under test: --folder resolves a slug
 * through the folder list and POSTs the file as multipart, filed into that
 * folder; --asset PUTs the raw markdown to the file route; a non-.md file
 * and a missing/ambiguous target are usage errors; a server refusal
 * surfaces with its reason.
 */
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cmdRecipe } from '../recipe'
import { UsageError } from '../args'
import type { Server } from 'node:http'

let server: Server | undefined

interface Seen {
  method: string
  url: string
  contentType: string
  body: string
}

function serve(seen: Seen[]): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const contentType = String(req.headers['content-type'] ?? '')
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        contentType,
        body,
      })
      const send = (status: number, payload: Record<string, unknown>) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const url = req.url ?? ''
      if (url === '/api/folders' && req.method === 'GET') {
        return send(200, {
          folders: [
            { id: 'folder-1', name: 'Louver', slug: 'louver', parentId: null },
          ],
        })
      }
      if (url === '/api/assets/upload' && req.method === 'POST') {
        if (!body.includes('name="folderId"')) {
          return send(400, { error: 'Folder not found' })
        }
        return send(201, {
          id: 'asset-9',
          filename: 'design.md',
          metadata: { name: 'louver-design', description: 'Slatted light.' },
        })
      }
      if (url === '/api/assets/asset-1/file' && req.method === 'PUT') {
        return send(200, { id: 'asset-1', filename: 'design.md' })
      }
      if (url === '/api/assets/asset-img/file' && req.method === 'PUT') {
        return send(400, {
          error: 'Only recipe files can be replaced in place',
        })
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
const MD = '---\nname: louver-design\n---\n\nSlatted light.\n'

function tmpFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-recipe-'))
  const p = join(dir, name)
  writeFileSync(p, MD)
  return p
}

describe('vos recipe push', () => {
  it('--folder resolves the slug and POSTs the file as multipart into it', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const code = await cmdRecipe([
      'push',
      tmpFile('design.md'),
      '--folder',
      'louver',
      '--origin',
      origin,
      ...KEY,
    ])
    expect(code).toBe(0)
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'GET /api/folders',
      'POST /api/assets/upload',
    ])
    const upload = seen[1]
    expect(upload.contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(upload.body).toContain('name="file"; filename="design.md"')
    expect(upload.body).toContain('name="folderId"')
    expect(upload.body).toContain('folder-1')
    expect(upload.body).toContain('Slatted light.')
  })

  it('--asset PUTs the raw markdown to the file route', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const code = await cmdRecipe([
      'push',
      tmpFile('design.md'),
      '--asset',
      'asset-1',
      '--origin',
      origin,
      ...KEY,
    ])
    expect(code).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].method).toBe('PUT')
    expect(seen[0].url).toBe('/api/assets/asset-1/file')
    expect(seen[0].contentType).toBe('text/markdown')
    expect(seen[0].body).toBe(MD)
  })

  it('a server refusal surfaces with the reason', async () => {
    const origin = await serve([])
    await expect(
      cmdRecipe([
        'push',
        tmpFile('design.md'),
        '--asset',
        'asset-img',
        '--origin',
        origin,
        ...KEY,
      ]),
    ).rejects.toThrowError(/Only recipe files/)
  })

  it('a non-.md file, a missing target, both targets, and unknown subcommands are usage errors', async () => {
    await expect(
      cmdRecipe(['push', tmpFile('notes.txt'), '--folder', 'louver', ...KEY]),
    ).rejects.toThrowError(UsageError)
    await expect(
      cmdRecipe(['push', tmpFile('design.md'), ...KEY]),
    ).rejects.toThrowError(UsageError)
    await expect(
      cmdRecipe([
        'push',
        tmpFile('design.md'),
        '--folder',
        'louver',
        '--asset',
        'asset-1',
        ...KEY,
      ]),
    ).rejects.toThrowError(UsageError)
    await expect(cmdRecipe(['pull', 'asset-1'])).rejects.toThrowError(
      UsageError,
    )
  })
})
