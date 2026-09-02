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
 * re-running the vosso build script fails here, so `vos
 * deliver` and the export surfaces can never render to a spec the kit data
 * no longer states.
 */
const SPECS_FILE = join(
  process.cwd(),
  '../vos-plugin/schema/channel-specs.json',
)

function currentHash(): string {
  const specs = JSON.parse(readFileSync(SPECS_FILE, 'utf8'))
  return createHash('sha256').update(JSON.stringify(specs)).digest('hex')
}

describe('destinations', () => {
  it('is regenerated whenever channel-specs.json changes', () => {
    expect(CHANNEL_SPECS_HASH).toBe(currentHash())
  })

  it('carries the beachhead destinations', () => {
    const ids = DESTINATIONS.map((d) => d.id)
    for (const id of [
      'cws-screenshot',
      'cws-small-promo-tile',
      'cws-marquee',
      'producthunt-gallery',
      'linkedin-feed-image',
      'og-card',
      'youtube-main-demo',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('derives kinds from the spec shape', () => {
    expect(destinationById('youtube-main-demo')?.kind).toBe('video')
    expect(destinationById('cws-small-promo-tile')?.kind).toBe('still')
    // A counted image asset is a set.
    const shots = destinationById('cws-screenshot')
    expect(shots?.kind).toBe('still-set')
    expect(shots?.count).toEqual({ min: 1, max: 5 })
  })

  it('keeps the verified pixel sizes', () => {
    expect(destinationById('cws-screenshot')?.px).toEqual({ w: 1280, h: 800 })
    expect(destinationById('cws-marquee')?.px).toEqual({ w: 1400, h: 560 })
    expect(destinationById('og-card')?.px).toEqual({ w: 1200, h: 630 })
  })

  it('stills fill their region, videos keep their ratio', () => {
    expect(destinationById('cws-small-promo-tile')?.fit).toBe('cover')
    expect(destinationById('x-feed-cut')?.fit).toBe('contain')
  })

  it('lists a channel in spec order', () => {
    const cws = destinationsForChannel('cws').map((d) => d.asset)
    expect(cws).toEqual(['screenshot', 'small-promo-tile', 'marquee', 'icon'])
  })
})
