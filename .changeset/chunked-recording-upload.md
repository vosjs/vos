---
'@vosjs/cli': minor
---

`vos push` sends a long recording in parts.

A request body has a ceiling the platform cannot raise from inside a
handler: the edge refuses anything past it before the request arrives, with
its own error page rather than a worded refusal. A screen recording of any
real length clears that ceiling at any watchable bitrate, so pushing a take
of more than a couple of minutes failed with a bare status and nothing to
act on.

A file past 32 MB is now declared, sent as parts, and sealed. The part size
comes from the platform's reply rather than a constant here, so the split
can change without a CLI release. Quotas are weighed at the declaring call,
before a byte moves, so a refusal costs nothing and arrives in words; the
content-addressed dedupe answers there too, so re-pushing a hosted take
still sends nothing at all. A part that fails transiently is retried, and
an upload that cannot finish hands its parts back instead of leaving them
held.

Applies to the take's recording and to the other media a document keys
beside it. Small files still go in one request, unchanged.
