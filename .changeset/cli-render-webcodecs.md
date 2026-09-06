---
'@vosjs/cli': patch
---

`vos render` decodes a take's recording through the WebCodecs sequential provider (frames by PTS, the recording kept as a Blob) instead of an element seek and a settle wait per frame. A 14 s take at 2560×1440 rendered in 9.8 s where it took 59.6 s; the element path could also land footage a frame late in fast motion, which the by-PTS path does not.
