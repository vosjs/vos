---
'@vosjs/studio-core': patch
---

The footage element stays paused on its last frame past the footage's end and inside a hold's freeze piece while the composition plays. An ended element's `play()` rewinds it to zero and the drift guard then seeks it back, which read as frames jumping back and forth under an end card; a hold crawling at the clamped 1/16 speed toward that same end was the same bug in slow motion.
