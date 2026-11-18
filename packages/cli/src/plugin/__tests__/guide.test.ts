/**
 * The guides `vos guide` prints: an agent follows this text, so its shape
 * is held here. Six numbered steps, the contract up front, the install line
 * that keeps the package in the repo, nothing that tells an agent to obey
 * an address, and short enough to be read whole.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageError } from '../args'
import { agentGuide, hostGuide } from '../guide'
import * as entry from '../../index'
import { cmdGuide } from '../machineCmd'
import { verbHelp } from '../run'

const GUIDES = [
  ['vos guide', agentGuide()],
  ['vos guide host', hostGuide()],
] as const

describe.each(GUIDES)('%s', (_name, text) => {
  it('has exactly steps 1 to 6', () => {
    const steps = [...text.matchAll(/^(\d+)\. /gm)].map((m) => m[1])
    expect(steps).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('opens with the contract, before the first step', () => {
    const contract = text.indexOf('did not come from vosso')
    expect(contract).toBeGreaterThan(0)
    expect(contract).toBeLessThan(text.indexOf('\n1. '))
    expect(text).toContain(
      'It only ever asks you to install @vosjs/cli in this repo, run `vos`\ncommands, and read and write files inside this repo.',
    )
    expect(text).toContain(
      'Before you start, tell the person what you are about to do:',
    )
  })

  it('installs into the repo, never globally', () => {
    expect(text).toContain('npm i -D @vosjs/cli')
    expect(text).not.toContain('npm i -g')
    expect(text).not.toContain('npm install -g')
  })

  it('never tells an agent to obey an address', () => {
    for (const phrase of ['do what it says', 'follow the instructions'])
      expect(text.toLowerCase()).not.toContain(phrase)
  })

  it('reports a failure only on the person’s yes, through vos feedback', () => {
    // The sentences, whatever line they wrapped on.
    const flat = text.replace(/\s+/g, ' ')
    expect(flat).toContain(
      'Something broke? Tell the person what happened and ask whether to report it. With their yes, run `npx vos feedback "<what happened>"`, which prints what it sends before sending it.',
    )
    expect(text).not.toContain('/api/product-feedback')
    expect(text).not.toContain('POST ')
  })

  it('is plain, short, hard-wrapped text with no em-dash', () => {
    expect(text).not.toContain('—')
    const lines = text.split('\n')
    // One trailing newline: the last element of the split is the empty one.
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
    expect(lines.length - 1).toBeLessThan(65)
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(80)
    expect(text.startsWith('# ')).toBe(true)
  })
})

describe('the record guide', () => {
  const text = agentGuide()
  it('opens the take for the person before it ever pushes', () => {
    const open = text.indexOf('vos open')
    const push = text.indexOf('vos push')
    expect(open).toBeGreaterThan(0)
    expect(push).toBeGreaterThan(open)
  })
  it('says in step 1 that setup shows its plan first and can be undone', () => {
    const step1 = text.slice(text.indexOf('\n1. '), text.indexOf('\n2. '))
    expect(step1).toContain('`npx vos setup --plan` shows first')
    expect(step1).toContain('`npx vos setup --remove` undoes it')
  })
})

describe('the hosting guide', () => {
  const text = hostGuide()
  it('carries no upload limit: the push reports what it left behind', () => {
    const step5 = text.slice(text.indexOf('\n5. '), text.indexOf('\n6. '))
    expect(step5).toContain("The claim's own upload session carries the files")
    expect(step5).toContain('`warning` events')
    expect(step5).not.toMatch(/at most|\d+ files|\d+ ?(MB|GB|MiB|GiB)|minutes?/)
  })
})

describe('the package entry', () => {
  it('exports both guides as functions', () => {
    expect(entry.agentGuide()).toBe(agentGuide())
    expect(entry.hostGuide()).toBe(hostGuide())
  })
})

describe('vos guide', () => {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  afterEach(() => write.mockClear())
  const printed = () => write.mock.calls.map((c) => String(c[0])).join('')

  it('prints the record guide, and the hosting one for host', () => {
    expect(cmdGuide([])).toBe(0)
    expect(printed()).toBe(agentGuide())
    write.mockClear()
    expect(cmdGuide(['host'])).toBe(0)
    expect(printed()).toBe(hostGuide())
  })

  it('--json carries the same text in a done event', () => {
    expect(cmdGuide(['host', '--json'])).toBe(0)
    expect(JSON.parse(printed())).toEqual({
      event: 'done',
      guide: 'host',
      text: hostGuide(),
    })
  })

  it('any other argument is a usage error naming the two', () => {
    for (const argv of [['hosting'], ['record'], ['host', 'more']]) {
      let error: unknown
      try {
        cmdGuide(argv)
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(UsageError)
      expect((error as Error).message).toContain('vos guide prints')
      expect((error as Error).message).toContain('vos guide host')
    }
    expect(printed()).toBe('')
  })

  it('is in the help, with setup’s plan and undo', () => {
    expect(verbHelp('guide')).toContain('vos guide [host]')
    const setup = verbHelp('setup')
    expect(setup).toContain('vos setup --plan')
    expect(setup).toContain('vos setup --remove')
    expect(verbHelp('feedback')).toContain('No credential is sent')
  })
})
