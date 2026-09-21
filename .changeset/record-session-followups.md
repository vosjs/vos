---
'@vosjs/cli': patch
---

Four fixes from agents recording apps behind a login. `vos <verb> --help` prints that verb's usage lines and exits 0 instead of a one-line usage error. The rehearsal's `Next:` line carries `--storage-state`, `--browser-arg=` and `--allow-wall`, so the command it hands you records what it rehearsed instead of the sign-in page. The wall message says a wall is a session problem and not a script bug, and names every way past it, including a person signing in once with `npx playwright open --channel chrome --save-storage`. `vos help` lists exit 4.
