---
'@vosjs/studio-core': patch
---

The take's `frame.background` reads every CSS gradient stop. A stop with a position (`#2b6f64 40%`) was handed to canvas whole, which throws, so a background like `radial-gradient(ellipse at 88% 4%, #2b6f64 0%, #060808 80%)` took the whole frame down. Stops now keep their positions (unplaced ones spread evenly, the way CSS places them), every stop is kept rather than only the first and last, an `rgba()` stop is no longer split at its own commas, `linear-gradient(to right, …)` reads its direction, and a stop canvas still cannot parse falls back to the known ground instead of throwing.
