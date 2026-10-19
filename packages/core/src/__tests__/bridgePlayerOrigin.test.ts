import { describe, expect, it } from 'vitest'
import { generateRenderTemplate } from '../runtime/renderTemplate'
import { VOS_BRIDGE_PROTOCOL } from '../runtime/bridge'

/**
 * Protocol 11 is what lets a host frame the player on ANOTHER origin: the
 * manifest arrives resolved on LOAD, a `blob:` key arrives as the Blob
 * itself and is re-minted inside the document, the drawn frame is handed
 * back as a Blob on request, and only the framing window drives the bridge.
 */
const html = generateRenderTemplate('', { mode: 'playback' })

describe('the playback bridge on a foreign origin (protocol 11)', () => {
  it('advertises protocol 11', () => {
    expect(VOS_BRIDGE_PROTOCOL).toBe(11)
    expect(html).toContain(`protocol: 11`)
  })

  it('hands the host-resolved manifest to the program and keeps it across warm loads', () => {
    expect(html).toContain(
      'if (payload && payload.assets != null) __assets = payload.assets;',
    )
    expect(html).toContain('if (__assets != null) deps.assets = __assets;')
  })

  it('re-mints transferred Blobs as its own object URLs on LOAD and SET_DATA', () => {
    expect(html).toContain('__takeBlobs(payload && payload.blobs);')
    expect(html).toContain('__takeBlobs(msg.blobs);')
    expect(html).toContain('__blobUrls[key] = URL.createObjectURL(blob);')
    expect(html).toContain('__withBlobs(payload.data)')
    expect(html).toContain('__withBlobs(payload.stack)')
  })

  it('answers CAPTURE_FRAME with the canvas as a Blob', () => {
    expect(html).toContain("case 'CAPTURE_FRAME':")
    expect(html).toContain(
      "__post({ type: 'FRAME', requestId: msg.requestId, blob: blob || null })",
    )
  })

  it('takes commands from its parent (or itself) and from no other window', () => {
    expect(html).toContain(
      'if (e.source !== window.parent && e.source !== window) return;',
    )
  })
})
