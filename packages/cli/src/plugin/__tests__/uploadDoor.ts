/**
 * The platform's upload door, for a test server: a file is declared, sent
 * as parts, and sealed. A test hands each request here first and answers
 * with what comes back; `null` means the request is not the door's. It
 * answers the account door and a claim's (`/api/claim/uploads/files`),
 * which speak the same protocol.
 */
const DOOR = '(/api/assets/uploads|/api/claim/uploads/files)'
const MiB = 1024 * 1024

export interface DoorReply {
  status: number
  payload: Record<string, unknown>
}

export function uploadDoor(
  /** The stored asset the sealing call answers, from what was declared. */
  assetFor: (declared: Record<string, unknown>) => Record<string, unknown>,
) {
  const declared = new Map<string, Record<string, unknown>>()
  let n = 0
  return (
    method: string,
    url: string,
    body: Record<string, unknown> | null,
  ): DoorReply | null => {
    if (new RegExp(`^${DOOR}$`).test(url) && method === 'POST') {
      const id = `up-${++n}`
      declared.set(id, body ?? {})
      return {
        status: 201,
        payload: { uploadId: id, partBytes: 16 * MiB, partCount: 1 },
      }
    }
    const part = new RegExp(`^${DOOR}/([^/]+)/parts/(\\d+)$`).exec(url)
    if (part && method === 'PUT') {
      return {
        status: 200,
        payload: { partNumber: Number(part[3]), etag: `etag-${part[3]}` },
      }
    }
    const done = new RegExp(`^${DOOR}/([^/]+)/complete$`).exec(url)
    if (done && method === 'POST') {
      const asset = assetFor(declared.get(done[2]) ?? {})
      return {
        status: 201,
        payload: {
          asset: { fileUrl: `/api/assets/${String(asset.id)}/file`, ...asset },
          notes: [],
        },
      }
    }
    return null
  }
}
