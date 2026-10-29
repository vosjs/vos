import { describe, expect, it } from 'vitest'
import { latestOnly } from '../video/latestOnly'

/** A job whose runs finish only when the test says so. */
function controlledJob() {
  const runs: Array<{ target: number; finish: (err?: Error) => void }> = []
  let inFlight = 0
  let maxInFlight = 0
  const run = (target: number) =>
    new Promise<void>((resolve, reject) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      runs.push({
        target,
        finish: (err) => {
          inFlight--
          if (err) reject(err)
          else resolve()
        },
      })
    })
  return { run, runs, max: () => maxInFlight }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('latestOnly', () => {
  it('runs one call at a time', async () => {
    const job = controlledJob()
    const seek = latestOnly(job.run)
    void seek(1)
    void seek(2)
    void seek(3)
    await tick()
    expect(job.runs.map((r) => r.target)).toEqual([1])
    job.runs[0].finish()
    await tick()
    job.runs[1].finish()
    await tick()
    expect(job.max()).toBe(1)
  })

  it('skips targets a later call replaced, and always reaches the latest', async () => {
    const job = controlledJob()
    const seek = latestOnly(job.run)
    void seek(1)
    void seek(2)
    void seek(3)
    void seek(4)
    await tick()
    job.runs[0].finish()
    await tick()
    expect(job.runs.map((r) => r.target)).toEqual([1, 4])
    job.runs[1].finish()
    await tick()
    expect(job.runs).toHaveLength(2)
  })

  it('settles a call only once its own target or a newer one is done', async () => {
    const job = controlledJob()
    const seek = latestOnly(job.run)
    let firstDone = false
    let secondDone = false
    void seek(1).then(() => (firstDone = true))
    await tick()
    void seek(2).then(() => (secondDone = true))
    job.runs[0].finish() // target 1 done, but 2 is wanted now
    await tick()
    expect(secondDone).toBe(false)
    job.runs[1].finish()
    await tick()
    expect(firstDone).toBe(true)
    expect(secondDone).toBe(true)
  })

  it('runs every call when each is awaited before the next (a capture)', async () => {
    const seen: number[] = []
    const seek = latestOnly(async (t: number) => {
      await tick()
      seen.push(t)
    })
    for (const t of [0, 1, 2, 3]) await seek(t)
    expect(seen).toEqual([0, 1, 2, 3])
  })

  it('starts a fresh run for a call made after the last one ended', async () => {
    const job = controlledJob()
    const seek = latestOnly(job.run)
    const first = seek(1)
    await tick()
    job.runs[0].finish()
    await first
    void seek(2)
    await tick()
    expect(job.runs.map((r) => r.target)).toEqual([1, 2])
  })

  it('rejects the calls waiting on a run that fails, and recovers', async () => {
    const job = controlledJob()
    const seek = latestOnly(job.run)
    const failing = seek(1)
    await tick()
    job.runs[0].finish(new Error('decode failed'))
    await expect(failing).rejects.toThrow('decode failed')
    const next = seek(2)
    await tick()
    job.runs[1].finish()
    await expect(next).resolves.toBeUndefined()
  })
})
