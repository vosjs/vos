---
'@vosjs/cli': minor
---

A flag a verb never read is no longer swallowed. The parsers accept any `--name`, so `vos frames <take> --at 3,5,8` used to write five evenly spread stills and exit 0: the flag is `--times`, and nothing ever looked at `at`. Every verb now records which flags it actually read, and a run that succeeded while ignoring one exits 2 and says so: the command RAN, which flag it ignored, the documented flag it most likely meant, and the flags the verb reads. Reading is recorded rather than declared per verb, so a real flag can never be refused by a list that drifted.
