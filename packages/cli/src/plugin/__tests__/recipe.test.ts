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
import { uploadDoor } from './uploadDoor'
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
  // A recipe an agent files is stored under the CAPS convention: the
  // platform names it, and the verb reports the name that landed.
  const door = uploadDoor((declared) => ({
    id: 'asset-9',
    kind: 'recipe',
    filename: String(declared.filename).replace(
      /^(.*)\.md$/,
      (_, stem) => `${String(stem).toUpperCase()}.md`,
    ),
    metadata: { name: 'louver-design', description: 'Slatted light.' },
  }))
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
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(body) as Record<string, unknown>
      } catch {
        // a part's body is the file's bytes, not JSON
      }
      const upload = door(req.method ?? '', url, json)
      if (upload) return send(upload.status, upload.payload)
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
  it('--folder resolves the slug and files the recipe through the upload door', async () => {
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
      'POST /api/assets/uploads',
      'PUT /api/assets/uploads/up-1/parts/1',
      'POST /api/assets/uploads/up-1/complete',
    ])
    expect(JSON.parse(seen[1].body)).toMatchObject({
      filename: 'design.md',
      folderId: 'folder-1',
      intent: 'library',
      size: Buffer.byteLength(MD),
    })
    // The part is the file itself, byte for byte.
    expect(seen[2].body).toBe(MD)
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
