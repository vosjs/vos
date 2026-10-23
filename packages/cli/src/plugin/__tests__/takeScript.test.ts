import { describe, expect, it } from 'vitest'
import { publicScript, scriptFromText, scriptToWrite } from '../takeScript'

describe('a pushed script carries no setup value', () => {
  it('replaces a typed literal, keeps an env name, strips a setup address to its path', () => {
    const out = publicScript({
      url: 'https://x.test/app?tab=2',
      setup: [
        { do: 'type', selector: '#email', text: 'robin@example.com' },
        { do: 'type', selector: '#pw', text: { env: 'DEMO_PW' } },
        { do: 'goto', url: 'https://x.test/magic?token=abc#frag' },
        { do: 'click', selector: '#go' },
      ],
      steps: [{ do: 'type', selector: '#q', text: 'on camera' }],
    })
    expect(out.setup).toEqual([
      { do: 'type', selector: '#email', text: '[typed value not stored]' },
      { do: 'type', selector: '#pw', text: { env: 'DEMO_PW' } },
      { do: 'goto', url: 'https://x.test/magic' },
      { do: 'click', selector: '#go' },
    ])
    // The take's own address and the on-camera steps are what the take shows.
    expect(out.url).toBe('https://x.test/app?tab=2')
    expect(out.steps).toEqual([
      { do: 'type', selector: '#q', text: 'on camera' },
    ])
    expect(publicScript({ url: 'https://x.test', steps: [] })).toEqual({
      url: 'https://x.test',
      steps: [],
    })
  })

  it('names a peer’s sign-in by its file name only, never this machine’s path', () => {
    const script = {
      steps: [{ do: 'wait', ms: 1 }],
      peers: [
        {
          id: 'bob',
          storageState: '/Users/someone/.config/vos/bob.json',
          steps: [{ do: 'wait', ms: 1 }],
        },
        { id: 'cy', steps: [{ do: 'wait', ms: 1 }] },
      ],
    }
    expect(publicScript(script).peers).toEqual([
      { id: 'bob', storageState: 'bob.json', steps: [{ do: 'wait', ms: 1 }] },
      { id: 'cy', steps: [{ do: 'wait', ms: 1 }] },
    ])
  })
})

describe('the script travels with the take', () => {
  it('reads an object and refuses anything else', () => {
    expect(scriptFromText('{"url":"https://x.test","steps":[]}')).toEqual({
      url: 'https://x.test',
      steps: [],
    })
    expect(scriptFromText('[1]')).toBeNull()
    expect(scriptFromText('not json')).toBeNull()
  })

  it("writes the document's script beside a fetched take, never over a local one", () => {
    const doc = {
      source: { script: { url: 'https://x.test', steps: [{ do: 'wait' }] } },
    }
    expect(scriptToWrite(doc as never, false)).toBe(
      `${JSON.stringify(doc.source.script, null, 2)}\n`,
    )
    expect(scriptToWrite(doc as never, true)).toBeNull()
    expect(scriptToWrite({ source: {} } as never, false)).toBeNull()
  })
})
