/**
 * Run an async job for the LATEST target only, one run at a time.
 *
 * A call made while a run is in flight does not start a second one: it
 * records its target as the latest, and the run in flight goes on to it once
 * it ends, skipping any target a later call has already replaced. Every
 * call's promise settles once a run has completed for a target at least as
 * new as its own, so awaiting a call means its frame (or a newer one) is
 * done.
 *
 * This is what makes a frame-accurate video seekable from a live render
 * loop: the decoder is one stateful resource, so two seeks in flight at once
 * corrupt each other, and a seek per frame outruns it. A capture awaits each
 * call before the next, so it sees exactly one run per call, as before.
 */
export function latestOnly<T>(
  run: (target: T) => Promise<void>,
): (target: T) => Promise<void> {
  let wanted: { target: T } | null = null
  let running: Promise<void> | null = null

  const drain = async (): Promise<void> => {
    try {
      while (wanted) {
        const { target } = wanted
        wanted = null
        await run(target)
      }
    } finally {
      // Synchronous with the loop's last check, so a call can never land
      // between "nothing left" and "not running" and be dropped.
      running = null
    }
  }

  return (target: T) => {
    wanted = { target }
    if (!running) running = drain()
    return running
  }
}
