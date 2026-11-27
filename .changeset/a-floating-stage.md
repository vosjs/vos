---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

A stage's windows can float: nothing behind them but the backdrop.

`vos record --app <A> --app <B> --float` records a stage with nothing painted where it holds nothing. A video file carries no transparency, so the take's file holds the picture with a matte in a strip under it, and `meta.matte` says where the matte stands (`FootageMatte`). The card draws such a take through its matte: there is no card behind the windows and no edge to clip them to, each window keeps its own shape, and the frame's shadow is cast by the windows themselves. The picture rides the crop every draw of footage already takes, so nothing that draws the file shows the strip; where the picture cannot be drawn through its matte (no WebGL2) it is drawn as it is, on black. `--float` is not given with `--desk`, works with a script, and needs `@vosjs/driver` 0.6.0, said when the installed helper is older.

A kept menu bar (`--desk menubar`) no longer shows the mark the system adds while a screen is recorded, where the helper can find it.
