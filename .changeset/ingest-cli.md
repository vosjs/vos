---
'@vosjs/cli': minor
---

`vos ingest <video> [--cursor <trace>] [--out take]`: a take directory from a recording someone else made. The file becomes `recording.<container>` (stream-copied into a seekable container, or copied as it is), `meta.json` comes from its own dimensions, length and frame rate, and a trace beside it becomes `cursor.json`: a Playwright `trace.zip` (clicks with their points and times, from the page's creation), stamped JSON records, or a CSV of `t,x,y,type`. The fresh plan then zooms on the trace's clicks; without a trace nothing is planned and the done event says so. What a trace cannot give is named, never guessed.
