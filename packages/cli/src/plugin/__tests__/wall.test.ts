import { describe, expect, it } from 'vitest'
import { isIdpHost, isSignInPath, redirectedAway, wallVerdict } from '../wall'
import type { Arrival } from '../wall'

const arrive = (askedUrl: string, landedUrl: string, more = {}): Arrival => ({
  askedUrl,
  landedUrl,
  status: 200,
  passwordFields: 0,
  newPasswordField: false,
  oneTimeCodeField: false,
  ...more,
})

describe('redirectedAway', () => {
  const away = (a: string, l: string) => redirectedAway(new URL(a), new URL(l))

  it('lets a site arrange itself', () => {
    expect(away('https://a.dev/', 'https://a.dev/en')).toBe(false)
    expect(away('https://a.dev/docs', 'https://a.dev/docs/start')).toBe(false)
    expect(away('https://a.dev/pricing', 'https://a.dev/en/pricing')).toBe(
      false,
    )
    expect(away('https://a.dev/app/', 'https://a.dev/app')).toBe(false)
    expect(away('https://a.dev/x', 'https://www.a.dev/x')).toBe(false)
  })

  it('sees a page that was declined', () => {
    expect(away('https://a.dev/dashboard', 'https://a.dev/gallery')).toBe(true)
    expect(away('https://a.dev/app', 'https://auth.a.dev/app')).toBe(true)
    // a prefix of the NAME is not a prefix of the PATH
    expect(away('https://a.dev/app', 'https://a.dev/apple')).toBe(true)
  })
})

describe('sign-in vocabulary', () => {
  it('matches whole path segments only', () => {
    expect(isSignInPath('/login')).toBe(true)
    expect(isSignInPath('/en/sign-in')).toBe(true)
    expect(isSignInPath('/users/sign_in')).toBe(true)
    expect(isSignInPath('/blog/login-flows-explained')).toBe(false)
    expect(isSignInPath('/authors')).toBe(false)
  })

  it('knows an identity provider by its host', () => {
    expect(isIdpHost('accounts.google.com')).toBe(true)
    expect(isIdpHost('acme.auth0.com')).toBe(true)
    expect(isIdpHost('clerk.acme.com')).toBe(true)
    expect(isIdpHost('notauth0.com')).toBe(false)
    expect(isIdpHost('acme.com')).toBe(false)
  })
})

describe('wallVerdict', () => {
  it('passes a recorder that landed where it was asked', () => {
    expect(
      wallVerdict(arrive('https://a.dev/dashboard', 'https://a.dev/dashboard')),
    ).toBeNull()
    expect(wallVerdict(arrive('https://a.dev/', 'https://a.dev/en'))).toBeNull()
  })

  it('refuses a 401 or a 403 whatever the page looks like', () => {
    const v = wallVerdict(
      arrive('https://a.dev/admin', 'https://a.dev/admin', { status: 403 }),
    )
    expect(v).toMatchObject({ kind: 'status', level: 'hard' })
    expect(v?.message).toContain('answered 403')
  })

  it('refuses a redirect to a sign-in path', () => {
    const v = wallVerdict(
      arrive(
        'https://a.dev/dashboard',
        'https://a.dev/login?next=%2Fdashboard',
      ),
    )
    expect(v).toMatchObject({
      kind: 'signin',
      level: 'hard',
      asked: 'https://a.dev/dashboard',
      // the query can carry a token, so it never rides the verdict
      landed: 'https://a.dev/login',
    })
    expect(v?.message).toContain('asked for /dashboard, landed on /login')
    expect(v?.message).toContain('no session for a.dev')
  })

  it('refuses an identity provider', () => {
    const v = wallVerdict(
      arrive(
        'https://a.dev/dashboard',
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
      ),
    )
    expect(v).toMatchObject({ kind: 'idp', level: 'hard' })
  })

  it('refuses a sign-in form rendered in place, with no redirect at all', () => {
    const v = wallVerdict(
      arrive('https://a.dev/dashboard', 'https://a.dev/dashboard', {
        passwordFields: 1,
      }),
    )
    expect(v).toMatchObject({ kind: 'signin', level: 'hard' })
    expect(v?.message).toContain('the page is a sign-in form')
  })

  it('refuses a passwordless form: a one-time code is a sign-in too', () => {
    const v = wallVerdict(
      arrive('https://a.dev/app', 'https://a.dev/app', {
        oneTimeCodeField: true,
      }),
    )
    expect(v).toMatchObject({ kind: 'signin', level: 'hard' })
  })

  it('does not mistake a settings page for a wall', () => {
    expect(
      wallVerdict(
        arrive('https://a.dev/settings', 'https://a.dev/settings', {
          passwordFields: 2,
        }),
      ),
    ).toBeNull()
    expect(
      wallVerdict(
        arrive('https://a.dev/settings', 'https://a.dev/settings', {
          passwordFields: 1,
          newPasswordField: true,
        }),
      ),
    ).toBeNull()
  })

  it('lets someone who asked for the sign-in page record it', () => {
    expect(
      wallVerdict(
        arrive('https://a.dev/login', 'https://a.dev/login', {
          passwordFields: 1,
        }),
      ),
    ).toBeNull()
  })

  it('calls a redirect to a public page SOFT: a stranger shown the gallery', () => {
    // The site that sends a signed-out visitor to a public page: no password
    // field, no identity provider, nothing to see but the wrong URL.
    const v = wallVerdict(
      arrive(
        'http://localhost:6060/app/projects',
        'http://localhost:6060/gallery',
      ),
    )
    expect(v).toMatchObject({
      kind: 'redirect',
      level: 'soft',
      asked: 'http://localhost:6060/app/projects',
      landed: 'http://localhost:6060/gallery',
    })
  })

  it('has nothing to say about a take that is not http', () => {
    expect(
      wallVerdict(arrive('file:///tmp/demo.html', 'file:///tmp/other.html')),
    ).toBeNull()
  })
})
