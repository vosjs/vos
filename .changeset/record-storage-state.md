---
'@vosjs/cli': minor
---

`vos record` and `vos create` take `--storage-state <file>`: a Playwright
storage state, so the recorder drives a SIGNED-IN product.

Recording a demo of anything behind a login needed the sign-in to be part of
the script, which is impossible when the flow is an emailed code, an SSO hop
or a passkey. The flag hands the recorder a session that already exists, the
way a person would arrive at their own app. Export one from a real browser,
or with `context.storageState({ path })`.
