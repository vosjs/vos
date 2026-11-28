/**
 * The verbs that run a script, through the command line: each refuses
 * what the script reaches for before a browser opens or the desktop is
 * touched, as a usage error naming the flag that grants it. The addresses
 * here answer nothing, so a verb that got past the refusal would fail
 * another way.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { run } from '../run'

let dir = ''
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vos-script-reach-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function script(name: string, body: unknown): Promise<string> {
  const file = join(dir, `${name}.json`)
  await writeFile(file, JSON.stringify(body))
  return file
}

async function vos(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((s: string | Uint8Array) => {
      out.push(String(s))
      return true
    })
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((s: string | Uint8Array) => {
      err.push(String(s))
      return true
    })
  try {
    const code = await run(argv)
    return { code, said: out.join('') + err.join('') }
  } finally {
    stdout.mockRestore()
    stderr.mockRestore()
  }
}

const NOWHERE = 'http://127.0.0.1:9/'
const READS_ENV = {
  url: NOWHERE,
  setup: [
    { do: 'type', selector: '#pw', text: { env: 'VOS_TEST_REACH_SECRET' } },
  ],
  steps: [{ do: 'wait', ms: 10 }],
}
const RUNS_JS = {
  url: NOWHERE,
  steps: [{ do: 'expect', js: 'document.cookie.length > 0' }],
}

describe('every verb that runs a script settles its reach first', () => {
  it('record and create refuse a shell variable nobody passed', async () => {
    const file = await script('env', READS_ENV)
    for (const verb of ['record', 'create']) {
      const r = await vos([verb, '--actions', file, '--out', join(dir, verb)])
      expect(r.code, verb).toBe(2)
      expect(r.said, verb).toContain('--env VOS_TEST_REACH_SECRET')
    }
  })

  it('a hosted take refuses it too: the value would leave the machine', async () => {
    const file = await script('env-hosted', READS_ENV)
    const r = await vos(['record', '--actions', file, '--hosted'])
    expect(r.code).toBe(2)
    expect(r.said).toContain('--env VOS_TEST_REACH_SECRET')
  })

  it('record and create refuse a js check nobody allowed', async () => {
    const file = await script('js', RUNS_JS)
    for (const verb of ['record', 'create']) {
      const r = await vos([verb, '--actions', file, '--out', join(dir, verb)])
      expect(r.code, verb).toBe(2)
      expect(r.said, verb).toContain('--allow-js')
    }
  })

  it('a look walks a script with the same reach as a take', async () => {
    const env = await script('look-env', {
      ...READS_ENV,
      steps: [{ id: 'there', do: 'wait', ms: 10 }],
    })
    const r = await vos(['look', NOWHERE, '--actions', env, '--until', 'there'])
    expect(r.code).toBe(2)
    expect(r.said).toContain('--env VOS_TEST_REACH_SECRET')
  })

  it('a script that names an app never reaches the desktop by itself', async () => {
    const file = await script('desktop', {
      app: 'TextEdit',
      steps: [{ do: 'type', text: 'hello' }],
    })
    const r = await vos(['record', '--actions', file, '--out', join(dir, 'd')])
    expect(r.code).toBe(2)
    expect(r.said).toContain('drives TextEdit on your desktop')
    expect(r.said).toContain('--app "TextEdit"')
  })

  it('--env takes a name, and never echoes a value typed by mistake', async () => {
    const file = await script('env-value', READS_ENV)
    const r = await vos([
      'record',
      '--actions',
      file,
      '--env',
      'VOS_TEST_REACH_SECRET=hunter2',
    ])
    expect(r.code).toBe(2)
    expect(r.said).toContain('NAME')
    expect(r.said).not.toContain('hunter2')
  })
})
