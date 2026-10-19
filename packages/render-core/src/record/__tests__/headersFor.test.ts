import { describe, expect, it } from 'vitest'
import { headersFor } from '../recorder'

/**
 * A job's headers (a preview's bypass token) ride the requests to the
 * origin the take is of and no other: the recorded page embeds whatever
 * third parties it likes, and a redirect can land anywhere.
 */
describe("headersFor scopes a take's headers to its origin", () => {
  const headers = { 'x-vercel-protection-bypass': 'secret' }
  const entry = 'https://preview-42.vercel.app/app?x=1'

  it('sends them on the entry origin, path and query apart', () => {
    expect(
      headersFor('https://preview-42.vercel.app/api/data', entry, headers),
    ).toEqual(headers)
  })

  it('sends nothing to another origin, a subdomain or a scheme apart', () => {
    for (const url of [
      'https://evil.tld/collect',
      'https://cdn.preview-42.vercel.app/x.js',
      'http://preview-42.vercel.app/app',
      'https://preview-42.vercel.app:8443/app',
      'not a url',
    ])
      expect(headersFor(url, entry, headers), url).toBeNull()
  })
})
