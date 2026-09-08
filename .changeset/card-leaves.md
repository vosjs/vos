---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

The card is on screen exactly while its clip runs (the footage, freezes included) and is gone after it, like every layer: past the footage the clips play over the ground alone, and the card's `anim.exit` plays over the clip's last seconds and ends gone (a recede steps back first and fades last). An end card is a freeze of the last frame under its words: a legacy `endCard` migrates to one, the house end card writes one (`from: 'endcard'`), a template that ends on a freeze lays it onto the take with its clips, and a loop drops it with them. A freeze takes `from`.
