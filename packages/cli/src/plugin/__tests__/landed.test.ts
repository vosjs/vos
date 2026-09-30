import { afterEach, describe, expect, it, vi } from 'vitest'
import { landedLines, waitForLanded } from '../landed'

afterEach(() => vi.restoreAllMocks())

function fleet(stillAfter: number, visibility = 'unlisted') {
  let polls = 0
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/thumbnail')) {
      polls += 1
      return {
        ok: polls > stillAfter,
        status: polls > stillAfter ? 200 : 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response
    }
    return {
      status: 200,
      json: async () => ({
        vos: {
          id: 'v1',
          visibility,
          contentUrls: {
            thumbnail: '/api/vos/v1/thumbnail?v=1',
            preview: 'https://assets.vos.so/vos/v1/preview-1.webm',
          },
        },
      }),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return { polls: () => polls }
}

const base = {
  origin: 'https://vos.so/',
  key: 'k',
  vosId: 'v1',
  versionId: 'ver1',
  sleep: async () => {},
}

describe('push --wait', () => {
  it('polls the version still until it lands, then names absolute links', async () => {
    const f = fleet(2)
    const l = await waitForLanded(base)
    expect(f.polls()).toBe(3)
    expect(l.still).toBe(true)
    expect(l.thumbnailUrl).toBe('https://vos.so/api/vos/v1/thumbnail?v=1')
    expect(l.previewUrl).toBe('https://assets.vos.so/vos/v1/preview-1.webm')
    expect(landedLines(l)).toMatch(/still: {3}https:/)
    expect(landedLines(l)).not.toMatch(/private/)
  })

  it('says a private vos links answer only to a credential', async () => {
    fleet(0, 'private')
    const l = await waitForLanded(base)
    expect(l.private).toBe(true)
    expect(landedLines(l)).toMatch(
      /private: these answer 404 without a credential/,
    )
  })

  it('ends in words, not an error, when the render is still to come', async () => {
    fleet(Infinity)
    let t = 0
    const l = await waitForLanded({
      ...base,
      timeoutMs: 10,
      intervalMs: 5,
      now: () => (t += 5),
    })
    expect(l.still).toBe(false)
    expect(l.thumbnailUrl).toBeNull()
    expect(landedLines(l)).toMatch(/not rendered yet/)
  })
})
