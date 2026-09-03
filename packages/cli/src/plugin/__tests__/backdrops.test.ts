import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  backdropBySlug,
  backdropFromKey,
  houseBackdrop,
  inferBackgroundKind,
  openingBackdrop,
} from '../backdrops'
import { UsageError } from '../args'
import type { BackdropRow } from '../backdrops'

// The house backdrop is the SET's first ready loop, read from the platform,
// never a constant here: the studio names its own pick, the CLI follows the
// founder's ordering of the set. Offline, a fresh take opens on a flat
// ground and the command says so.

const SET: BackdropRow[] = [
  {
    slug: 'baking',
    title: 'Baking',
    duration: 8,
    ground: '#000000',
    urls: { '1080p': null, poster: null },
  },
  {
    slug: 'mesh',
    title: 'Mesh',
    duration: 12,
    ground: '#bab8dc',
    urls: {
      '1080p': 'https://assets.example/backdrops/mesh/1080p.webm',
      '2k': 'https://assets.example/backdrops/mesh/2k.webm',
      poster: 'https://assets.example/backdrops/mesh/poster.webp',
    },
  },
  {
    slug: 'soft-beams',
    duration: 10,
    urls: { '1080p': 'https://assets.example/backdrops/soft-beams/1080p.webm' },
  },
]

const MESH = {
  slug: 'mesh',
  key: 'https://assets.example/backdrops/mesh/1080p.webm',
  kind: 'video',
  duration: 12,
  poster: 'https://assets.example/backdrops/mesh/poster.webp',
  ground: '#bab8dc',
}

function stubFetch(
  impl: () => Promise<{ ok: boolean; status: number; json: () => unknown }>,
) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('houseBackdrop', () => {
  it('is the first row with a loop, skipping rows still baking', () => {
    expect(houseBackdrop(SET)).toEqual(MESH)
  })

  it('is null on an empty or loop-less set', () => {
    expect(houseBackdrop([])).toBeNull()
    expect(houseBackdrop([SET[0]])).toBeNull()
  })

  it('a row without a poster or ground carries neither', () => {
    expect(backdropBySlug(SET, 'soft-beams')).toEqual({
      slug: 'soft-beams',
      key: 'https://assets.example/backdrops/soft-beams/1080p.webm',
      kind: 'video',
      duration: 10,
    })
    expect(backdropBySlug(SET, 'baking')).toBeNull()
    expect(backdropBySlug(SET, 'absent')).toBeNull()
  })
})

describe('backdropFromKey', () => {
  it('infers the kind from the extension and gives a video its default period', () => {
    expect(inferBackgroundKind('/bg.webm')).toBe('video')
    expect(inferBackgroundKind('https://x/y.png?v=1')).toBe('image')
    expect(inferBackgroundKind('https://x/opaque')).toBe('video')
    expect(backdropFromKey('/bg.webm')).toEqual({
      key: '/bg.webm',
      kind: 'video',
      duration: 10,
    })
    expect(backdropFromKey('/bg.webm', 4)).toEqual({
      key: '/bg.webm',
      kind: 'video',
      duration: 4,
    })
    expect(backdropFromKey('/still.png')).toEqual({
      key: '/still.png',
      kind: 'image',
    })
  })
})

describe('openingBackdrop', () => {
  it('none is the bare frame and never reads the set', async () => {
    stubFetch(() => Promise.reject(new Error('offline')))
    expect(await openingBackdrop('none', 'https://vos.test')).toEqual({
      backdrop: null,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a URL is taken as given', async () => {
    stubFetch(() => Promise.reject(new Error('offline')))
    expect(
      await openingBackdrop('https://x/loop.mp4', 'https://vos.test'),
    ).toEqual({
      backdrop: { key: 'https://x/loop.mp4', kind: 'video', duration: 10 },
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('absent is the house pick from the set', async () => {
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => ({ backdrops: SET }),
      }),
    )
    expect(await openingBackdrop(undefined, 'https://vos.test/')).toEqual({
      backdrop: MESH,
    })
    expect(fetch).toHaveBeenCalledWith('https://vos.test/api/backdrops')
  })

  it('a slug is that row, refused in words when the set lacks it', async () => {
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => ({ backdrops: SET }),
      }),
    )
    expect(await openingBackdrop('soft-beams', 'https://vos.test')).toEqual({
      backdrop: backdropBySlug(SET, 'soft-beams'),
    })
    await expect(openingBackdrop('nope', 'https://vos.test')).rejects.toThrow(
      UsageError,
    )
    await expect(openingBackdrop('nope', 'https://vos.test')).rejects.toThrow(
      /not in the set \(baking \| mesh \| soft-beams\)/,
    )
  })

  it('offline with nothing asked is the bare frame plus a note; an asked slug is an error', async () => {
    stubFetch(() => Promise.reject(new Error('offline')))
    const r = await openingBackdrop(undefined, 'https://vos.test')
    expect(r.backdrop).toBeNull()
    expect(r.note).toMatch(/could not read the backdrop set/)
    await expect(openingBackdrop('mesh', 'https://vos.test')).rejects.toThrow(
      UsageError,
    )
  })

  it('a set with no ready loop is the bare frame plus a note', async () => {
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => ({ backdrops: [SET[0]] }),
      }),
    )
    const r = await openingBackdrop(undefined, 'https://vos.test')
    expect(r.backdrop).toBeNull()
    expect(r.note).toMatch(/no ready loop/)
  })
})
