import { describe, expect, it } from 'vitest'
import { scriptFromText, scriptToWrite } from '../takeScript'

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
