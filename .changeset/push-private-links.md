---
'@vosjs/cli': patch
---

`vos push --wait` says when the still and preview links it prints belong to a private vos: they answer 404 to a request without a credential, so a bare fetch read as "the still is missing" when it was only fenced. The line names the fix (the key as a bearer, or a signed-in browser).
