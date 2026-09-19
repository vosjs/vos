---
'@vosjs/cli': minor
---

`vos callout --body-px <n>` is the body size on the delivered frame. The size used to be multiplied by the footage scale and then floored, so on a rich capture (a 2560-wide take on a padded frame sits near 0.6) both 14 and 21 printed the same 11 / 20 / 15 and the flag read as ignored: the richer the capture, the smaller the note. An explicit size is no longer rescaled; without the flag the grammar's default stands, a note sized to the app as seen. The verb now prints the three sizes it chose and the footage scale it measured, in words and in `--json` as `sizes`, so a floor is visible instead of silent. The usage line says what `--color` paints: the pin's mark and leader, never the kicker, which is `--accent`.
