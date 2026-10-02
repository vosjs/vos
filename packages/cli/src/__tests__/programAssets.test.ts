import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASSET_ROUTE,
  hostedAssetId,
  manifestRefs,
  missingManifestFiles,
  programAssets,
} from '../programAssets'
import type { Server } from 'node:http'

/**
 * A local run of a program reads the files it declares. A capture page has
 * its own origin, so a path beside the config and a hosted asset are both
 * made reachable here; what cannot be reached is said, never a silent blank.
 */
const ID = '7d1e2f3a-0b9c-4d5e-8f6a-1b2c3d4e5f60'
let server: Server | undefined
afterEach(() => {
  server?.close()
  server = undefined
})

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-assets-'))
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

function serve(
  seen: { url: string; auth: string | undefined }[],
  status = 200,
): Promise<string> {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', auth: req.headers.authorization })
    res.writeHead(status, { 'content-type': 'image/png' })
    res.end(status === 200 ? 'PNGBYTES' : '')
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

describe('hostedAssetId', () => {
  it('reads every spelling of a hosted file, and nothing else', () => {
    expect(hostedAssetId(`asset:${ID}`)).toBe(ID)
    expect(hostedAssetId(`/api/assets/${ID}/file`)).toBe(ID)
    expect(hostedAssetId(`https://vos.so/api/assets/${ID}/file?v=2`)).toBe(ID)
    expect(hostedAssetId('./logo.png')).toBeNull()
    expect(hostedAssetId('asset:logo')).toBeNull()
    expect(hostedAssetId('https://example.com/a.png')).toBeNull()
  })
})

describe('programAssets', () => {
  it('is null for a program that declares nothing', async () => {
    const log: string[] = []
    expect(
      await programAssets({}, { baseDir: '.', log: (l) => log.push(l) }),
    ).toBeNull()
    expect(log).toEqual([])
  })

  it('serves a file beside the config, and a list in its order', async () => {
    const dir = dirWith({
      'logo.png': 'a',
      'shots/1.png': 'b',
      'shots/2.png': 'c',
    })
    const got = await programAssets(
      {
        assets: {
          logo: { ref: './logo.png' },
          shots: { ref: ['shots/1.png', 'shots/2.png'] },
        },
      },
      { baseDir: dir, log: () => {} },
    )
    const logo = got!.assets.logo as string
    expect(logo.startsWith(ASSET_ROUTE)).toBe(true)
    expect(logo.endsWith('/logo.png')).toBe(true)
    expect(got!.files[logo]).toBe(join(dir, 'logo.png'))
    const shots = got!.assets.shots as string[]
    expect(shots.map((s) => got!.files[s])).toEqual([
      join(dir, 'shots/1.png'),
      join(dir, 'shots/2.png'),
    ])
  })

  it('gives two files that share a name two paths', async () => {
    const dir = dirWith({ 'a/x.png': '1', 'b/x.png': '2' })
    const got = await programAssets(
      { assets: { one: { ref: 'a/x.png' }, two: { ref: 'b/x.png' } } },
      { baseDir: dir, log: () => {} },
    )
    expect(got!.assets.one).not.toBe(got!.assets.two)
  })

  it('uses a URL as it is', async () => {
    const got = await programAssets(
      { assets: { hdr: { ref: 'https://assets.vos.so/hdr/x.hdr' } } },
      { baseDir: '.', log: () => {} },
    )
    expect(got).toEqual({
      assets: { hdr: 'https://assets.vos.so/hdr/x.hdr' },
      files: {},
    })
  })

  it('says so when a path names no file, and keeps the ref', async () => {
    const log: string[] = []
    const got = await programAssets(
      { assets: { logo: { ref: './gone.png' } } },
      { baseDir: dirWith({}), log: (l) => log.push(l) },
    )
    expect(got!.assets.logo).toBe('./gone.png')
    expect(log[0]).toContain('assets.logo names ./gone.png')
  })

  it('downloads a hosted file once, with the key, and serves the copy', async () => {
    const seen: { url: string; auth: string | undefined }[] = []
    const origin = await serve(seen)
    const cacheDir = mkdtempSync(join(tmpdir(), 'vos-cache-'))
    const opts = { baseDir: '.', origin, key: 'vos_k', cacheDir, log: () => {} }
    const config = { assets: { logo: { ref: `asset:${ID}` } } }
    const first = await programAssets(config, opts)
    const second = await programAssets(config, opts)
    expect(seen).toEqual([
      { url: `/api/assets/${ID}/file`, auth: 'Bearer vos_k' },
    ])
    const url = first!.assets.logo as string
    expect(first!.files[url]).toBe(join(cacheDir, ID))
    expect(second!.assets.logo).toBe(url)
  })

  it('says a hosted file needs a credential, or could not be read', async () => {
    const log: string[] = []
    const config = { assets: { logo: { ref: `asset:${ID}` } } }
    const cacheDir = mkdtempSync(join(tmpdir(), 'vos-cache-'))
    const none = await programAssets(config, {
      baseDir: '.',
      cacheDir,
      log: (l) => log.push(l),
    })
    expect(none!.assets.logo).toBe(`asset:${ID}`)
    expect(log[0]).toContain('no credential is set')

    const origin = await serve([], 404)
    await programAssets(config, {
      baseDir: '.',
      origin,
      key: 'vos_k',
      cacheDir,
      log: (l) => log.push(l),
    })
    expect(log[1]).toContain('could not be read (404)')
  })
})

describe('manifestRefs and missingManifestFiles', () => {
  it('walks single refs and lists, and ignores a malformed manifest', () => {
    expect(
      manifestRefs({ assets: { a: { ref: 'x' }, b: { ref: ['y', 'z'] } } }),
    ).toEqual([
      { name: 'a', index: null, ref: 'x' },
      { name: 'b', index: 0, ref: 'y' },
      { name: 'b', index: 1, ref: 'z' },
    ])
    expect(manifestRefs({ assets: [] })).toEqual([])
    expect(manifestRefs({})).toEqual([])
  })

  it('names only the paths that are not files', () => {
    const dir = dirWith({ 'here.png': 'x' })
    expect(
      missingManifestFiles(
        {
          assets: {
            here: { ref: './here.png' },
            gone: { ref: ['./here.png', './gone.png'] },
            hosted: { ref: `asset:${ID}` },
            url: { ref: 'https://example.com/a.png' },
          },
        },
        dir,
      ),
    ).toEqual([
      'assets.gone[1] names ./gone.png, which is not a file beside the config',
    ])
  })
})
