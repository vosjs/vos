---
'@vosjs/cli': patch
---

`vos check-video` reports a hard cut between two light, sparse pictures: a board of thin outlined boxes and notes on white cutting to the empty canvas changes little on average and over less than a quarter of the frame, because most of both frames is the same ground, so it was not counted. Frames are now compared at 160 px on the long side (at 64 px a thin line averages into the white), and a change that stands alone counts when what changed by a lot is scattered across the frame (a tenth of its cells, inside a box of more than a fifth of it). An app's own change in one frame stays uncounted: a panel or an embed appearing is one block, and a selection tint changes nothing by a lot. A zoom, a pan and a cross-fade are still not cuts.
