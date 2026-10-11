import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHANNEL_SPECS_HASH,
  DESTINATIONS,
  destinationById,
  destinationsForChannel,
} from '../destinations'

/**
 * The staleness gate (the schemaReference.test.ts pattern): the committed
 * DESTINATIONS module carries a hash of the channel specs it was generated
 * from. A channel-specs.json change without
 * re-running scripts/build-destinations.mjs fails here, so `vos
 * deliver` and the export surfaces can never render to a spec the kit data
 * no longer states.
 */
const SPECS_FILE = join(process.cwd(), '../cli/schema/channel-specs.json')

function currentHash(): string {
  const specs = JSON.parse(readFileSync(SPECS_FILE, 'utf8'))
  return createHash('sha256').update(JSON.stringify(specs)).digest('hex')
}

describe('destinations', () => {
  it('is regenerated whenever channel-specs.json changes', () => {
    expect(CHANNEL_SPECS_HASH).toBe(currentHash())
  })

  it('carries the video destinations', () => {
    expect(DESTINATIONS.map((d) => d.id)).toEqual([
      'youtube-main-demo',
      'x-feed-cut',
      'shorts-linkedin-vertical-cut',
      'github-readme-loop',
    ])
    for (const d of DESTINATIONS) expect(d.format).toBe('mp4')
  })

  it('keeps the verified pixel sizes', () => {
    expect(destinationById('youtube-main-demo')?.px).toEqual({
      w: 1920,
      h: 1080,
    })
    expect(destinationById('shorts-linkedin-vertical-cut')?.px).toEqual({
      w: 1080,
      h: 1920,
    })
    expect(destinationById('shorts-linkedin-vertical-cut')?.ratio).toBe('9:16')
  })

  it('a loop takes no words', () => {
    expect(destinationById('github-readme-loop')?.text).toBe('none')
  })

  it('lists a channel in spec order, and nothing for a channel with no video', () => {
    expect(destinationsForChannel('github').map((d) => d.asset)).toEqual([
      'readme-loop',
    ])
    expect(destinationsForChannel('cws')).toEqual([])
  })
})
