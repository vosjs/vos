---
'@vosjs/core': patch
'@vosjs/elements': patch
---

The editor bridge picks what the frame shows. `HIT_TEST` skips an element that is hidden or faded to opacity 0 at this moment (a press goes through it to what is there), and `GET_ELEMENT_RECTS` reports such an element `visible: false`. A split text is picked by any of its units and boxed as the whole word, through the new `ElementInstance.meshes()`; before, only its first unit could be pressed.
