---
'@vosjs/cli': patch
---

`vos session open` asks the person to QUIT Chrome, not close the window: on a Mac the last window closing leaves Chrome running, and the command waits for the process, so a closed window left it hanging with nothing saved.
