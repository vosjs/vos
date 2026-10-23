---
'@vosjs/cli': patch
---

`vos push` of a take whose recording the platform already holds (a re-push of a fetched take) no longer prints `uploading recording (… kB)…` before `recording already hosted — reused`: it says it is uploading only once the platform asks for the bytes.
