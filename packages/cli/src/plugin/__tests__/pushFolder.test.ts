/**
 * Where `vos push --folder` files a created vos, against a real in-process
 * HTTP server (the folder.test.ts pattern). A bare slug or id is the
 * caller's own shelf; a project address, `<handle>/<slug>`, asks the server,
 * which answers CONTINUE for the project's owner and START FROM (a project
 * of their own, made once) for anyone else. The CLI never decides which.
 */
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { projectAddress, resolvePushFolder } from '../folder'
import type { Server } from 'node:http'

let server: Server | undefined

afterEach(async () => {
  await new Promise<void>((done) =>
    server ? server.close(() => done()) : done(),
  )
  server = undefined
})

interface Seen {
  method: string
  path: string
  auth: string | undefined
}

async function serve(
  answer: (path: string) => { status: number; body: unknown },
): Promise<{ origin: string; seen: Seen[] }> {
  const seen: Seen[] = []
  server = createServer((req, res) => {
    seen.push({
      method: req.method ?? '',
      path: req.url ?? '',
      auth: req.headers.authorization,
    })
    const { status, body } = answer(req.url ?? '')
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((done) =>
    server!.listen(0, '127.0.0.1', () => done()),
  )
  const { port } = server!.address() as { port: number }
  return { origin: `http://127.0.0.1:${port}`, seen }
}

describe('projectAddress', () => {
  it('reads a handle and a slug, with or without the @', () => {
    expect(projectAddress('hblee/dances-in-paint')).toEqual({
      handle: 'hblee',
      slug: 'dances-in-paint',
    })
    expect(projectAddress('@Robin_V/House-Loops')).toEqual({
      handle: 'Robin_V',
      slug: 'house-loops',
    })
  })

  it('leaves a bare slug or id to the caller’s own shelf', () => {
    expect(projectAddress('dances-in-paint')).toBeNull()
    expect(projectAddress('3f2c9a1e-0000-4000-8000-000000000000')).toBeNull()
    expect(projectAddress('a/b/c')).toBeNull()
  })
})

describe('resolvePushFolder', () => {
  it('resolves a bare slug on the caller’s own shelf, as before', async () => {
    const { origin, seen } = await serve(() => ({
      status: 200,
      body: {
        folders: [{ id: 'f1', name: 'Mine', slug: 'mine', parentId: null }],
      },
    }))
    const got = await resolvePushFolder(origin, 'vos_key', 'mine')
    expect(got).toEqual({ id: 'f1', note: null })
    expect(seen[0]).toMatchObject({ method: 'GET', path: '/api/folders' })
  })

  it('asks the server for a project address, and continues the owner’s', async () => {
    const { origin, seen } = await serve(() => ({
      status: 200,
      body: {
        target: 'continue',
        folder: { id: 'p1', slug: 'dances-in-paint', name: 'Dances in Paint' },
        source: { name: 'Dances in Paint' },
      },
    }))
    const got = await resolvePushFolder(
      origin,
      'vos_key',
      'hblee/dances-in-paint',
    )
    expect(got).toEqual({ id: 'p1', note: 'continuing Dances in Paint' })
    expect(seen[0]).toEqual({
      method: 'POST',
      path: '/api/folders/public/hblee/dances-in-paint/push-target',
      auth: 'Bearer vos_key',
    })
  })

  it('says when it started the reader’s own copy, recipes copied in', async () => {
    const { origin } = await serve(() => ({
      status: 201,
      body: {
        target: 'start_from',
        created: true,
        recipes: 4,
        folder: {
          id: 'mine',
          slug: 'dances-in-paint-2',
          name: 'Dances in Paint',
        },
        source: { name: 'Dances in Paint' },
      },
    }))
    const got = await resolvePushFolder(
      origin,
      'vos_key',
      'hblee/dances-in-paint',
    )
    expect(got.id).toBe('mine')
    expect(got.note).toBe(
      'starting your own Dances in Paint (dances-in-paint-2), its 4 recipes copied in',
    )
  })

  it('fails in words when the project cannot be read', async () => {
    const { origin } = await serve(() => ({
      status: 404,
      body: { error: 'Project not found' },
    }))
    await expect(
      resolvePushFolder(origin, 'vos_key', 'hblee/private-thing'),
    ).rejects.toThrow(/hblee\/private-thing/)
  })
})
