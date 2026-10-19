import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileInRoot, saveNameOk, startTakeServer } from '../server'

/**
 * The take server is a door onto a directory on the person's machine, so
 * it has three locks: it listens on loopback alone; a page on another
 * origin reads only through the tokened base `vos open` hands the studio,
 * never a bare path; and nothing it serves or writes leaves the take
 * directory.
 */
const outside = mkdtempSync(join(tmpdir(), 'vos-outside-'))
writeFileSync(join(outside, 'secret.txt'), 'not yours')
const dir = mkdtempSync(join(tmpdir(), 'vos-take-doors-'))
writeFileSync(join(dir, 'doc.json'), '{"source":{"kind":"video"}}')
mkdirSync(join(dir, 'media'))
writeFileSync(join(dir, 'media', 'mark.png'), Buffer.alloc(16, 2))
symlinkSync(join(outside, 'secret.txt'), join(dir, 'link.txt'))
const serverP = startTakeServer(dir, { '/page.html': '<p>page</p>' })

afterAll(async () => (await serverP).close())

describe('the take server listens on loopback with a tokened base', () => {
  it('binds 127.0.0.1 and hands out a base with a token in its path', async () => {
    const { base } = await serverP
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/t\/[0-9a-f]{32}$/)
  })

  it('answers the studio through the tokened base, for files and pages alike', async () => {
    const { base } = await serverP
    const doc = await fetch(`${base}/doc.json`, {
      headers: { origin: 'https://vos.so', 'sec-fetch-site': 'cross-site' },
    })
    expect(doc.status).toBe(200)
    expect(doc.headers.get('access-control-allow-origin')).toBe('*')
    const page = await fetch(`${base}/page.html`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(page.status).toBe(200)
    expect(await page.text()).toBe('<p>page</p>')
    const nested = await fetch(`${base}/media/mark.png`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(nested.status).toBe(200)
  })

  it('refuses a bare path to a page on another origin', async () => {
    const { base } = await serverP
    const origin = new URL(base).origin
    for (const site of ['cross-site', 'same-site']) {
      const res = await fetch(`${origin}/doc.json`, {
        headers: { origin: 'http://localhost:3000', 'sec-fetch-site': site },
      })
      expect(res.status, site).toBe(404)
    }
    const wrongToken = await fetch(`${origin}/t/${'0'.repeat(32)}/doc.json`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(wrongToken.status).toBe(404)
  })

  it("keeps the bare paths for the server's own pages and a person at the address bar", async () => {
    const { base } = await serverP
    const origin = new URL(base).origin
    for (const site of ['same-origin', 'none']) {
      const res = await fetch(`${origin}/doc.json`, {
        headers: { 'sec-fetch-site': site },
      })
      expect(res.status, site).toBe(200)
    }
  })
})

describe('nothing leaves the take directory', () => {
  it('serves no file above the root, however the path is spelled', async () => {
    const { base } = await serverP
    const origin = new URL(base).origin
    for (const path of [
      '/../secret.txt',
      '/..%2f..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      '/media/../../secret.txt',
      '/link.txt',
    ]) {
      const res = await fetch(`${origin}${path}`, {
        headers: { 'sec-fetch-site': 'none' },
      })
      expect(res.status, path).toBe(404)
    }
    expect(fileInRoot(dir, '/doc.json')).toContain('doc.json')
    expect(fileInRoot(dir, '/link.txt')).toBeNull()
    expect(fileInRoot(dir, '/%zz')).toBeNull()
  })

  it('writes only a plain file name from its own pages', async () => {
    const { base } = await serverP
    const origin = new URL(base).origin
    const put = (path: string, site: string) =>
      fetch(`${origin}${path}`, {
        method: 'POST',
        body: 'x',
        headers: { 'sec-fetch-site': site },
      })
    expect((await put('/save?name=out.webm', 'same-origin')).status).toBe(200)
    expect((await put('/save?name=doc.json', 'same-origin')).status).toBe(404)
    expect((await put('/save?name=.env', 'same-origin')).status).toBe(404)
    expect((await put('/save?name=out.webm', 'cross-site')).status).toBe(404)
    expect((await put(`/t/x/save?name=a.png`, 'cross-site')).status).toBe(404)
    for (const name of ['frame-1.png', 'render-chunk-3.tmp', 'recording.webm'])
      expect(saveNameOk(name), name).toBe(true)
    for (const name of ['../x', 'a/b.png', '.hidden', 'meta.json', ''])
      expect(saveNameOk(name), name).toBe(false)
  })
})
