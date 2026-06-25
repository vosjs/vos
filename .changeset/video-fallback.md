---
'@vosjs/elements': patch
---

Harden frame-accurate video: graceful fallback + robust demux.

- When the WebCodecs path fails (non-MP4 container, unsupported codec, decode
  error), the video element now falls back to the HTMLVideoElement path instead
  of throwing — a black/failed video is never an acceptable outcome. Applies to
  both `frameSource: 'auto'` and `'webcodecs'`.
- mp4box demux now settles on the track's sample count (or shortly after flush)
  instead of a single microtask, fixing spurious "no samples extracted" when
  mp4box delivers samples across tasks.
