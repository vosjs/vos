---
'@vosjs/core': minor
---

Live update: edit a running instance without re-initialization.

- `ctx.data` is now a live getter over a mutable internal (mirroring `ctx.time`/
  `ctx.progress`); the instance returned by `initVos` gains `setData(next)` (and
  `getData()`). `onFrame` reads the new data next frame — no re-init. Each snapshot is
  frozen, preserving determinism. Values baked into GSAP tweens at `createTimeline` time
  are not retroactive (that is a program edit).
- The playback render template now **boots empty** and ships a consolidated host⇄iframe
  **bridge** (previously a host-side script): `LOAD { code, data, autoplay }` warm-swaps the
  program in place, preserving transport (playhead, playing, rate); `SET_DATA { data }`
  applies live data; transport stays `PLAY/PAUSE/SEEK/PLAY_SPEED`. Emits
  `BRIDGE_READY/READY/UPDATE/ERROR`. Backward compatible: a baked
  `window.USER_CODE_BLOB_URL` still auto-loads.

This lets editors (e.g. an in-browser studio) update the preview without the
flash/replay-from-0 of a full iframe reload. See ENGINE_LIVE_UPDATE_STRATEGY.
