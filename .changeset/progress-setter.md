---
'@vosjs/tween': patch
---

Fix scrubbing on the sampler backend: `progress(value)` and `time(value)` are
now GSAP-style setters (setter = seek). The playback bridge's SEEK command
calls `timeline.progress(value)` — the getter-only implementation silently
ignored it, so dragging the player's progress bar snapped back to the
pre-drag position.
