import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTakeServer } from '../server'

/**
 * `vos open` hands the take to the studio at vos.so (AN1), a different
 * origin, so every response the take server gives must be readable from
 * there: the doc, the recording's whole body, and the recording's RANGE
 * requests, which the studio's video element makes on its own. A server
 * that opened only the doc would show an editor with a black canvas.
 */
const dir = mkdtempSync(join(tmpdir(), 'vos-take-server-'))
writeFileSync(join(dir, 'doc.json'), '{"source":{"kind":"video"}}')
writeFileSync(join(dir, 'recording.webm'), Buffer.alloc(4096, 1))
const serverP = startTakeServer(dir, {})

afterAll(async () => (await serverP).close())

describe('the take server answers the studio at vos.so', () => {
  it('opens every response to any origin, vos.so included', async () => {
    const { base } = await serverP
    for (const origin of ['https://vos.so', 'http://localhost:6060']) {
      const res = await fetch(`${base}/doc.json`, { headers: { origin } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    }
  })

  it('keeps the header on a Range request of the recording', async () => {
    const { base } = await serverP
    const res = await fetch(`${base}/recording.webm`, {
      headers: { origin: 'https://vos.so', range: 'bytes=0-1023' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('content-range')).toBe('bytes 0-1023/4096')
    expect((await res.arrayBuffer()).byteLength).toBe(1024)
  })

  it('answers the private-network preflight older Chromes send before a loopback fetch', async () => {
    const { base } = await serverP
    const res = await fetch(`${base}/doc.json`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://vos.so',
        'access-control-request-method': 'GET',
        'access-control-request-private-network': 'true',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-private-network')).toBe('true')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
    // And the header rides every ordinary response too.
    const get = await fetch(`${base}/doc.json`, {
      headers: { origin: 'https://vos.so' },
    })
    expect(get.headers.get('access-control-allow-private-network')).toBe('true')
  })

  it('and on a miss, so a probe from the studio reads the 404 rather than a CORS error', async () => {
    const { base } = await serverP
    const res = await fetch(`${base}/nope.json`, {
      headers: { origin: 'https://vos.so' },
    })
    expect(res.status).toBe(404)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
