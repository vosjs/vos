---
'@vosjs/studio-core': minor
'@vosjs/cli': patch
---

A tilted card no longer shows the backdrop through its own edge when the camera is zoomed (or the card is bled past the frame, or it recedes under an end card). The card layer's canvas and plane now grow by exactly how far the pose lets the frame see past its edges, derived from the stage geometry at the live aspect from the tilt and card-pose tracks (`cardVisibleExtent`, `cardOverscanFor` in `@vosjs/studio-core`), replacing the fixed 1.25 overscan that applied only to bled insets.
