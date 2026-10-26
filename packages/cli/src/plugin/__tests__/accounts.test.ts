/**
 * The credential store (MA1): several stored credentials, one active, line
 * 1 of the active file still the key an older reader expects; `vos login`
 * is additive; `vos switch` copies; `--account` and VOS_ACCOUNT pick a
 * stored one by name and refuse, in words, a name nothing is stored under.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  accountFrom,
  accountLabel,
  activate,
  findStored,
  formatCredential,
  hostDir,
  listStored,
  parseCredential,
  readActive,
  removeAll,
  removeStored,
  storeCredential,
  switchTarget,
} from '../accounts'
import { credentialLine } from '../machine'
import { lastCredential, resolveCredential } from '../platform'
import type { Store, StoredCredential } from '../accounts'

const scratch = (): Store => {
  const dir = mkdtempSync(join(tmpdir(), 'vos-store-'))
  return {
    credentialsPath: join(dir, 'credentials'),
    accountsDir: join(dir, 'accounts'),
  }
}

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
const local: StoredCredential = {
  key: 'vos_sk_local',
  origin: 'http://localhost:6161',
  account: { id: 'u_me', kind: 'person', handle: 'hongbin' },
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
})

describe('the file shape', () => {
  it('keeps the key on line 1 and the origin on line 2, the account after', () => {
    expect(formatCredential(me)).toBe(
      'vos_sk_me\norigin=https://vos.so\naccount=u_me person hongbin\n',
    )
    expect(parseCredential(formatCredential(me))).toEqual(me)
    expect(parseCredential(formatCredential(vosso))).toEqual(vosso)
  })
  it('reads a file from before the account line, and one with no handle', () => {
    expect(parseCredential('vos_sk_old\norigin=https://vos.so\n')).toEqual({
      key: 'vos_sk_old',
      origin: 'https://vos.so',
      account: null,
    })
    expect(
      parseCredential('vos_sk_x\norigin=https://vos.so\naccount=u_x org\n')
        ?.account,
    ).toEqual({ id: 'u_x', kind: 'org', handle: null })
  })
  it('names an account by its handle, else its id, never its key', () => {
    expect(accountLabel(me.account)).toBe('@hongbin')
    expect(accountLabel({ id: 'u_x', kind: 'org', handle: null })).toBe('u_x')
    expect(accountLabel(null)).toBe('an unnamed account')
  })
  it('reads the account a login answer names', () => {
    expect(
      accountFrom({ id: 'u_v', username: 'vosso', name: 'vosso', kind: 'org' }),
    ).toEqual({ id: 'u_v', kind: 'org', handle: 'vosso' })
    expect(accountFrom({ name: 'Robin' })).toBeNull()
  })
  it('files an origin under its host, the port kept', () => {
    expect(hostDir('https://vos.so')).toBe('vos.so')
    expect(hostDir('http://localhost:6161')).toBe('localhost_6161')
  })
})

describe('storing and switching', () => {
  it('a second sign-in keeps the first and makes the new one active', () => {
    const store = scratch()
    expect(storeCredential(store, me).setAside).toBeNull()
    const second = storeCredential(store, vosso)
    expect(second.setAside?.account?.handle).toBe('hongbin')
    expect(readActive(store)?.key).toBe('vos_sk_vosso')
    // Line 1 of the active file is still the key, for every older reader.
    expect(readFileSync(store.credentialsPath, 'utf8').split('\n')[0]).toBe(
      'vos_sk_vosso',
    )
    expect(listStored(store, 'https://vos.so').map((c) => c.key)).toEqual([
      'vos_sk_vosso',
      'vos_sk_me',
    ])
  })
  it('an unnamed active credential cannot be filed and is replaced, said so', () => {
    const store = scratch()
    storeCredential(store, { ...me, account: null })
    const r = storeCredential(store, vosso)
    expect(r.setAside).toBeNull()
    expect(listStored(store).map((c) => c.key)).toEqual(['vos_sk_vosso'])
  })
  it('lists per origin and finds by handle, @handle or id, case-insensitive', () => {
    const store = scratch()
    storeCredential(store, me)
    storeCredential(store, vosso)
    storeCredential(store, local)
    expect(listStored(store, 'https://vos.so').map((c) => c.key)).toEqual([
      'vos_sk_me',
      'vos_sk_vosso',
    ])
    expect(
      listStored(store, 'http://localhost:6161/').map((c) => c.key),
    ).toEqual(['vos_sk_local'])
    expect(findStored(store, 'https://vos.so', '@Vosso')?.key).toBe(
      'vos_sk_vosso',
    )
    expect(findStored(store, 'https://vos.so', 'u_me')?.key).toBe('vos_sk_me')
    expect(findStored(store, 'https://vos.so', 'nobody')).toBeNull()
  })
  it('switch: the other of two needs no name, more need one, one is one', () => {
    const store = scratch()
    expect(switchTarget([], null, undefined, 'https://vos.so')).toMatchObject({
      ok: false,
      error: 'nothing is stored for https://vos.so; run vos login',
    })
    storeCredential(store, me)
    const one = listStored(store, 'https://vos.so')
    expect(
      switchTarget(one, 'vos_sk_me', undefined, 'https://vos.so'),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('only @hongbin is stored'),
    })
    storeCredential(store, vosso)
    const two = listStored(store, 'https://vos.so')
    const t = switchTarget(two, 'vos_sk_vosso', undefined, 'https://vos.so')
    expect(t.ok && t.to.key).toBe('vos_sk_me')
    const named = switchTarget(two, 'vos_sk_vosso', 'hongbin', 'https://vos.so')
    expect(named.ok && named.to.key).toBe('vos_sk_me')
    expect(
      switchTarget(two, 'vos_sk_vosso', 'nobody', 'https://vos.so'),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('no credential stored for @nobody'),
    })
    const three = [...two, { ...local, origin: 'https://vos.so', key: 'k3' }]
    expect(
      switchTarget(three, 'k3', undefined, 'https://vos.so'),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('say which: vos switch'),
    })
    activate(store, me)
    expect(readActive(store)?.key).toBe('vos_sk_me')
  })
  it('logout forgets one, or the active one, or all', () => {
    const store = scratch()
    storeCredential(store, me)
    storeCredential(store, vosso)
    expect(removeStored(store, me)).toEqual({ wasActive: false })
    expect(listStored(store).map((c) => c.key)).toEqual(['vos_sk_vosso'])
    expect(removeStored(store, vosso)).toEqual({ wasActive: true })
    expect(existsSync(store.credentialsPath)).toBe(false)
    expect(listStored(store)).toEqual([])
    storeCredential(store, me)
    expect(removeAll(store)).toEqual({ had: true })
    expect(removeAll(store)).toEqual({ had: false })
  })
})

describe('the ladder with a store', () => {
  it('--account and VOS_ACCOUNT pick a stored credential by name', () => {
    const store = scratch()
    storeCredential(store, me)
    storeCredential(store, vosso)
    expect(
      resolveCredential({
        account: 'hongbin',
        origin: 'https://vos.so',
        store,
      }),
    ).toBe('vos_sk_me')
    expect(lastCredential()).toMatchObject({
      via: 'account-flag',
      account: me.account,
    })
    process.env.VOS_ACCOUNT = '@vosso'
    expect(resolveCredential({ origin: 'https://vos.so', store })).toBe(
      'vos_sk_vosso',
    )
    expect(lastCredential()?.via).toBe('account-env')
    delete process.env.VOS_ACCOUNT
    expect(resolveCredential({ origin: 'https://vos.so', store })).toBe(
      'vos_sk_vosso',
    )
    expect(lastCredential()?.via).toBe('stored')
  })
  it('a name nothing is stored under is refused in words, never another account', () => {
    const store = scratch()
    storeCredential(store, me)
    expect(() =>
      resolveCredential({ account: 'acme', origin: 'https://vos.so', store }),
    ).toThrow(
      '--account names @acme, and no credential for it is stored for https://vos.so: run vos login and approve as @acme (stored: @hongbin)',
    )
    process.env.VOS_ACCOUNT = 'acme'
    expect(() =>
      resolveCredential({ origin: 'https://vos.so', store }),
    ).toThrow(/^VOS_ACCOUNT names @acme/)
  })
  it('--key and VOS_API_KEY outrank the store, and say so', () => {
    const store = scratch()
    storeCredential(store, me)
    expect(
      resolveCredential({ key: 'vos_sk_flag', account: 'hongbin', store }),
    ).toBe('vos_sk_flag')
    expect(lastCredential()?.via).toBe('flag')
    process.env.VOS_API_KEY = 'vos_sk_env'
    expect(resolveCredential({ origin: 'https://vos.so', store })).toBe(
      'vos_sk_env',
    )
    expect(lastCredential()?.via).toBe('env')
  })
  it('a stored credential is read for its own origin only', () => {
    const store = scratch()
    storeCredential(store, local)
    expect(
      resolveCredential({
        account: 'hongbin',
        origin: 'http://localhost:6161',
        store,
      }),
    ).toBe('vos_sk_local')
    expect(() =>
      resolveCredential({
        account: 'hongbin',
        origin: 'https://vos.so',
        store,
      }),
    ).toThrow(/no credential for it is stored for https:\/\/vos\.so/)
  })
  it('a hand-written one-line file is still the active credential', () => {
    const store = scratch()
    writeFileSync(store.credentialsPath, 'vos_sk_hand\n')
    expect(resolveCredential({ store })).toBe('vos_sk_hand')
    expect(lastCredential()).toMatchObject({ via: 'stored', account: null })
  })
})

describe('what doctor says', () => {
  it('names the account in use and the others stored, never a key', () => {
    expect(
      credentialLine({
        credential: true,
        accounts: [
          { label: '@hongbin', active: true },
          { label: 'vosso', active: false },
        ],
      }),
    ).toBe('@hongbin ✓ (also vosso)')
    expect(credentialLine({ credential: true, accounts: [] })).toBe('present ✓')
    expect(
      credentialLine({
        credential: false,
        accounts: [{ label: 'vosso', active: false }],
      }),
    ).toBe(
      'absent (vos login when you need hosting); stored: vosso, vos switch to use one',
    )
  })
})
