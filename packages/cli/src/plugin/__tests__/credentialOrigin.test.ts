/**
 * A stored credential belongs to the origin it was minted for: `vos login`
 * writes that origin beside the key, a file written before that line is the
 * default origin's, and the key is never sent anywhere else (the request
 * goes without it, and that is said). A key handed to the command (--key,
 * VOS_API_KEY) goes where the command goes. A refusal names the origin in
 * use, and a request that got no answer names where it went.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ORIGIN,
  apiError,
  apiJson,
  bearerFor,
  readStoredCredential,
  resolveCredential,
  writeCredential,
} from '../platform'

let saved: string | undefined
beforeEach(() => {
  saved = process.env.VOS_API_KEY
  delete process.env.VOS_API_KEY
})
afterEach(() => {
  if (saved === undefined) delete process.env.VOS_API_KEY
  else process.env.VOS_API_KEY = saved
  vi.restoreAllMocks()
})

const scratch = () =>
  join(mkdtempSync(join(tmpdir(), 'vos-cred-')), 'credentials')

describe('a stored credential and its origin', () => {
  it('is written with the origin it was minted for, the key still the first line', () => {
    const path = scratch()
    writeCredential('vos_sk_local', 'http://localhost:6060/', path)
    expect(readFileSync(path, 'utf8')).toBe(
      'vos_sk_local\norigin=http://localhost:6060\n',
    )
    expect(readStoredCredential(path)).toEqual({
      key: 'vos_sk_local',
      origin: 'http://localhost:6060',
      account: null,
    })
  })

  it('reads a file with no origin as the default origin’s', () => {
    const path = scratch()
    writeFileSync(path, 'vos_sk_old\n')
    expect(readStoredCredential(path)).toEqual({
      key: 'vos_sk_old',
      origin: DEFAULT_ORIGIN,
      account: null,
    })
  })

  it('is sent only to its own origin, and says so once when it is not', () => {
    const path = scratch()
    writeFileSync(path, 'vos_sk_prod\n')
    const key = resolveCredential(undefined, path)
    expect(key).toBe('vos_sk_prod')
    const said: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      said.push(String(s))
      return true
    })
    expect(bearerFor(key, 'https://vos.so/api/folders')).toEqual({
      authorization: 'Bearer vos_sk_prod',
    })
    expect(bearerFor(key, 'http://localhost:6061/api/folders')).toEqual({})
    expect(bearerFor(key, 'http://localhost:6061/api/vos')).toEqual({})
    expect(said).toEqual([
      'note: the credential vos login stored is for https://vos.so, so it is not sent to http://localhost:6061; for http://localhost:6061, run vos login --origin http://localhost:6061, or pass --key or VOS_API_KEY\n',
    ])
  })

  it('a key handed to the command goes where the command goes', () => {
    process.env.VOS_API_KEY = 'vos_sk_env'
    const key = resolveCredential(undefined, scratch())
    expect(bearerFor(key, 'http://localhost:6062/api/x')).toEqual({
      authorization: 'Bearer vos_sk_env',
    })
    expect(
      bearerFor(resolveCredential('vos_sk_flag'), 'http://a.test'),
    ).toEqual({ authorization: 'Bearer vos_sk_flag' })
  })
})

describe('the words a refusal says', () => {
  it('names the origin in use where a key is minted', () => {
    expect(
      apiError('push', {
        status: 401,
        body: { error: 'Unauthorized' },
        origin: 'http://localhost:6060',
      }),
    ).toBe(
      'push → 401: Unauthorized (run `vos login`, or set VOS_API_KEY — mint a key at http://localhost:6060/app/api)',
    )
  })

  it('names the origin a request could not reach', async () => {
    await expect(apiJson('http://127.0.0.1:1', '/api/vos')).rejects.toThrow(
      /^could not reach http:\/\/127\.0\.0\.1:1 \(fetch failed.*\); is it the origin you meant\?/,
    )
  })
})
