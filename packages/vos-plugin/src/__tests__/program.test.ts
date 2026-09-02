/**
 * createProgramVos against a real in-process HTTP server (the
 * login.test.ts pattern). The contract under test: the create body carries
 * everything the caller filed (description, tags, folderId, remixOfId,
 * client attribution, private visibility), a derived slug retries on 409,
 * and a caller-CHOSEN slug never retries — the collision surfaces.
 */
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createProgramVos } from '../program'
import type { Server } from 'node:http'

let server: Server | undefined

interface Seen {
  method: string
  url: string
  body: Record<string, unknown>
}

function serve(seen: Seen[], conflictFirst = 0): Promise<string> {
  let conflicts = conflictFirst
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      seen.push({ method: req.method ?? '', url: req.url ?? '', body })
      const send = (status: number, out: Record<string, unknown>) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(out))
      }
      if (conflicts > 0) {
        conflicts--
        return send(409, { error: 'slug taken' })
      }
      send(201, {
        vos: { id: 'vos-new', slug: body.slug, currentVersionId: 'ver-1' },
      })
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

describe('createProgramVos', () => {
  it('sends the full create body: metadata, filing, lineage, attribution', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const out = await createProgramVos({
      origin,
      key: 'vos_sk_test',
      config: { version: 2 },
      title: 'Chiffon Iris',
      slug: 'chiffon-iris',
      description: 'Sheer bands.',
      tags: ['shader', 'loop'],
      folderId: 'f-chiffon',
      remixOfId: 'vos-src',
    })
    expect(out).toEqual({
      id: 'vos-new',
      slug: 'chiffon-iris',
      currentVersionId: 'ver-1',
    })
    const body = seen[0].body
    expect(seen[0].url).toBe('/api/vos')
    expect(body.title).toBe('Chiffon Iris')
    expect(body.visibility).toBe('private')
    expect(body.description).toBe('Sheer bands.')
    expect(body.tags).toEqual(['shader', 'loop'])
    expect(body.folderId).toBe('f-chiffon')
    expect(body.remixOfId).toBe('vos-src')
    expect(typeof body.client).toBe('string')
  })

  it('retries a DERIVED slug on 409 with a numbered suffix', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen, 1)
    const out = await createProgramVos({
      origin,
      key: 'vos_sk_test',
      config: {},
      title: 'Aurora Veil',
    })
    expect(seen.map((s) => s.body.slug)).toEqual([
      'aurora-veil',
      'aurora-veil-2',
    ])
    expect(out.slug).toBe('aurora-veil-2')
  })

  it('never retries a caller-chosen slug — the collision surfaces', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen, 1)
    await expect(
      createProgramVos({
        origin,
        key: 'vos_sk_test',
        config: {},
        title: 'Aurora Veil',
        slug: 'aurora-veil',
      }),
    ).rejects.toThrowError(/409/)
    expect(seen.length).toBe(1)
  })
})
