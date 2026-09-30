---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

A program chooses its cover.

- studio-core: `ProgramAnchorDoc.still` (output seconds) and `programStillTime(doc)`, which clamps it to the program's output length after any retime and says nothing when none is declared, so a host keeps its default.
- cli: `vos push config.json --still <seconds>` writes the cover into the program's `doc.json` (minting a minimal program document when there is none), so every later push keeps it; a new vos pushed without one says the platform picks an early frame. A take's cover stays its own `doc.json` `still`, and `--still` on a take push is refused in words. `schema/doc.schema.json` documents the field.
