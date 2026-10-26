/**
 * A directory remembers whose work it is (MA2): vos.json carries the origin
 * and the account of its last push or fetch, the ladder resolves a stored
 * credential for that account before the active one, a directory whose
 * account is not stored here is refused in words, another origin is only
 * noted, and a push to someone else's project address asks first.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storeCredential } from '../accounts'
import { startFromVerdict } from '../folder'
import {
  directoryVerdict,
  lastCredential,
  readSyncState,
  resolveCredential,
  writeSyncState,
} from '../platform'
import type { Store, StoredCredential } from '../accounts'

const scratch = (): Store => {
  const dir = mkdtempSync(join(tmpdir(), 'vos-store-'))
  return {
    credentialsPath: join(dir, 'credentials'),
    accountsDir: join(dir, 'accounts'),
  }
}
const takeDir = () => mkdtempSync(join(tmpdir(), 'vos-take-'))

const me: StoredCredential = {
  key: 'vos_sk_me',
  origin: 'https://vos.so',
  account: { id: 'u_me', kind: 'person', handle: 'hongbin' },
}
const vosso: StoredCredential = {
  key: 'vos_sk_vosso',
  origin: 'https://vos.so',
  account: { id: 'u_vosso', kind: 'org', handle: 'vosso' },
}

let savedKey: string | undefined
let savedAccount: string | undefined
beforeEach(() => {
  savedKey = process.env.VOS_API_KEY
  savedAccount = process.env.VOS_ACCOUNT
  delete process.env.VOS_API_KEY
  delete process.env.VOS_ACCOUNT
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.VOS_API_KEY
  else process.env.VOS_API_KEY = savedKey
  if (savedAccount === undefined) delete process.env.VOS_ACCOUNT
  else process.env.VOS_ACCOUNT = savedAccount
  vi.restoreAllMocks()
})

describe('vos.json names its account', () => {
  it('round-trips origin and account, and reads a file without them', () => {
    const dir = takeDir()
    writeSyncState(dir, {
      vosId: 'abc',
      versionId: 'v1',
      origin: 'https://vos.so/',
      account: { id: 'u_vosso', handle: 'vosso' },
    })
    expect(readSyncState(dir)).toMatchObject({
      vosId: 'abc',
      origin: 'https://vos.so',
      account: { id: 'u_vosso', handle: 'vosso' },
    })
    const old = takeDir()
    writeFileSync(
      join(old, 'vos.json'),
      JSON.stringify({ vosId: 'old', versionId: null }),
    )
    const state = readSyncState(old)
    expect(state?.origin).toBeUndefined()
    expect(state?.account).toBeUndefined()
  })
})

describe('the ladder with a directory', () => {
  it('uses the stored credential for the directory’s account before the active one', () => {
    const store = scratch()
    storeCredential(store, vosso)
    storeCredential(store, me) // active: me
    const dir = takeDir()
    writeSyncState(dir, {
      vosId: 'abc',
      versionId: null,
      origin: 'https://vos.so',
      account: { id: 'u_vosso', handle: 'vosso' },
    })
    expect(resolveCredential({ origin: 'https://vos.so', store, dir })).toBe(
      'vos_sk_vosso',
    )
    expect(lastCredential()).toMatchObject({
      via: 'directory',
      account: vosso.account,
    })
  })
  it('refuses, in words, a directory whose account is not stored here', () => {
    const store = scratch()
    storeCredential(store, me)
    const dir = takeDir()
    writeSyncState(dir, {
      vosId: 'abc',
      versionId: null,
      origin: 'https://vos.so',
      account: { id: 'u_vosso', handle: 'vosso' },
    })
    expect(() =>
      resolveCredential({ origin: 'https://vos.so', store, dir }),
    ).toThrow(
      `${dir} belongs to @vosso, and no credential for it is stored for https://vos.so. Run vos login and approve as @vosso, or vos switch vosso if it is stored under another name, or pass --account or --key.`,
    )
  })
  it('notes another origin once and falls through to the active credential', () => {
    const store = scratch()
    storeCredential(store, me)
    const dir = takeDir()
    writeSyncState(dir, {
      vosId: 'abc',
      versionId: null,
      origin: 'http://localhost:6161',
      account: { id: 'u_vosso', handle: 'vosso' },
    })
    const said: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      said.push(String(s))
      return true
    })
    expect(resolveCredential({ origin: 'https://vos.so', store, dir })).toBe(
      'vos_sk_me',
    )
    expect(resolveCredential({ origin: 'https://vos.so', store, dir })).toBe(
      'vos_sk_me',
    )
    expect(said).toEqual([
      `note: ${dir} was last pushed to http://localhost:6161, and this command goes to https://vos.so\n`,
    ])
  })
  it('a key or a name handed in outranks the directory', () => {
    const store = scratch()
    storeCredential(store, vosso)
    storeCredential(store, me)
    const dir = takeDir()
    writeSyncState(dir, {
      vosId: 'abc',
      versionId: null,
      origin: 'https://vos.so',
      account: { id: 'u_vosso', handle: 'vosso' },
    })
    expect(
      resolveCredential({
        key: 'vos_sk_flag',
        origin: 'https://vos.so',
        store,
        dir,
      }),
    ).toBe('vos_sk_flag')
    expect(
      resolveCredential({
        account: 'hongbin',
        origin: 'https://vos.so',
        store,
        dir,
      }),
    ).toBe('vos_sk_me')
    process.env.VOS_API_KEY = 'vos_sk_env'
    expect(resolveCredential({ origin: 'https://vos.so', store, dir })).toBe(
      'vos_sk_env',
    )
  })
  it('a directory with no account is no verdict', () => {
    expect(directoryVerdict(null, 'https://vos.so', null, 'take')).toEqual({
      kind: 'none',
    })
    expect(
      directoryVerdict(
        { origin: 'https://vos.so' },
        'https://vos.so',
        null,
        'take',
      ),
    ).toEqual({ kind: 'none' })
  })
})

describe('a push to someone else’s project address', () => {
  it('asks when the credential’s account is not the owner, and not otherwise', () => {
    const at = { handle: 'vosso', slug: 'website' }
    expect(startFromVerdict(at, vosso.account).asks).toBe(false)
    expect(
      startFromVerdict(at, { id: 'x', kind: 'org', handle: 'VOSSO' }).asks,
    ).toBe(false)
    const asMe = startFromVerdict(at, me.account)
    expect(asMe.asks).toBe(true)
    expect(asMe.question).toBe(
      'Pushing to @vosso/website as @hongbin would START your own copy of it (its recipes copied in), not continue it. Continue?',
    )
    expect(asMe.refusal).toContain('vos switch vosso, or --account vosso')
    expect(asMe.refusal).toContain('pass --yes to start the copy')
    expect(startFromVerdict(at, null).asks).toBe(false)
  })
})
