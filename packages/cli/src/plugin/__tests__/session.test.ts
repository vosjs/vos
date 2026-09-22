import { describe, expect, it } from 'vitest'
import {
  looksLikeStorageState,
  sessionNameVerdict,
  summaryLine,
} from '../session'
import { storageStateInDir } from '../sync'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('a session name is a directory name', () => {
  it('takes a short handle and refuses anything that could walk', () => {
    expect(sessionNameVerdict('acme')).toBeNull()
    expect(sessionNameVerdict('app.acme-staging_2')).toBeNull()
    expect(sessionNameVerdict(undefined)).toContain('--name')
    expect(sessionNameVerdict('../x')).toContain('not a session name')
    expect(sessionNameVerdict('a/b')).toContain('not a session name')
    expect(sessionNameVerdict('x'.repeat(65))).toContain('not a session name')
  })
})

describe('summaryLine says counts and dates, never a value', () => {
  it('names the origins and the newest expiry', () => {
    const line = summaryLine({
      name: 'acme',
      origins: [
        { host: 'app.acme.com', cookies: 7 },
        { host: 'accounts.google.com', cookies: 12 },
      ],
      newestExpires: new Date(Date.now() + 29.6 * 86400000).toISOString(),
      sessionOnly: 0,
      ageDays: 0,
    })
    expect(line).toBe(
      'session "acme" holds cookies for app.acme.com (7), accounts.google.com (12); newest expires in 30 days',
    )
  })

  it('says when every cookie dies with the window', () => {
    const line = summaryLine({
      name: 'acme',
      origins: [{ host: 'app.acme.com', cookies: 1 }],
      newestExpires: null,
      sessionOnly: 1,
      ageDays: 0,
    })
    expect(line).toContain('every cookie dies with the window')
    expect(line).toContain('cannot be reused')
  })

  it('says when nothing landed', () => {
    expect(
      summaryLine({
        name: 'acme',
        origins: [],
        newestExpires: null,
        sessionOnly: 0,
        ageDays: 0,
      }),
    ).toContain('holds no cookies')
  })
})

describe('the push guard', () => {
  it('recognizes a Playwright storage state by shape', () => {
    expect(looksLikeStorageState({ cookies: [], origins: [] })).toBe(true)
    expect(
      looksLikeStorageState({ cookies: [{ name: 'a' }], origins: [] }),
    ).toBe(true)
    expect(looksLikeStorageState({ steps: [] })).toBe(false)
    expect(looksLikeStorageState({ cookies: 'no' })).toBe(false)
    expect(looksLikeStorageState(null)).toBe(false)
  })

  it("finds one in a take directory and ignores the take's own files", () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-take-'))
    writeFileSync(
      join(dir, 'doc.json'),
      JSON.stringify({ cookies: [], origins: [] }),
    ) // never read as a state
    writeFileSync(join(dir, 'notes.json'), '{"a":1}')
    writeFileSync(join(dir, 'broken.json'), '{not json')
    expect(storageStateInDir(dir)).toBeNull()
    writeFileSync(
      join(dir, 'auth.json'),
      JSON.stringify({ cookies: [{ name: 'sid', value: 'x' }], origins: [] }),
    )
    expect(storageStateInDir(dir)).toBe(join(dir, 'auth.json'))
  })
})
