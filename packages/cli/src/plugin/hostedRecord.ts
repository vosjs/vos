/**
 * `vos record --hosted`: the take is recorded ON vos.so's fleet, for a
 * machine with no browser (a cloud agent, CI, a chat host). The same
 * actions.json goes up, the platform records, encodes, plans and lands it
 * as a private vos with its doc.json and its digest, and this brings the
 * take home with `vos fetch --media`, so the directory that results is the
 * take directory every other verb reads.
 *
 * What travels: the script, the viewport, `--header` values, and the value
 * of every `{ "env": "NAME" }` a setup step reads, taken from THIS shell.
 * What never travels: a session (`--session`, `--storage-state`), because
 * none of a person's ever reaches vos.so; a page behind a sign-in fails on
 * the fleet in words naming the local ladder, exit 4.
 */
import { setupEnvNames } from '@vosjs/render-core/record'
import { apiError, apiJson } from './platform'
import type { ActionsFile } from '@vosjs/render-core/record'

export interface HostedRecordInput {
  origin: string
  key: string | null
  url: string
  actions: ActionsFile
  headers: Record<string, string>
  title?: string
  folderId?: string
  /** The shell the `{ env }` names resolve from. */
  env: Record<string, string | undefined>
  log: (line: string) => void
  /** Wall-clock sleep between polls; tests hand in a fast one. */
  sleep?: (ms: number) => Promise<void>
  /** Give up waiting after this long (the fleet's own cap is far shorter). */
  timeoutMs?: number
}

export interface HostedRecordJob {
  id: string
  status: string
  error: string | null
  vosId: string
  versionId: string | null
  telemetry: Record<string, unknown> | null
}

export type HostedRecordOutcome =
  | {
      ok: true
      vosId: string
      jobId: string
      job: HostedRecordJob
      studio: string
    }
  | {
      ok: false
      wall: boolean
      error: string
      vosId: string | null
      jobId: string | null
    }

const POLL_MS = 3000
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000

/** The env the request carries: every name the setup reads, from this shell. */
export function hostedEnv(
  actions: ActionsFile,
  shell: Record<string, string | undefined>,
): { env: Record<string, string>; missing: string[] } {
  const env: Record<string, string> = {}
  const missing: string[] = []
  for (const name of setupEnvNames(actions.setup)) {
    const v = shell[name]
    if (v === undefined || v === '') missing.push(name)
    else env[name] = v
  }
  return { env, missing }
}

/** A refusal the fleet wrote for a sign-in, told apart from every other failure. */
export function isWallError(error: string | null | undefined): boolean {
  // The row's error wears the job's `[kind]` prefix; the sentence is the tell.
  return !!error && /^(\[\w+\] )?The page is behind a sign-in/.test(error)
}

export async function recordHosted(
  input: HostedRecordInput,
): Promise<HostedRecordOutcome> {
  const sleep =
    input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const posted = await apiJson(input.origin, '/api/record/jobs', {
    method: 'POST',
    key: input.key,
    body: {
      url: input.url,
      actions: input.actions,
      viewport: input.actions.viewport,
      ...(Object.keys(input.headers).length ? { headers: input.headers } : {}),
      ...(Object.keys(input.env).length ? { env: input.env } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.folderId ? { folderId: input.folderId } : {}),
    },
  })
  if (posted.status !== 202) {
    return {
      ok: false,
      wall: false,
      error: apiError('record on vos.so', posted),
      vosId: null,
      jobId: null,
    }
  }
  const job = posted.body.job as { id: string; vosId: string }
  const vos = posted.body.vos as { studio?: string } | undefined
  const cap = posted.body.cap as { seconds?: number } | undefined
  input.log(
    `queued on vos.so as job ${job.id.slice(0, 8)} (vos ${job.vosId}${cap?.seconds ? `, cap ${cap.seconds}s` : ''})`,
  )

  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let lastStatus = 'queued'
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    const polled = await apiJson(input.origin, `/api/record/jobs/${job.id}`, {
      key: input.key,
    })
    if (polled.status !== 200) {
      return {
        ok: false,
        wall: false,
        error: apiError(`poll record job ${job.id}`, polled),
        vosId: job.vosId,
        jobId: job.id,
      }
    }
    const state = polled.body.job as HostedRecordJob
    if (state.status !== lastStatus) {
      input.log(`${state.status}…`)
      lastStatus = state.status
    }
    if (state.status === 'completed') {
      return {
        ok: true,
        vosId: state.vosId,
        jobId: state.id,
        job: state,
        studio: vos?.studio ?? `${input.origin}/studio?vos=${state.vosId}`,
      }
    }
    if (state.status === 'failed' || state.status === 'canceled') {
      const error =
        state.error ??
        (state.status === 'canceled'
          ? 'the record job was canceled'
          : 'the record job failed')
      return {
        ok: false,
        wall: isWallError(error),
        error,
        vosId: state.vosId,
        jobId: state.id,
      }
    }
  }
  return {
    ok: false,
    wall: false,
    error: `the record job ${job.id} did not finish within ${Math.round((input.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 60000)} min; poll ${input.origin}/api/record/jobs/${job.id}`,
    vosId: job.vosId,
    jobId: job.id,
  }
}
