import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../run'

/**
 * `vos record` refuses a step that spends before a browser opens: a
 * guarded step the command does not name, a `--confirm` that names
 * nothing, and on `--hosted` any guarded step or download at all.
 */
async function script(steps: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vos-confirm-'))
  const file = join(dir, 'actions.json')
  await writeFile(file, JSON.stringify({ url: 'http://127.0.0.1:9/', steps }))
  return file
}

function stderr(): { text: () => string } {
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  return {
    text: () => spy.mock.calls.map((c) => String(c[0])).join(''),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

const GUARDED = [
  { id: 'generate', do: 'click', selector: '#gen', guard: 'spend' },
]

describe('vos record --confirm', () => {
  it('refuses a guarded step the command does not name, before any browser', async () => {
    const file = await script(GUARDED)
    const err = stderr()
    const code = await run([
      'record',
      '--actions',
      file,
      '--out',
      join(tmpdir(), 'never'),
    ])
    expect(code).toBe(2)
    expect(err.text()).toContain('#0 generate (click) is guarded (spend)')
    expect(err.text()).toContain('Add --confirm generate')
  })

  it('refuses a --confirm that names no guarded step', async () => {
    const file = await script(GUARDED)
    const err = stderr()
    const code = await run([
      'record',
      '--actions',
      file,
      '--confirm',
      'generate',
      '--confirm',
      'genrate',
    ])
    expect(code).toBe(2)
    expect(err.text()).toContain('--confirm genrate names no guarded step')
  })

  it('refuses a guarded step and a download on --hosted, in words', async () => {
    const file = await script([...GUARDED, { do: 'download', selector: '#dl' }])
    const err = stderr()
    const code = await run(['record', '--hosted', '--actions', file])
    expect(code).toBe(2)
    expect(err.text()).toContain('a hosted take cannot run this script')
    expect(err.text()).toContain('has no way to confirm it')
    expect(err.text()).toContain('a hosted take does not keep')
  })
})
