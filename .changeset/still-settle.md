---
'@vosjs/core': patch
---

The thumbnail capture settles its decodes the way the video loop does: the program's frame-prep hooks run after the seek, pending decodes are awaited, the frame is painted, and a paint that asked for more is waited for and painted again. One animation frame after a cold seek used to capture whatever a video element had already decoded, the first frame of a video seeked for the first time.
