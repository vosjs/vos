---
'@vosjs/render-core': minor
'@vosjs/cli': minor
---

A `setup` or `teardown` list takes a guard, `{ "do": "if", "selector": "…" }`: when its selector is not on the page (it looks for 3 s, or its `ms`), the steps after it are skipped and the list ends there, which is never a failure. A take that deletes on camera what it created keeps its teardown as the net for a take that stops early: guarded, a good take now says `teardown: nothing to undo, <selector> is not on the page` instead of `TEARDOWN FAILED`, and the done event's teardown carries `skipped: { step, selector, rest }`. A setup that signs in can guard its sign-in the same way, so a session already signed in passes. A step that fails after a guard still fails.
