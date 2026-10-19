import { describe, expect, it, vi } from 'vitest'
import {
  expandIPv6,
  fetchPublic,
  fetchRefusal,
  parseIPv4,
  privateHostReason,
} from '../netAddress'

describe('an address on this machine or its network', () => {
  it('reads an IPv4 literal in every spelling a resolver takes', () => {
    expect(parseIPv4('127.0.0.1')).toEqual([127, 0, 0, 1])
    expect(parseIPv4('0x7f.1')).toEqual([127, 0, 0, 1])
    expect(parseIPv4('0177.0.0.1')).toEqual([127, 0, 0, 1])
    expect(parseIPv4('2130706433')).toEqual([127, 0, 0, 1])
    expect(parseIPv4('10.1')).toEqual([10, 0, 0, 1])
    expect(parseIPv4('example.com')).toBeNull()
    expect(parseIPv4('1.2.3.4.5')).toBeNull()
    expect(parseIPv4('256.1.1.1')).toBeNull()
  })

  it('reads an IPv6 literal, compressed or with an IPv4 tail', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(expandIPv6('fe80::1%en0')?.[0]).toBe(0xfe80)
    expect(expandIPv6('::ffff:10.0.0.1')).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0001,
    ])
    expect(expandIPv6('2001:db8::')).toHaveLength(8)
    expect(expandIPv6('1:2:3')).toBeNull()
    expect(expandIPv6('example.com')).toBeNull()
  })

  it('names loopback, private, link-local and the metadata range', () => {
    for (const host of [
      'localhost',
      'app.localhost',
      '127.0.0.1',
      '127.1',
      '0x7f000001',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '[::1]',
      '::',
      '[::ffff:127.0.0.1]',
      '::ffff:192.168.0.1',
      '64:ff9b::7f00:1',
      'fd12::1',
      'fe80::1',
    ]) {
      expect(privateHostReason(host), host).not.toBeNull()
    }
  })

  it('lets the public internet through', () => {
    for (const host of [
      'example.com',
      '8.8.8.8',
      '172.32.0.1',
      '2606:4700::1111',
      '[2606:4700::1111]',
      '::ffff:8.8.8.8',
    ]) {
      expect(privateHostReason(host), host).toBeNull()
    }
  })

  it('refuses a URL on one, or on any scheme but http(s), in words', () => {
    expect(fetchRefusal('http://127.0.0.1:8080/x')).toMatch(
      /127\.0\.0\.1 is this machine/,
    )
    expect(fetchRefusal('http://169.254.169.254/latest/meta-data')).toMatch(
      /link-local/,
    )
    expect(fetchRefusal('http://[::1]/')).toMatch(/is this machine/)
    expect(fetchRefusal('file:///etc/passwd')).toMatch(/not an http\(s\)/)
    expect(fetchRefusal('ftp://example.com/x')).toMatch(/not an http\(s\)/)
    expect(fetchRefusal('not a url')).toMatch(/not a URL/)
    expect(fetchRefusal('https://example.com/logo.png')).toBeNull()
  })
})

const answer = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : 'ok', { status, headers })

describe('a public fetch follows redirects under the same rule', () => {
  it('re-checks every hop and refuses one landing on this machine', async () => {
    const impl = vi.fn(async (url: string, _init?: RequestInit) =>
      url === 'https://example.com/a'
        ? answer(302, { location: 'http://127.0.0.1/secret' })
        : answer(200),
    )
    await expect(
      fetchPublic('https://example.com/a', {}, impl as never),
    ).rejects.toThrow(/127\.0\.0\.1 is this machine/)
    expect(impl).toHaveBeenCalledTimes(1)
    expect(impl.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('refuses the first address before any request', async () => {
    const impl = vi.fn()
    await expect(
      fetchPublic('http://10.0.0.1/', {}, impl as never),
    ).rejects.toThrow(/private network/)
    expect(impl).not.toHaveBeenCalled()
  })

  it('follows a public redirect, relative too, and answers the last hop', async () => {
    const impl = vi.fn(async (url: string) => {
      if (url === 'https://example.com/a')
        return answer(301, { location: '/b' })
      if (url === 'https://example.com/b')
        return answer(302, { location: 'https://cdn.example.com/c' })
      return answer(200)
    })
    const res = await fetchPublic('https://example.com/a', {}, impl as never)
    expect(res.status).toBe(200)
    expect(impl.mock.calls.map((c) => c[0])).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://cdn.example.com/c',
    ])
  })

  it('stops after five hops', async () => {
    const impl = vi.fn(async (url: string) =>
      answer(302, { location: `${url}x` }),
    )
    await expect(
      fetchPublic('https://example.com/', {}, impl as never),
    ).rejects.toThrow(/redirected more than 5 times/)
    expect(impl).toHaveBeenCalledTimes(6)
  })
})
