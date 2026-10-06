/**
 * `vos pull <program dir>` against a real in-process HTTP server.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cmdPullProgram } from '../program'
import { resetFlagUse, unusedFlags } from '../../flagUse'
import type { Server } from 'node:http'

let server: Server | undefined

function serve(): Promise<string> {
  server = createServer((req, res) => {
    res.writeHead(req.url?.startsWith('/api/vos/v-1/changes') ? 200 : 404, {
      'content-type': 'application/json',
    })
    res.end(JSON.stringify({ head: { id: 'ver-1' }, changes: [] }))
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

beforeEach(resetFlagUse)
afterEach(() => {
  server?.close()
  server = undefined
})

describe('vos pull <program dir>', () => {
  it('reads --check when the vos is already up to date', async () => {
    const origin = await serve()
    const dir = mkdtempSync(join(tmpdir(), 'vos-pull-'))
    writeFileSync(
      join(dir, 'vos.json'),
      JSON.stringify({ vosId: 'v-1', versionId: 'ver-1' }),
    )
    const code = await cmdPullProgram([
      dir,
      '--check',
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
      '--json',
    ])
    expect(code).toBe(0)
    expect(unusedFlags()).not.toContain('check')
  })
})
