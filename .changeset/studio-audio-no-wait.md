---
'@vosjs/studio-core': patch
---

A document with sound no longer holds its first frame until every clip has downloaded and decoded. The studio entry's setup starts the decodes and returns; a clip that lands after playback has begun is scheduled on the next playing frame at the right offset. Exports are unaffected: they mix offline.
