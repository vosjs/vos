---
'@vosjs/cli': minor
---

`vos session open <url> --name <app>` opens a plain Chrome window on a vos-owned profile, waits for the person to sign in and close it, and says what the session holds as counts and dates, never a value. `vos session check <name> [--url]` asks whether it still opens the page, in words. `vos record --session <name>` records on it. The system Chrome with the real keychain is the one binary a session is ever read with, because the bundled Chromium cannot decrypt a profile Chrome wrote. `vos push` refuses a take directory holding a storage-state-shaped JSON.
