---
'@vosjs/core': minor
---

capture templates gain runtime-input and audio capabilities:

- `capture.data` — JSON-injected into the page and passed to `initVos` as `deps.data` (capture-video AND capture-thumbnail). Data-dependent compositions (constant program + inputs in `ctx.data`) now render correctly in capture modes instead of falling back to baked config data.
- `capture.audioProducerCode` (capture-video) — host-supplied JavaScript defining `window.__vosAudioProducer__ = async ({ data, duration, sampleRate }) => AudioBuffer | null`; the template calls it and muxes the returned buffer as the output's audio track (AAC for mp4 with automatic Opus fallback where AAC encode is unavailable, Opus for webm). The engine imposes no audio schema — producers interpret `data` however the host defines. Without a producer, zero audio code is emitted.
