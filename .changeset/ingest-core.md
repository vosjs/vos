---
'@vosjs/studio-core': minor
---

Cursor tracks from the traces other tools leave beside a recording, pure: `cursorFromPlaywrightTrace` (version 8 traces: `before`/`after`/`input` events, the page's creation as time zero, the context's viewport and wall clock), `cursorFromCsv` (`t,x,y,type`), `cursorFromRecords` (JSON records with a time and a point; agent-browser's own log has neither, so those are named), `cursorFromTrace` (by name and text), and a zip table-of-contents reader (`zipEntries`, `zipEntryBytes`, `playwrightTraceEntry`) so a host inflates a `trace.zip` its own way. `RecordingMeta.producer` gains `ingest`.
