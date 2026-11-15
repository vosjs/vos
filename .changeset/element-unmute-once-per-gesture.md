---
'@vosjs/elements': patch
---

A playing `video` or `audio` element that a browser refused to play with sound tries to lift its mute once for each gesture in the document, never on every frame. 0.12.3 lifted it as soon as the page had ever been touched, which Chrome allows for good and Safari does not: Safari pauses an element unmuted outside a gesture, and the element was then muted, played, unmuted and paused again on every other frame until the next tap. A host that lifts the mute itself inside its gesture is left to.
