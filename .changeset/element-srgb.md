---
'@vosjs/elements': patch
'@vosjs/cli': patch
---

Element colours render as authored. Text, svg and image element textures are now marked sRGB; without it the renderer treated their pixels as linear and encoded them again, so every element colour came out lighter (`#FF4D2E` rendered as `#FF9576`). Programs render darker and more saturated than before, which is the colour their authors wrote. The CLI ships the 0.7.1 skills catalog, with `vos-port`.
