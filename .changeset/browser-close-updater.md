---
'@vosjs/cli': patch
---

A browser the CLI launches closes at once on macOS. Google Chrome starts its updater 19 s after launch and hands it the browser's stdout and stderr, and closing the browser waited for the updater to finish: seconds on an idle machine, minutes with several browsers at once, so a verb that ran past 19 s could sit after its work was done. Every launch, a session profile's included, now passes Chromium's `--disable-updater-scheduler`, which does nothing where there is no updater.
