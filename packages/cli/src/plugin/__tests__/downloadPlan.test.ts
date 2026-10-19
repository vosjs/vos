import { describe, expect, it } from 'vitest'
import { downloadPlan } from '../media'
import { verifyUrlOk } from '../login'

/**
 * The content key goes to the configured origin and nowhere else. A
 * fetched document names its files, and a stranger's document could name
 * a file-door address on a host of theirs; the key must never follow it.
 */
describe('downloadPlan sends the bearer only home', () => {
  const ctx = { origin: 'https://vos.so' }

  it('resolves a relative door against home with the key', () => {
    expect(downloadPlan(ctx, '/api/assets/abc/file')).toEqual({
      url: 'https://vos.so/api/assets/abc/file',
      bearer: true,
    })
  })

  it('keeps the key on an absolute home address', () => {
    expect(downloadPlan(ctx, 'https://vos.so/api/assets/abc/file?x=1')).toEqual(
      { url: 'https://vos.so/api/assets/abc/file?x=1', bearer: true },
    )
  })

  it('reads a door on another host from home by its id, never from that host', () => {
    expect(downloadPlan(ctx, 'https://evil.tld/api/assets/abc/file')).toEqual({
      url: 'https://vos.so/api/assets/abc/file',
      bearer: true,
    })
  })

  it('fetches any other URL bare', () => {
    expect(downloadPlan(ctx, 'https://cdn.example.com/track.mp3')).toEqual({
      url: 'https://cdn.example.com/track.mp3',
      bearer: false,
    })
    expect(downloadPlan(ctx, 'https://')).toEqual({
      url: 'https://',
      bearer: false,
    })
  })
})

describe('the sign-in page a login opens is on the origin it asked', () => {
  it('accepts the origin and refuses any other', () => {
    expect(
      verifyUrlOk('https://vos.so/cli/auth?code=ABC', 'https://vos.so'),
    ).toBe(true)
    expect(
      verifyUrlOk('https://evil.tld/cli/auth?code=ABC', 'https://vos.so'),
    ).toBe(false)
    expect(verifyUrlOk('not a url', 'https://vos.so')).toBe(false)
  })
})
