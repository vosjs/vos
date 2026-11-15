---
'@vosjs/studio-core': patch
---

A take's footage follows the clock while it plays without asking for a seek faster than a seek can land. The element is stepped only when it has drifted further than a step is worth: one seek in flight (only a cut re-aims it), a leash measured in output time for a sped-up piece and never under what a seek costs on that element, a step aimed where the playhead will be when it lands, and a landing checked once. A fast speed span no longer freezes the picture in Chromium, where every frame used to restart the seek before it; footage with a sound track no longer seeks on every other frame at 4×; and in Safari footage with sound settles at 1× where it never did. The paused step and every export are unchanged.
