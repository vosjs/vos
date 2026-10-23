---
'@vosjs/render-core': minor
'@vosjs/cli': minor
---

Every recorder step is bounded by its own timeout (an `expect`'s or an `await`'s, or a gesture's planned time plus 30 s): a page that stops answering ends the step as a skip with the real time it took, `--strict` stops the take there, `--json` reports a `step` event as each step starts and ends, and a rehearsal no longer warns of dead time it cannot have.
