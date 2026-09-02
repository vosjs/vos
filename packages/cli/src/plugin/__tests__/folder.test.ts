/**
 * `vos folder` against a real in-process HTTP server — no mocks on the
 * wire (the login.test.ts pattern). The contract under test: --to and
 * --parent resolve slugs against the caller's own shelf, move tries the
 * vos route first and falls back to the asset route on its 404, and a
 * reference to a folder that is not on the shelf is a usage error that
 * names what IS there.
 */
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cmdFolder, recipeLine } from '../folder'
import { UsageError } from '../args'
import type { Server } from 'node:http'

let server: Server | undefined

interface Seen {
  method: string
  url: string
  body: Record<string, unknown> | null
}

const FOLDERS = {
  folders: [
    {
      id: 'f-parent',
      name: 'Official Candidates',
      slug: 'official-candidates',
      parentId: null,
    },
    { id: 'f-velour', name: 'Velour', slug: 'velour', parentId: 'f-parent' },
  ],
}

function serve(seen: Seen[]): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
      })
      const send = (status: number, body: Record<string, unknown>) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      const url = req.url ?? ''
      if (url === '/api/folders' && req.method === 'GET')
        return send(200, FOLDERS)
      if (url === '/api/folders' && req.method === 'POST')
        return send(201, {
          folder: {
            id: 'f-new',
            name: 'New',
            slug: 'new',
            parentId: 'f-parent',
          },
        })
      // The move fallback: vos ids answer 200, anything else 404s here
      // and must land on the asset route.
      if (url.startsWith('/api/vos/') && req.method === 'PATCH')
        return url.includes('vos-1')
          ? send(200, { id: 'vos-1' })
          : send(404, { error: 'Vos not found' })
      if (url.startsWith('/api/assets/') && req.method === 'PATCH')
        return url.includes('asset-1')
          ? send(200, { id: 'asset-1' })
          : send(404, { error: 'Asset not found' })
      // pull: the folder payload, a member's config, a take's doc
      if (url === '/api/folders/f-velour' && req.method === 'GET')
        return send(200, {
          folder: {
            id: 'f-velour',
            name: 'Velour',
            slug: 'velour',
            description: 'Soft sheets.',
          },
          subfolders: [],
          recipes: [
            {
              id: 'r1',
              filename: 'design.md',
              body: '---\napplies: programs\nseed: vos-1\n---\n# Velour\n\nSTATUS: signed off\n',
            },
          ],
          inheritedRecipes: [
            {
              id: 'r0',
              filename: 'taste.md',
              body: '# Taste\n',
              folderSlug: 'official-candidates',
              folderName: 'Official Candidates',
            },
          ],
          voses: [
            {
              id: 'vos-1',
              title: 'Velour One',
              slug: 'velour-one',
              currentVersionId: 'v1',
              hasDoc: false,
            },
            {
              id: 'vos-2',
              title: 'Demo take',
              slug: 'demo-take',
              currentVersionId: 'v2',
              hasDoc: true,
            },
          ],
          assets: [
            {
              id: 'a1',
              filename: 'chair.glb',
              category: 'model',
              fileUrl: '/api/assets/a1/file',
            },
          ],
        })
      if (/^\/api\/vos\/vos-[12]\/config$/.test(url) && req.method === 'GET')
        return send(200, { config: { version: 2, duration: 10 } })
      if (url === '/api/vos/vos-2/versions/v2/doc' && req.method === 'GET')
        return send(200, { version: 1, segments: [] })
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

describe('vos folder', () => {
  it('move resolves --to by slug, PATCHes the vos, and falls back to the asset route on 404', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const code = await cmdFolder([
      'move',
      'vos-1',
      'asset-1',
      '--to',
      'velour',
      '--origin',
      origin,
      ...KEY,
    ])
    expect(code).toBe(0)
    const patches = seen.filter((s) => s.method === 'PATCH')
    expect(patches.map((p) => p.url)).toEqual([
      '/api/vos/vos-1',
      '/api/vos/asset-1',
      '/api/assets/asset-1',
    ])
    for (const p of patches) expect(p.body).toEqual({ folderId: 'f-velour' })
  })

  it('move --to none unfiles (folderId null) and a dead id exits 1', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const code = await cmdFolder([
      'move',
      'nope-1',
      '--to',
      'none',
      '--origin',
      origin,
      ...KEY,
    ])
    expect(code).toBe(1)
    expect(seen.filter((s) => s.method === 'PATCH').length).toBe(2)
    expect(seen.at(-1)?.body).toEqual({ folderId: null })
  })

  it('create resolves --parent by slug into parentId', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const code = await cmdFolder([
      'create',
      'Velour',
      '--parent',
      'official-candidates',
      '--origin',
      origin,
      ...KEY,
    ])
    expect(code).toBe(0)
    const post = seen.find((s) => s.method === 'POST')
    expect(post?.body).toEqual({ name: 'Velour', parentId: 'f-parent' })
  })

  it('an unknown folder reference is a usage error naming the shelf', async () => {
    const origin = await serve([])
    await expect(
      cmdFolder([
        'move',
        'vos-1',
        '--to',
        'no-such',
        '--origin',
        origin,
        ...KEY,
      ]),
    ).rejects.toThrowError(UsageError)
  })

  it('pull writes recipes (own + inherited), every member tracked, and doc.json for takes', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const out = mkdtempSync(join(tmpdir(), 'vos-pull-'))
    try {
      const code = await cmdFolder([
        'pull',
        'velour',
        '--out',
        out,
        '--origin',
        origin,
        ...KEY,
      ])
      expect(code).toBe(0)
      expect(readFileSync(join(out, 'recipes', 'design.md'), 'utf8')).toContain(
        'STATUS: signed off',
      )
      expect(
        existsSync(
          join(out, 'recipes', '_inherited', 'official-candidates', 'taste.md'),
        ),
      ).toBe(true)
      const one = join(out, 'members', 'velour-one')
      expect(
        JSON.parse(readFileSync(join(one, 'config.json'), 'utf8')),
      ).toEqual({
        version: 2,
        duration: 10,
      })
      const tracked = JSON.parse(readFileSync(join(one, 'vos.json'), 'utf8'))
      expect(tracked.vosId).toBe('vos-1')
      expect(tracked.versionId).toBe('v1')
      expect(existsSync(join(one, 'doc.json'))).toBe(false)
      expect(existsSync(join(out, 'members', 'demo-take', 'doc.json'))).toBe(
        true,
      )
      // the doc was fetched only for the take
      expect(
        seen.filter((s) => s.url.endsWith('/doc')).map((s) => s.url),
      ).toEqual(['/api/vos/vos-2/versions/v2/doc'])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('recipeLine prints the hints a recipe declares, and only those', () => {
    expect(
      recipeLine(
        'design.md',
        '---\napplies: programs\nseed: v9\n---\nSTATUS: draft\n',
      ),
    ).toBe('design.md  (applies to programs · starts from v9)')
    expect(recipeLine('taste.md', '# Taste\n')).toBe('taste.md')
  })
})
