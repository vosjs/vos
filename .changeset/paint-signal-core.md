---
'@vosjs/render-core': patch
---

The scroll's "painted" signal is the screencast's next frame, capped at 80 ms, never `requestAnimationFrame`: Chrome fires no animation frame in a tab that is not its window's active one, and a connected fleet browser records in exactly that tab while CDP keeps the screencast flowing, so the previous patch's scroll waited forever there. A rehearsal, which has no screencast, skips the wait.
