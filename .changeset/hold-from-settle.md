---
'@vosjs/cli': minor
---

A click's `ms` is reading time, held from the page's last visual change; the recorder pays the settle itself. It watches the screencast after the press: a change within 400 ms says the page is answering, 250 ms with no new frame says it has settled, no change within 400 ms says the page did not change, and 1.2 s bounds a page that never stops. Before, the hold started at the press, so the same `ms` was read on one run and dead on the next as the settle varied. Measured on one script twice: every hold within 2 ms of its `ms`, the takes differing by the settle alone. A script whose `ms` was sized to cover the settle now holds longer: size `ms` as a reading beat, about 1 s after a page changed and 0.6 s after a control. The pace report counts a click's `ms` as the script's ask.
