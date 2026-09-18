import { afterEach, describe, expect, it, vi } from 'vitest'
import { SINGLE_SHOT_MAX_BYTES, planParts, uploadAsset } from '../uploadAsset'

const MiB = 1024 * 1024
const target = { origin: 'https://vos.so', key: 'vos_sk_test' }

afterEach(() => vi.restoreAllMocks())

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = i % 251
  return b
}

interface Call {
  url: string
  method: string
  body?: unknown
}

/**
 * A platform that plays the chunked door: declaring returns a part size,
 * every part answers with an etag, sealing returns the asset.
 */
function platform(opts: { partBytes?: number; reused?: boolean } = {}) {
  const calls: Call[] = []
  const partBytes = opts.partBytes ?? 16 * MiB
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, body: init.body })
    const json = (status: number, body: unknown) =>
      ({ status, json: async () => body }) as unknown as Response

    if (url.endsWith('/multipart') && method === 'POST') {
      return opts.reused
        ? json(200, {
            id: 'old',
            url: '/api/assets/old/file',
            size: 7,
            reused: true,
          })
        : json(201, { id: 'up1', partBytes, partCount: 3 })
    }
    if (method === 'PUT') {
      const partNumber = Number(url.split('/').pop())
      return json(200, { partNumber, etag: `etag-${partNumber}` })
    }
    if (url.endsWith('/complete')) {
      return json(201, {
        id: 'asset1',
        url: '/api/assets/asset1/file',
        size: 40 * MiB,
      })
    }
    if (url.endsWith('/assets/recording')) {
      return json(201, { id: 'small', url: '/api/assets/small/file', size: 10 })
    }
    return json(200, {})
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls }
}

const opts = {
  filename: 'recording.webm',
  contentType: 'video/webm',
  contentHash: 'a'.repeat(64),
}

describe('planParts', () => {
  it('splits into equal parts with a short tail', () => {
    expect(planParts(40 * MiB, 16 * MiB)).toEqual([
      { partNumber: 1, start: 0, end: 16 * MiB },
      { partNumber: 2, start: 16 * MiB, end: 32 * MiB },
      { partNumber: 3, start: 32 * MiB, end: 40 * MiB },
    ])
  })

  it('covers the file exactly, with no gap and no overlap', () => {
    const total = 301 * MiB + 7
    const parts = planParts(total, 16 * MiB)
    expect(parts[0].start).toBe(0)
    expect(parts.at(-1)?.end).toBe(total)
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].start).toBe(parts[i - 1].end)
    }
  })

  it('has nothing to send for an empty file', () => {
    expect(planParts(0, 16 * MiB)).toEqual([])
  })
})

describe('picking a transport', () => {
  it('sends a small file whole, in one request', async () => {
    const { calls } = platform()
    await uploadAsset(target, bytes(1024), opts)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://vos.so/api/assets/recording')
  })

  it('sends a recording in parts', async () => {
    const { calls } = platform()
    await uploadAsset(target, bytes(SINGLE_SHOT_MAX_BYTES + 1), opts)
    expect(calls.some((c) => c.url.endsWith('/multipart'))).toBe(true)
  })

  it('never puts a whole recording in one request body', async () => {
    // The bug this exists for: a single body past the edge ceiling is
    // refused before it reaches the platform at all.
    const { calls } = platform()
    await uploadAsset(target, bytes(40 * MiB), opts)
    const bodies = calls
      .filter((c) => c.method === 'PUT')
      .map((c) => (c.body as Uint8Array).length)
    expect(bodies.length).toBeGreaterThan(0)
    for (const size of bodies) expect(size).toBeLessThan(100 * MiB)
  })
})

describe('the chunked upload', () => {
  it('declares, sends every part in order, then seals', async () => {
    const { calls } = platform()
    const result = await uploadAsset(target, bytes(40 * MiB), {
      ...opts,
      durationSeconds: 480,
    })

    expect(JSON.parse(calls[0].body as string)).toMatchObject({
      filename: 'recording.webm',
      size: 40 * MiB,
      durationSeconds: 480,
    })
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual([
      'https://vos.so/api/assets/recording/multipart/up1/parts/1',
      'https://vos.so/api/assets/recording/multipart/up1/parts/2',
      'https://vos.so/api/assets/recording/multipart/up1/parts/3',
    ])
    expect(JSON.parse(calls.at(-1)?.body as string)).toEqual({
      parts: [
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: 'etag-2' },
        { partNumber: 3, etag: 'etag-3' },
      ],
    })
    expect(result).toMatchObject({ id: 'asset1', reused: false })
  })

  it('takes the part size from the platform, not from a constant here', async () => {
    // The split can change server-side without a CLI release, and the
    // platform holds each part to exactly the length it implied.
    const { calls } = platform({ partBytes: 10 * MiB })
    // Past the threshold, so it chunks — at the size the platform named.
    await uploadAsset(target, bytes(35 * MiB), opts)
    const sizes = calls
      .filter((c) => c.method === 'PUT')
      .map((c) => (c.body as Uint8Array).length)
    expect(sizes).toEqual([10 * MiB, 10 * MiB, 10 * MiB, 5 * MiB])
  })

  it('sends nothing at all when the platform already has the bytes', async () => {
    const { calls } = platform({ reused: true })
    const result = await uploadAsset(target, bytes(40 * MiB), opts)
    expect(result).toMatchObject({ id: 'old', reused: true })
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  it('reports parts as they land', async () => {
    platform()
    const seen: string[] = []
    await uploadAsset(target, bytes(40 * MiB), {
      ...opts,
      onPart: (done, total) => seen.push(`${done}/${total}`),
    })
    expect(seen).toEqual(['1/3', '2/3', '3/3'])
  })
})

describe('when a part fails', () => {
  it('retries a transient failure rather than losing the take', async () => {
    let tries = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        const json = (status: number, body: unknown) =>
          ({ status, json: async () => body }) as unknown as Response
        if (url.endsWith('/multipart') && method === 'POST') {
          return json(201, { id: 'up1', partBytes: 16 * MiB })
        }
        if (method === 'PUT') {
          const partNumber = Number(url.split('/').pop())
          if (partNumber === 2 && ++tries === 1) return json(503, {})
          return json(200, { partNumber, etag: `etag-${partNumber}` })
        }
        return json(201, { id: 'asset1', url: '/x', size: 1 })
      }),
    )
    const result = await uploadAsset(target, bytes(40 * MiB), opts)
    expect(result.id).toBe('asset1')
    // Sent twice: refused once, then landed.
    expect(tries).toBe(2)
  })

  it('hands the parts back when it cannot finish', async () => {
    const calls: Call[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        calls.push({ url, method })
        const json = (status: number, body: unknown) =>
          ({ status, json: async () => body }) as unknown as Response
        if (url.endsWith('/multipart') && method === 'POST') {
          return json(201, { id: 'up1', partBytes: 16 * MiB })
        }
        if (method === 'PUT') return json(403, { error: 'Account suspended' })
        return json(200, {})
      }),
    )

    await expect(uploadAsset(target, bytes(40 * MiB), opts)).rejects.toThrow(
      'Account suspended',
    )
    expect(
      calls.some(
        (c) =>
          c.method === 'DELETE' &&
          c.url === 'https://vos.so/api/assets/recording/multipart/up1',
      ),
    ).toBe(true)
  })

  it('says what a refusal said, rather than a bare status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            status: 413,
            json: async () => ({ error: 'Recording too large (2.0 GB…)' }),
          }) as unknown as Response,
      ),
    )
    await expect(uploadAsset(target, bytes(40 * MiB), opts)).rejects.toThrow(
      'Recording too large',
    )
  })
})
