---
'@vosjs/cli': minor
---

`vos folder describe <folderId|slug> "<one line>"` changes a folder's description, and `--clear` removes it.

A key could write a folder's description with `vos folder create --desc` and never correct it. The description is the one thing about a folder a key may change: its name, its place on the shelf and who can read it stay the person's, on vos.so.

- The description is one line of at most 200 characters, checked before anything is sent.
- The words it replaced are printed (`previous` under `--json`), because vos.so keeps no history of them.
- On a folder other people can read, the description is shown to their agents. vos.so refuses a line that reads as an instruction to an agent, and the refusal is printed in its words.
