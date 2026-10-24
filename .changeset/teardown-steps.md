---
'@vosjs/render-core': minor
'@vosjs/cli': minor
---

`teardown` steps in actions.json: the setup's verbs, run off camera after a take or a rehearsal (and when a take stops early or throws) to remove what the take created; a failing teardown is reported on the done event and in words, and never fails the take.
