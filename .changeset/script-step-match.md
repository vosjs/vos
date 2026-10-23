---
'@vosjs/cli': patch
---

A step caption and a `zoom` mark are read from the script step the recorded step was made from, even when `actions.json` was edited after recording. A recorded step with no id used to read whatever stood at its old index, so one `expect` added early in the script handed every later unnamed step its neighbour's caption or mark (a join landed a second copy of a caption on a check, and a mark on the typing moved to the key press after it). Now an unnamed recorded step is found beside its recorded named neighbours, else at its own index, and only where the verb and the selector agree.
