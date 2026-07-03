---
'@vosjs/editor': minor
---

Element resize/rotate commit helpers, completing the on-canvas editing set:

- **`scaleElementRecipe(config, id, factor)`** — corner-handle resize: folds a
  scale factor into `transform.scale` (floor-clamped so elements stay
  recoverable). Pairs with the ephemeral `props.scale` preview, which
  multiplies the same base — preview and commit land on identical pixels.
- **`rotateElementRecipe(config, id, deltaDeg)`** — rotate-handle drag:
  accumulates into the canonical `transform.rotation` (folding any `rotateZ`
  alias), normalized to (-180, 180].
- **`elementBaseRotation(config, id)`** — the committed rotation hosts need
  for ephemeral rotate previews (the props proxy's `rotation` is absolute).
