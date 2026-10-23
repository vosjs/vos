---
'@vosjs/studio-core': patch
---

A follow zoom (`focusMode: "auto"`) on another media follows that media's own pointer. The follow read the primary recording's cursor for every span, and placed a recenter through the first piece of ANY media holding that second, so on a joined take a follow zoom on a later media either never recentered or, on a cut that replays the primary (a cold open), recentered toward where the primary's pointer had been, framing the wrong part of the screen. A recenter is now a moment of the span's own media, mapped through that media's pieces; a cut of the primary alone lowers as before.
