---
'@vosjs/core': minor
'@vosjs/elements': minor
---

`renderAudio`: the sound a program plays, rendered offline.

`@vosjs/core/audio` exports `renderAudio(config, { duration?, sampleRate?, channels?, decode? })`, which samples the program's audio schedule with the same pure tween sampler live playback uses (`props.playing`, `props.currentTime`, `props.gain` on every `AudioElement`, through `retime`) and mixes the decoded sources into plain PCM (`{ sampleRate, length, channels: Float32Array[] }`). No DOM, no pixels: the decoder is injectable (`fetch` + Web Audio's `decodeAudioData` by default where a context exists), so it runs in a Worker or in Node as well as a page, and `toAudioBuffer` wraps the result for a Web Audio consumer. `planAudio` (the schedule as points) and `mixAudio` (the sample-exact mixer) are its two halves, exported for consumers that inspect a schedule or bring their own sources. Every vos author with an `AudioElement` used to get silence in every export.

`AudioElement.gainEnvelope`: `[t, gain]` points over OUTPUT time, linear between them, held flat outside, multiplied with `props.gain`. Fades, ducking and a bed that swells under a title as data. Live playback follows it frame by frame: the render loop now publishes `window.__vos__.outputTime` and runs `window.__vos__.frameCallbacks` once per frame on programs with elements, and a media element with an envelope registers there. Programs without elements compile exactly as before.
