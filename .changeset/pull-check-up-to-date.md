---
'@vosjs/cli': patch
---

`vos pull --check` on a program that is already up to date no longer exits with a usage error claiming it ignored `--check`. The flag was read only on the path where changes exist, so the up-to-date path never touched it and the ignored-flag guard reported it.
