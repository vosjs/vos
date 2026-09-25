---
'@vosjs/render-core': patch
---

The audio producer decodes every source through an `OfflineAudioContext` pinned to the mix rate (48 kHz), never a bare `AudioContext`. `decodeAudioData` resamples to its context's rate, and a live context runs at the output device's, so a headset in its hands-free profile (24 kHz) handed the encoder stereo at 24 kHz, which mediabunny reads as HE-AAC v2 and Chrome's AAC encoder refuses. The offline context also holds no device and needs no gesture.
