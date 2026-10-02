---
'@vosjs/elements': patch
---

A split text keeps its committed `transform.scale` and rotation. A split word applied only its translate, so a resize or a rotate saved into `config.transform` was dropped on the next load and the word snapped back to its original size and angle. The scale now multiplies under `props.scale` (as a plain element bakes it into its mesh), and the rotation seeds the word's absolute `props.rotation`.
