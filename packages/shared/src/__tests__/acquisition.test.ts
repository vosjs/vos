import { describe, expect, it } from 'vitest'
import {
  FIRST_TOUCH_COOKIE,
  decodeFirstTouch,
  encodeFirstTouch,
  firstTouchOf,
  readCookieValue,
} from '../acquisition'

describe('firstTouchOf', () => {
  it('returns null for a direct visit', () => {
    expect(
      firstTouchOf({ url: new URL('https://vos.so/'), referer: null }),
    ).toBeNull()
  })

  it('reads utm params as the source of truth', () => {
    const touch = firstTouchOf({
      url: new URL(
        'https://vos.so/?utm_source=x&utm_medium=social&utm_campaign=launch',
      ),
      referer: 'https://t.co/abc',
    })
    expect(touch).toEqual({
      source: 'x',
      medium: 'social',
      campaign: 'launch',
      referrer: 't.co',
    })
  })

  it('derives source and referral medium from a bare referrer', () => {
    const touch = firstTouchOf({
      url: new URL('https://vos.so/gallery'),
      referer: 'https://chatgpt.com/c/123',
    })
    expect(touch).toEqual({
      source: 'chatgpt.com',
      medium: 'referral',
      referrer: 'chatgpt.com',
    })
  })

  it('a utm_source beats the referrer for source but keeps the domain', () => {
    const touch = firstTouchOf({
      url: new URL('https://vos.so/?utm_source=newsletter'),
      referer: 'https://mail.google.com/',
    })
    expect(touch?.source).toBe('newsletter')
    expect(touch?.referrer).toBe('mail.google.com')
    // No utm_medium and the source is tagged: nothing to derive.
    expect(touch?.medium).toBeUndefined()
  })

  it('ignores same-site referrers, www included', () => {
    expect(
      firstTouchOf({
        url: new URL('https://vos.so/watch/abc'),
        referer: 'https://vos.so/gallery',
      }),
    ).toBeNull()
    // canonicalHost 301s www → apex; the follow-up request refers to our own
    // www host, which must not read as a referral.
    expect(
      firstTouchOf({
        url: new URL('https://vos.so/'),
        referer: 'https://www.vos.so/',
      }),
    ).toBeNull()
  })

  it('ignores an unparseable referrer', () => {
    expect(
      firstTouchOf({ url: new URL('https://vos.so/'), referer: 'not a url' }),
    ).toBeNull()
  })

  it('a campaign without a source still records, with source unknown', () => {
    const touch = firstTouchOf({
      url: new URL('https://vos.so/?utm_campaign=launch'),
      referer: null,
    })
    expect(touch).toEqual({ source: 'unknown', campaign: 'launch' })
  })

  it('truncates oversized values instead of refusing them', () => {
    const touch = firstTouchOf({
      url: new URL(`https://vos.so/?utm_source=${'a'.repeat(500)}`),
      referer: null,
    })
    expect(touch?.source).toHaveLength(200)
  })
})

describe('encode / decode round trip', () => {
  it('round-trips a full touch', () => {
    const touch = {
      source: 'chatgpt.com',
      medium: 'referral',
      referrer: 'chatgpt.com',
      landing: '/watch/abc',
      at: '2026-08-30T00:00:00.000Z',
    }
    expect(decodeFirstTouch(encodeFirstTouch(touch))).toEqual(touch)
  })

  it('survives unicode in values', () => {
    const touch = { source: 'ニュース', campaign: 'été' }
    expect(decodeFirstTouch(encodeFirstTouch(touch))).toEqual(touch)
  })

  it('fails closed on garbage', () => {
    expect(decodeFirstTouch(undefined)).toBeNull()
    expect(decodeFirstTouch('')).toBeNull()
    expect(decodeFirstTouch('%%%')).toBeNull()
    expect(decodeFirstTouch('null')).toBeNull()
    expect(decodeFirstTouch('42')).toBeNull()
    expect(decodeFirstTouch(encodeURIComponent('{"medium":"x"}'))).toBeNull()
    expect(decodeFirstTouch('x'.repeat(3000))).toBeNull()
  })

  it('drops non-string fields and caps lengths on decode', () => {
    const raw = encodeURIComponent(
      JSON.stringify({ source: 'ok', medium: 7, landing: 'l'.repeat(500) }),
    )
    const touch = decodeFirstTouch(raw)
    expect(touch?.source).toBe('ok')
    expect(touch?.medium).toBeUndefined()
    expect(touch?.landing).toHaveLength(200)
  })
})

describe('readCookieValue', () => {
  it('finds the cookie among others', () => {
    const header = `theme=dark; ${FIRST_TOUCH_COOKIE}=abc%22; other=1`
    expect(readCookieValue(header, FIRST_TOUCH_COOKIE)).toBe('abc%22')
  })

  it('misses cleanly', () => {
    expect(readCookieValue('a=1; b=2', FIRST_TOUCH_COOKIE)).toBeUndefined()
    expect(readCookieValue(null, FIRST_TOUCH_COOKIE)).toBeUndefined()
    // A name that is a suffix of another must not match.
    expect(
      readCookieValue(`x${FIRST_TOUCH_COOKIE}=1`, FIRST_TOUCH_COOKIE),
    ).toBeUndefined()
  })
})
