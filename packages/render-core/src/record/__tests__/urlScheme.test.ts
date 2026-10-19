import { describe, expect, it } from 'vitest'
import { validateActions } from '../actions'
import { urlSchemeProblem, validateSetup } from '../setup'

describe('a page the recorder opens is http or https', () => {
  it('names any other scheme in words', () => {
    expect(urlSchemeProblem('https://example.com/')).toBeNull()
    expect(urlSchemeProblem('http://localhost:3000/app')).toBeNull()
    expect(urlSchemeProblem('file:///etc/passwd')).toMatch(
      /not an http\(s\) address/,
    )
    expect(urlSchemeProblem('javascript:alert(1)')).toMatch(
      /not an http\(s\) address/,
    )
    expect(urlSchemeProblem('data:text/html,<p>hi</p>')).toMatch(
      /not an http\(s\) address/,
    )
    expect(urlSchemeProblem('example.com')).toMatch(/not a URL/)
  })

  it("refuses an actions file's url on another scheme", () => {
    const steps = [{ do: 'wait', ms: 100 }]
    expect(validateActions({ url: 'https://example.com', steps })).toEqual([])
    expect(validateActions({ url: 'file:///etc/passwd', steps })).toEqual([
      'url file:///etc/passwd is not an http(s) address, and the recorder opens only http and https pages',
    ])
    expect(validateActions({ url: 'javascript:alert(1)', steps })[0]).toMatch(
      /^url javascript:alert\(1\) is not an http\(s\) address/,
    )
  })

  it("refuses a setup's goto on another scheme, through both validators", () => {
    expect(
      validateSetup([{ do: 'goto', url: 'https://example.com/login' }]),
    ).toEqual([])
    expect(validateSetup([{ do: 'goto', url: 'file:///etc/passwd' }])).toEqual([
      'setup[0]: goto file:///etc/passwd is not an http(s) address, and the recorder opens only http and https pages',
    ])
    expect(
      validateActions({
        url: 'https://example.com',
        setup: [{ do: 'goto', url: 'javascript:void(0)' }],
        steps: [{ do: 'wait', ms: 100 }],
      }),
    ).toEqual([
      'setup[0]: goto javascript:void(0) is not an http(s) address, and the recorder opens only http and https pages',
    ])
  })
})
