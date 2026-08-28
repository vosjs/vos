---
'@vosjs/editor': minor
---

`classifyEdit` knows the program stack: `LoweredProgram.stack` carries each entry's own data keyed by id, a `LOAD` sends it as `stack`, and an entry whose data changed by reference gets its own `SET_DATA { target }` (bridge protocol 5) while the main program's data and the other entries stay untouched.
