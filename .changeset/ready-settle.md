---
'@vosjs/render-core': minor
'@vosjs/cli': minor
---

The recorder starts a take once the first page has stopped changing (after load, 800 ms with no DOM change, at most 8 s) instead of waiting for network idle, which a page holding a socket open never reaches; `ready: "networkidle"` in actions.json or `--ready networkidle` keeps the old wait, and the done event reports `ready: { mode, ms, capped }`.
