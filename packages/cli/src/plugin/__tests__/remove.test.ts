/**
 * `vos delete` against a real in-process HTTP server: it deletes only when
 * told to (headless needs --yes), reads the title to name what it deletes,
 * and unlinks a directory that tracked the vos.
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cmdDelete } from '../remove'
import { UsageError } from '../args'
import type { Server } from 'node:http'

let server: Server | undefined

function serve(seen: string[]): Promise<string> {
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    res.writeHead(req.url === '/api/vos/v-9' ? 200 : 404, {
      'content-type': 'application/json',
    })
    res.end(
      JSON.stringify(
        req.method === 'DELETE'
          ? { ok: true }
          : { vos: { id: 'v-9', title: 'Motion reel' } },
      ),
    )
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

describe('vos delete', () => {
  it('refuses headless without --yes, and deletes nothing', async () => {
    const seen: string[] = []
    const origin = await serve(seen)
    await expect(
      cmdDelete(['v-9', '--origin', origin, ...KEY]),
    ).rejects.toThrowError(/--yes/)
    expect(seen.some((s) => s.startsWith('DELETE'))).toBe(false)
  })

  it('deletes with --yes and unlinks the directory that tracked it', async () => {
    const seen: string[] = []
    const origin = await serve(seen)
    const dir = mkdtempSync(join(tmpdir(), 'vos-delete-'))
    writeFileSync(join(dir, 'vos.json'), JSON.stringify({ vosId: 'v-9' }))
    const code = await cmdDelete([dir, '--yes', '--origin', origin, ...KEY])
    expect(code).toBe(0)
    expect(seen).toContain('DELETE /api/vos/v-9')
    expect(existsSync(join(dir, 'vos.json'))).toBe(false)
  })

  it('a directory that tracks nothing is a usage error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-delete-'))
    await expect(
      cmdDelete([dir, '--yes', '--origin', 'http://127.0.0.1:1', ...KEY]),
    ).rejects.toThrowError(UsageError)
  })
})
