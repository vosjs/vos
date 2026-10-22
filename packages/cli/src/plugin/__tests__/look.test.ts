import { describe, expect, it } from 'vitest'
import {
  chooseProposal,
  controlLine,
  judgeMatch,
  lookSteps,
  parseViewport,
  quote,
  scopeSelector,
  selectorCandidates,
  shownUrl,
  spendWord,
  splitTypeFlag,
  stableId,
} from '../look'
import type { RawControl } from '../look'

const control = (over: Partial<RawControl> = {}): RawControl => ({
  index: 0,
  tag: 'button',
  role: 'button',
  name: '',
  text: '',
  ariaLabel: null,
  testId: null,
  id: null,
  nameAttr: null,
  placeholder: null,
  href: null,
  hrefAttr: null,
  rect: { x: 0, y: 0, w: 10, h: 10 },
  disabled: false,
  covered: false,
  dialog: null,
  landmark: null,
  ...over,
})

describe('selector candidates, most stable first', () => {
  it('leads with the test id, then the aria-label, then role + name, then the words', () => {
    const sel = selectorCandidates(
      control({
        testId: { attr: 'data-testid', value: 'save' },
        ariaLabel: 'Save draft',
        name: 'Save draft',
        text: 'Save',
      }),
    )
    expect(sel.map((c) => c.basis)).toEqual([
      'testid',
      'aria-label',
      'role',
      'text',
    ])
    expect(sel[0].selector).toBe('[data-testid="save"]')
    expect(sel[1].selector).toBe('[aria-label="Save draft"]')
    expect(sel[2].selector).toBe('role=button[name="Save draft"]')
    expect(sel[3].selector).toBe('text="Save"')
  })

  it('scopes the aria-label, the role and the words to the open dialog the control sits in', () => {
    const dialog = { tag: 'div', role: 'dialog', label: 'Rename', testId: null }
    const sel = selectorCandidates(
      control({
        name: 'Continue',
        text: 'Continue',
        ariaLabel: 'Continue',
        dialog,
      }),
    )
    expect(sel.map((c) => c.selector)).toEqual([
      '[role="dialog"][aria-label="Rename"] [aria-label="Continue"]',
      '[role="dialog"][aria-label="Rename"] >> role=button[name="Continue"]',
      '[role="dialog"][aria-label="Rename"] >> text="Continue"',
    ])
  })

  it('keeps a test id unscoped first, then tries it inside the dialog', () => {
    const sel = selectorCandidates(
      control({
        testId: { attr: 'data-testid', value: 'ok' },
        dialog: { tag: 'dialog', role: '', label: null, testId: null },
      }),
    )
    expect(sel.map((c) => c.selector)).toEqual([
      '[data-testid="ok"]',
      'dialog[open] [data-testid="ok"]',
    ])
  })

  it('narrows by the landmark when no dialog is open', () => {
    const sel = selectorCandidates(
      control({
        tag: 'a',
        role: 'link',
        name: 'Docs',
        text: 'Docs',
        landmark: { tag: 'nav', role: '', label: 'Primary', testId: null },
      }),
    )
    expect(sel.map((c) => c.selector)).toEqual([
      'role=link[name="Docs"]',
      'nav[aria-label="Primary"] >> role=link[name="Docs"]',
      'nav[aria-label="Primary"] >> text="Docs"',
    ])
  })

  it('tries a link by its own href, query kept, after the test id and aria-label', () => {
    const sel = selectorCandidates(
      control({
        tag: 'a',
        role: 'link',
        name: 'Open',
        text: 'Open',
        href: '/studio?vos=a',
        hrefAttr: '/studio?vos=a',
      }),
    )
    expect(sel.map((c) => c.selector)).toEqual([
      'a[href="/studio?vos=a"]',
      'role=link[name="Open"]',
      'text="Open"',
    ])
    expect(
      selectorCandidates(
        control({
          tag: 'a',
          role: 'link',
          ariaLabel: 'Report',
          hrefAttr: '/f/1',
        }),
      ).map((c) => c.basis),
    ).toEqual(['aria-label', 'href'])
    for (const hrefAttr of ['#', 'javascript:void(0)'])
      expect(
        selectorCandidates(control({ tag: 'a', role: 'link', hrefAttr })),
      ).toEqual([])
  })

  it('reaches a form field by its own attributes and a written id, never by position', () => {
    const sel = selectorCandidates(
      control({
        tag: 'input',
        role: 'textbox',
        name: 'Email',
        nameAttr: 'email',
        placeholder: 'you@company.test',
        id: 'email',
      }),
    )
    expect(sel.map((c) => c.selector)).toEqual([
      'role=textbox[name="Email"]',
      'input[name="email"]',
      'input[placeholder="you@company.test"]',
      '#email',
    ])
    expect(sel.some((c) => /nth/.test(c.selector))).toBe(false)
  })

  it('offers nothing for a control with no words, no test id and no id', () => {
    expect(selectorCandidates(control())).toEqual([])
  })

  it('quotes what CSS and the selector engine both read', () => {
    expect(quote('say "hi"\\now')).toBe('"say \\"hi\\"\\\\now"')
    expect(quote('two\n lines')).toBe('"two lines"')
  })

  it('names a scope by its test id, role or tag', () => {
    expect(
      scopeSelector(
        {
          tag: 'div',
          role: 'dialog',
          label: null,
          testId: { attr: 'data-testid', value: 'm' },
        },
        'dialog',
      ),
    ).toBe('[data-testid="m"]')
    expect(
      scopeSelector(
        { tag: 'div', role: '', label: null, testId: null },
        'dialog',
      ),
    ).toBe('[aria-modal="true"]')
    expect(
      scopeSelector(
        { tag: 'header', role: '', label: null, testId: null },
        'landmark',
      ),
    ).toBe('header')
  })

  it('takes a written id and leaves a minted one', () => {
    expect(stableId('email')).toBe(true)
    expect(stableId('save-button')).toBe(true)
    expect(stableId(':r3:')).toBe(false)
    expect(stableId('radix-dialog-title')).toBe(false)
    expect(stableId('field-1234')).toBe(false)
    expect(stableId(null)).toBe(false)
  })
})

describe('the proposal is judged by which elements a candidate reaches', () => {
  it('is UNIQUE only when it reaches this element and no other', () => {
    expect(judgeMatch(3, ['3'])).toBe('unique')
    expect(judgeMatch(3, ['1', '3'])).toBe('ambiguous')
    expect(judgeMatch(3, ['1'])).toBe('miss')
    expect(judgeMatch(3, [])).toBe('miss')
  })

  it('takes the most stable unique candidate, past an ambiguous one', () => {
    const cands = [
      { selector: 'a', basis: 'aria-label' as const },
      { selector: 'b', basis: 'role' as const },
      { selector: 'c', basis: 'text' as const },
    ]
    expect(chooseProposal(2, cands, [['1', '2'], ['2'], ['2']])).toEqual({
      selector: 'b',
      basis: 'role',
      match: 'unique',
      matches: 1,
    })
  })

  it('falls back to the most stable ambiguous one, with its count, then to none', () => {
    const cands = [
      { selector: 'a', basis: 'role' as const },
      { selector: 'b', basis: 'text' as const },
    ]
    expect(chooseProposal(0, cands, [['5'], ['0', '4', '9']])).toEqual({
      selector: 'b',
      basis: 'text',
      match: 'ambiguous',
      matches: 3,
    })
    expect(chooseProposal(0, cands, [['5'], []])).toEqual({
      selector: null,
      basis: null,
      match: 'none',
      matches: 0,
    })
  })
})

describe('a look presses nothing that spends, sends or destroys', () => {
  it('finds the word by its stem, in any of the control’s words', () => {
    expect(spendWord(['Delete project'])).toBe('delete')
    expect(spendWord(['', 'Generate video'])).toBe('generate')
    expect(spendWord(['PUBLISH'])).toBe('publish')
    expect(spendWord(['Allow deleting'])).toBe('deleting')
    expect(spendWord(['Move  to Trash'])).toBe('move to trash')
    for (const w of [
      'Revoke',
      'Revoke key',
      'Allow deleting',
      'Discard changes',
      'Erase all',
      'Empty Trash',
      'Move to Trash',
      'Deploy',
      'Unsubscribe',
      'Cancel subscription',
      'Remove access',
      'Leave team',
      'Transfer ownership',
      'Submit',
      'Remove member',
      'Buy now',
      'Pay',
      'Purchase',
      'Upgrade plan',
      'Subscribe',
      'Confirm',
      'Send invite',
      'Generating',
      'Destroy',
    ])
      expect(spendWord([w]), w).not.toBeNull()
  })

  it('lets an ordinary control through', () => {
    for (const w of [
      'Continue',
      'Open settings',
      'Cancel',
      'Docs',
      'New project',
    ])
      expect(spendWord([w]), w).toBeNull()
    expect(spendWord([null, undefined, ''])).toBeNull()
  })

  it('cannot know every spend: Make and Create pass, the script guard is the fence', () => {
    expect(spendWord(['Make a video'])).toBeNull()
    expect(spendWord(['Create'])).toBeNull()
  })

  it('errs toward refusing a near miss', () => {
    // A stem matches a word's start: a look can afford to be wrong this way.
    expect(spendWord(['Payments'])).toBe('payments')
    expect(spendWord(['Deleted items'])).toBe('deleted')
  })
})

describe('a URL is printed as it was given, without credentials', () => {
  it('keeps the query and drops a user and password', () => {
    expect(shownUrl('https://app.test/studio?vos=abc')).toBe(
      'https://app.test/studio?vos=abc',
    )
    expect(shownUrl('https://me:secret@app.test/x?y=1')).toBe(
      'https://app.test/x?y=1',
    )
    expect(shownUrl('not a url')).toBe('not a url')
  })
})

describe('the steps keep the order they were given in', () => {
  it('interleaves --click and --type, in both spellings', () => {
    expect(
      lookSteps([
        'https://app.test',
        '--click',
        '[data-testid="new"]',
        '--type=input[name=title]=Q3 plan',
        '--json',
        '--click',
        'role=tab[name="Share"]',
      ]),
    ).toEqual([
      { do: 'click', selector: '[data-testid="new"]' },
      { do: 'type', selector: 'input[name=title]', text: 'Q3 plan' },
      { do: 'click', selector: 'role=tab[name="Share"]' },
    ])
  })

  it('splits --type at the first = outside the selector', () => {
    expect(splitTypeFlag('#q=a=b')).toEqual({ selector: '#q', text: 'a=b' })
    expect(splitTypeFlag('[data-testid="q"]=hello')).toEqual({
      selector: '[data-testid="q"]',
      text: 'hello',
    })
    expect(splitTypeFlag('role=textbox[name="Email"]=a@b.test')).toEqual({
      selector: 'role=textbox[name="Email"]',
      text: 'a@b.test',
    })
    expect(splitTypeFlag('form >> nth=0 >> text="x=y"=z')).toEqual({
      selector: 'form >> nth=0 >> text="x=y"',
      text: 'z',
    })
    expect(splitTypeFlag('#q=')).toEqual({ selector: '#q', text: '' })
    expect(() => splitTypeFlag('#q')).toThrow(/selector>=<text>/)
    expect(() => splitTypeFlag('=x')).toThrow(/selector>=<text>/)
  })

  it('refuses a step flag with no value', () => {
    expect(() => lookSteps(['--click'])).toThrow(/expects a value/)
    expect(() => lookSteps(['--click', '--json'])).toThrow(/expects a value/)
  })
})

describe('the rest of the verb', () => {
  it('reads a viewport, defaulting to the recorder’s', () => {
    expect(parseViewport(undefined)).toEqual({ width: 1280, height: 720 })
    expect(parseViewport('390x844')).toEqual({ width: 390, height: 844 })
    expect(() => parseViewport('wide')).toThrow(/WxH/)
    expect(() => parseViewport('10x10')).toThrow(/200x200/)
  })

  it('lists a control with its proposal and its state', () => {
    const line = controlLine({
      tag: 'button',
      role: 'button',
      name: 'Continue',
      testId: null,
      href: null,
      rect: { x: 10, y: 20, w: 80, h: 32 },
      disabled: true,
      inDialog: true,
      covered: false,
      selector: 'dialog[open] >> role=button[name="Continue"]',
      basis: 'role',
      match: 'unique',
      matches: 1,
    })
    expect(line).toContain('button "Continue"  [in dialog, disabled]')
    expect(line).toContain(
      'dialog[open] >> role=button[name="Continue"]  UNIQUE  @ 10,20 80×32',
    )
    expect(
      controlLine({
        tag: 'a',
        role: 'link',
        name: '',
        testId: null,
        href: '/me',
        rect: { x: 0, y: 0, w: 1, h: 1 },
        disabled: false,
        inDialog: false,
        covered: false,
        selector: null,
        basis: null,
        match: 'none',
        matches: 0,
        redacted: ['email'],
      }),
    ).toContain('a (link) [email withheld]')
  })
})
