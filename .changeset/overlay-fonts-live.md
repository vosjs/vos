---
'@vosjs/studio-core': patch
---

The studio entry registers the house text faces the first time a text overlay paints, not only in SETUP. A title added to a fresh session used to paint in the stack's system fallback until the next cold load, because a live data update never re-runs SETUP. SETUP now marks the faces it loads, so the live path never registers one twice.
