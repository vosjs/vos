/**
 * The Trash verbs against a real in-process HTTP server: `vos trash` reads
 * what is there, `vos restore` resolves an id to its kind through that
 * listing, and `vos trash restore --since` undoes one key's deletes. No
 * verb here can empty Trash, and asking for one says where that happens.
 */
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cmdRestore,
  cmdTrash,
  restoreDate,
  sinceMoment,
  trashedBy,
} from '../trash'
import { UsageError } from '../args'
import type { IncomingMessage, Server } from 'node:http'

let server: Server | undefined

const ENTRIES = [
  {
    kind: 'vos',
    id: 'v-1',
    title: 'Launch film',
    deletedAt: '2026-10-02T07:00:00.000Z',
    restoreUntil: '2026-11-01T07:00:00.000Z',
    deletedVia: 'key',
    deletedKeyId: 'key-abc',
    deletedKeyName: 'cli:macbook',
    deletedClient: 'claude-code vos-cli',
    members: null,
  },
  {
    kind: 'folder',
    id: 'f-1',
    title: 'Old kit',
    deletedAt: '2026-10-01T07:00:00.000Z',
    restoreUntil: '2026-10-31T07:00:00.000Z',
    deletedVia: 'session',
    deletedKeyId: null,
    deletedKeyName: null,
    deletedClient: null,
    members: { voses: 3, assets: 2, folders: 0 },
  },
]

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    req.on('data', (c: Buffer) => (text += c.toString()))
    req.on('end', () => resolve(text))
  })
}

function serve(seen: { call: string; body: unknown }[]): Promise<string> {
  let restorePasses = 0
  server = createServer((req, res) => {
    void readBody(req).then((text) => {
      seen.push({
        call: `${req.method} ${req.url}`,
        body: text ? JSON.parse(text) : null,
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url === '/api/trash') {
        res.end(JSON.stringify({ entries: ENTRIES, bytes: 0, bursts: [] }))
      } else if (req.url === '/api/user/whoami') {
        res.end(JSON.stringify({ key: { id: 'key-abc', name: 'cli:macbook' } }))
      } else if (req.url === '/api/trash/restore') {
        restorePasses++
        res.end(
          JSON.stringify({
            restored: [{ kind: 'vos', id: 'v-1' }],
            missing: [],
            // The first answer says public copies are still going back up.
            done: restorePasses > 1,
          }),
        )
      } else {
        res.end('{}')
      }
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

describe('restoreDate: a date, never a duration', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  it('prints the day and month, and the year only when it differs', () => {
    expect(restoreDate('2026-11-01T07:00:00.000Z', now)).toBe('1 Nov')
    expect(restoreDate('2027-01-03T07:00:00.000Z', now)).toBe('3 Jan 2027')
  })
  it('hands back what it cannot read', () => {
    expect(restoreDate('soon', now)).toBe('soon')
  })
})

describe('trashedBy', () => {
  it('names the tool, then the key, then the person', () => {
    expect(trashedBy(ENTRIES[0])).toBe('claude-code vos-cli')
    expect(trashedBy({ ...ENTRIES[0], deletedClient: null })).toBe(
      'cli:macbook',
    )
    expect(trashedBy(ENTRIES[1])).toBe('you')
  })
})

describe('sinceMoment', () => {
  const now = new Date('2026-10-02T12:00:00Z')
  it('reads a duration back from now, or an ISO time', () => {
    expect(sinceMoment('1h', now)?.toISOString()).toBe(
      '2026-10-02T11:00:00.000Z',
    )
    expect(sinceMoment('30m', now)?.toISOString()).toBe(
      '2026-10-02T11:30:00.000Z',
    )
    expect(sinceMoment('2d', now)?.toISOString()).toBe(
      '2026-09-30T12:00:00.000Z',
    )
    expect(sinceMoment('2026-10-01T00:00:00Z', now)?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    )
  })
  it('answers null for anything else', () => {
    expect(sinceMoment('yesterday', now)).toBeNull()
  })
})

describe('vos trash', () => {
  it('lists what is in Trash', async () => {
    const seen: { call: string; body: unknown }[] = []
    const origin = await serve(seen)
    expect(await cmdTrash(['--origin', origin, ...KEY])).toBe(0)
    expect(seen.map((s) => s.call)).toEqual(['GET /api/trash'])
  })

  it('has no verb that empties it, and says where that happens', async () => {
    const origin = await serve([])
    await expect(
      cmdTrash(['empty', '--origin', origin, ...KEY]),
    ).rejects.toThrowError(/vos\.so\/app\/trash/)
  })

  it('restore --since undoes this key’s deletes, and waits for done', async () => {
    const seen: { call: string; body: unknown }[] = []
    const origin = await serve(seen)
    expect(
      await cmdTrash(['restore', '--since', '1h', '--origin', origin, ...KEY]),
    ).toBe(0)
    const posts = seen.filter((s) => s.call === 'POST /api/trash/restore')
    // Asked again until the platform said the restore was finished.
    expect(posts).toHaveLength(2)
    const body = posts[0].body as { keyId: string; since: string }
    expect(body.keyId).toBe('key-abc')
    expect(Number.isNaN(new Date(body.since).getTime())).toBe(false)
  })

  it('restore --since needs a time it can read', async () => {
    const origin = await serve([])
    await expect(
      cmdTrash(['restore', '--since', 'yesterday', '--origin', origin, ...KEY]),
    ).rejects.toThrowError(UsageError)
  })
})

describe('vos restore', () => {
  it('finds the kind of each id in Trash and restores it', async () => {
    const seen: { call: string; body: unknown }[] = []
    const origin = await serve(seen)
    expect(await cmdRestore(['f-1', '--origin', origin, ...KEY])).toBe(0)
    const post = seen.find((s) => s.call === 'POST /api/trash/restore')
    expect(post?.body).toEqual({ ids: [{ kind: 'folder', id: 'f-1' }] })
  })

  it('says so when the id is not in Trash, and restores nothing', async () => {
    const seen: { call: string; body: unknown }[] = []
    const origin = await serve(seen)
    await expect(
      cmdRestore(['v-404', '--origin', origin, ...KEY]),
    ).rejects.toThrowError(/not in Trash/)
    expect(seen.some((s) => s.call.startsWith('POST'))).toBe(false)
  })
})
