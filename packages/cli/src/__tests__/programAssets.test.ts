import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASSET_ROUTE,
  hostedAssetId,
  localFile,
  manifestRefs,
  serveFile,
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
  // The real path: the resolver answers with links resolved, and the OS
  // temp dir is itself a link on some systems.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vos-assets-')))
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
    expect(
      hostedAssetId(`https://vos.so/api/assets/${ID}/file?v=2`, [
        'https://vos.so',
      ]),
    ).toBe(ID)
    // The same path on a host that is not home is someone else's URL.
    expect(hostedAssetId(`https://vos.so/api/assets/${ID}/file`)).toBeNull()
    expect(
      hostedAssetId(`https://other.example/api/assets/${ID}/file`, [
        'https://vos.so',
      ]),
    ).toBeNull()
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
    expect(logo.endsWith('.png')).toBe(true)
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
    // The served type names the copy's extension, so the page is told
    // what it got.
    expect(first!.files[url]).toBe(join(cacheDir, `${ID}.png`))
    expect(url.endsWith('.png')).toBe(true)
    expect(second!.assets.logo).toBe(url)
    expect(readdirSync(cacheDir)).toEqual([`${ID}.png`])
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

describe('a manifest path reaches only into the program’s own directory', () => {
  // A program's code runs in a page and can send what it is served
  // anywhere. So a config cannot name a file outside its own directory and
  // have a render, a preview or a push carry it out.
  const outside = dirWith({ 'secret.txt': 'k', 'program/in.png': 'p' })
  const program = join(outside, 'program')

  it('a file in the directory or below is the program’s', () => {
    expect(localFile('./in.png', program)).toEqual({
      file: join(program, 'in.png'),
    })
  })

  it('a path that climbs out is refused, relative or absolute', () => {
    for (const ref of ['../secret.txt', join(outside, 'secret.txt')]) {
      const got = localFile(ref, program)
      expect('refused' in got && got.refused).toContain(
        "outside the program's directory",
      )
    }
  })

  it('a link inside the directory that points out is refused too', () => {
    symlinkSync(join(outside, 'secret.txt'), join(program, 'looks-local.png'))
    const got = localFile('./looks-local.png', program)
    expect('refused' in got).toBe(true)
  })

  it('a sibling directory that only starts with the same name is outside', () => {
    const sibling = `${program}-other`
    mkdirSync(sibling)
    writeFileSync(join(sibling, 'x.png'), 'x')
    expect('refused' in localFile(join(sibling, 'x.png'), program)).toBe(true)
  })

  it('a config loaded from a URL reads no local file at all', () => {
    const got = localFile('./in.png', null)
    expect('refused' in got && got.refused).toContain('loaded from a URL')
  })

  it('a render serves none of them, and says why', async () => {
    const log: string[] = []
    const got = await programAssets(
      {
        assets: {
          ok: { ref: './in.png' },
          up: { ref: '../secret.txt' },
          abs: { ref: join(outside, 'secret.txt') },
        },
      },
      { baseDir: program, log: (l) => log.push(l) },
    )
    expect(Object.values(got!.files)).toEqual([join(program, 'in.png')])
    expect(got!.assets.up).toBe('../secret.txt')
    expect(log).toHaveLength(2)
    expect(log[0]).toContain('assets.up names ../secret.txt')
    expect(log[0]).toContain("outside the program's directory")

    const fromUrl = await programAssets(
      { assets: { ok: { ref: './in.png' } } },
      { baseDir: null, log: (l) => log.push(l) },
    )
    expect(fromUrl!.files).toEqual({})
    expect(log[2]).toContain('loaded from a URL')
  })

  it('the check names a path that climbs out', () => {
    expect(
      missingManifestFiles(
        { assets: { up: { ref: '../secret.txt' } } },
        program,
      ),
    ).toEqual([
      expect.stringContaining(
        'assets.up names ../secret.txt, which is outside',
      ),
    ])
  })
})

describe('a file name never reaches the URL the page asks for', () => {
  it('a space or an accent in a name still loads', async () => {
    const dir = dirWith({ 'Screen Shot 9.41 AM.png': 'a', 'café#1.png': 'b' })
    const got = await programAssets(
      {
        assets: {
          shot: { ref: './Screen Shot 9.41 AM.png' },
          cafe: { ref: './café#1.png' },
        },
      },
      { baseDir: dir, log: () => {} },
    )
    for (const url of Object.values(got!.assets) as string[]) {
      // What a browser asks for is exactly the key the table holds.
      expect(new URL(`https://x${url}`).pathname).toBe(url)
      expect(got!.files[url]).toBeDefined()
    }
  })
})

describe('a half-written download is never served as the file', () => {
  it('a leftover .part is ignored and the file is fetched again', async () => {
    const seen: { url: string; auth: string | undefined }[] = []
    const origin = await serve(seen)
    const cacheDir = mkdtempSync(join(tmpdir(), 'vos-cache-'))
    writeFileSync(join(cacheDir, `${ID}.png.part`), 'trunc')
    const got = await programAssets(
      { assets: { logo: { ref: `asset:${ID}` } } },
      { baseDir: null, origin, key: 'k', cacheDir, log: () => {} },
    )
    expect(seen).toHaveLength(1)
    expect(Object.values(got!.files)).toEqual([join(cacheDir, `${ID}.png`)])
  })

  it('a hosted file spelled as its absolute URL is read with the key too', async () => {
    const seen: { url: string; auth: string | undefined }[] = []
    const origin = await serve(seen)
    const got = await programAssets(
      { assets: { logo: { ref: `${origin}/api/assets/${ID}/file` } } },
      {
        baseDir: null,
        origin,
        key: 'k',
        cacheDir: mkdtempSync(join(tmpdir(), 'vos-cache-')),
        log: () => {},
      },
    )
    expect(seen).toEqual([{ url: `/api/assets/${ID}/file`, auth: 'Bearer k' }])
    expect((got!.assets.logo as string).startsWith(ASSET_ROUTE)).toBe(true)
  })
})

describe('serveFile', () => {
  const dir = dirWith({ 'clip.webm': '0123456789', 'mark.svg': '<svg/>' })
  const clip = join(dir, 'clip.webm')

  it('answers the whole file with its type and says it takes ranges', () => {
    const got = serveFile(clip)
    expect(got.status).toBe(200)
    expect(got.headers['content-type']).toBe('video/webm')
    expect(got.headers['accept-ranges']).toBe('bytes')
    expect(got.body.toString()).toBe('0123456789')
    expect(serveFile(join(dir, 'mark.svg')).headers['content-type']).toBe(
      'image/svg+xml',
    )
  })

  it('answers a range with 206, which a seeking video element needs', () => {
    const mid = serveFile(clip, 'bytes=2-5')
    expect(mid.status).toBe(206)
    expect(mid.headers['content-range']).toBe('bytes 2-5/10')
    expect(mid.body.toString()).toBe('2345')
    expect(serveFile(clip, 'bytes=7-').body.toString()).toBe('789')
    expect(serveFile(clip, 'bytes=-3').body.toString()).toBe('789')
    // An end past the file is clamped, as the spec says.
    expect(serveFile(clip, 'bytes=8-99').headers['content-range']).toBe(
      'bytes 8-9/10',
    )
  })

  it('refuses a range that starts past the end', () => {
    const got = serveFile(clip, 'bytes=10-12')
    expect(got.status).toBe(416)
    expect(got.headers['content-range']).toBe('bytes */10')
  })
})

describe('manifestRefs and missingManifestFiles', () => {
  it('drops a name that is not an identifier, whatever sent it', () => {
    // A fetched document's own config never passed a schema. A name
    // becomes a file name when files come home, so it is held here.
    expect(
      manifestRefs({
        assets: {
          '../../src/logo': { ref: 'x' },
          'a/b': { ref: 'x' },
          '': { ref: 'x' },
          ok_1: { ref: ['y', 7] },
          nul: null,
        },
      }),
    ).toEqual([{ name: 'ok_1', index: 0, ref: 'y' }])
  })

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
