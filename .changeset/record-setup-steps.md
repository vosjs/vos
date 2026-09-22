---
'@vosjs/cli': minor
---

`actions.json` gains `setup`: steps that run before the camera rolls (a sign-in form, a cookie banner, an onboarding tour), as plain actions with no cursor, no frames, no pace and nothing in `meta.steps`; then the recorder opens `url` again and the take begins where the setup left it. A `type` step's text may be `{ "env": "NAME" }`, read at run time and never logged or stored; a literal typed into a password field is refused. A setup selector that never appears fails the take before anything is recorded. `--header name=value` (repeatable) puts a request header on every request the recording browser makes.
