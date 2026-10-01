---
'@vosjs/elements': minor
---

A split text element's `props` move the WORD. They were built on the first unit's mesh, so `props.x`, `opacity`, `scale` and `rotation` moved, faded and turned one letter while the rest stood still, and a program had to move every letter by hand. They are now the word's group: `x`/`y`/`z` offset every unit, `opacity` multiplies each unit's own, `scale` and `rotation` scale and turn the word about its centre (`rotationX`/`rotationY` add to each unit's own), and `zIndex` reorders the units together. Each unit's `segments` props still animate the letter, composed under the word's, so letters can rise one by one while the word drifts. A data edit that rebuilds the units keeps the offset the timeline gave the word. A drag in the studio moves the whole word. Elements that are not split are unchanged.
