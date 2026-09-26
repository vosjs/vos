# Sessions: recording a product behind a login

A recorder with no session records the wall: the sign-in page, or wherever
the site sends a stranger (often a public page, with nothing on it that
looks like a sign-in), and the only symptom is a skipped selector. Settle
the session BEFORE you write the script.

Walk the ladder top to bottom and stop at the first rung that holds. It is
ordered by who pays. Rungs 0 to 2 cost the human nothing and survive every
re-record; rung 3 costs one sign-in; rung 4 costs a recording. Jumping to
rung 3 because it is the most general turns a loop that re-makes itself
into a chore someone has to show up for.

## 0. No wall

A public page, a demo mode, a local dev server with auth off, a preview
deployment. If the feature shows the same there, record there. A preview
behind a bypass header alone (Vercel's `x-vercel-protection-bypass`) is
`vos record … --header x-vercel-protection-bypass=$TOKEN` (0.43 and later):
the token comes from the shell, never from the script.

## 1. Mint, from the test auth the project already has

You are usually standing in the maker's repo, and its e2e suite very often
signs in with no human. Look before you ask anyone anything:

- `playwright/.auth/*.json`, an `auth.setup.ts`, a `storageState` in
  `playwright.config.*`
- `@clerk/testing`; a Supabase service key in `.env.test`
  (`auth.admin.generateLink`); a Firebase custom token
- a seed script, a test-only sign-in route, a session table plus a signing
  secret in the dev env

Run what is there, WITH THE APP ALREADY RUNNING: a project's auth setup
signs in through the real page, so it needs the server up first (usually
`npx playwright test --project=setup`, or whatever the repo's README names).
The artifact is a Playwright storage state, which is exactly what
`--storage-state` takes:

```bash
vos record --actions actions.json --out take --storage-state "$STATE" --dry-run
vos record --actions actions.json --out take --storage-state "$STATE" --strict --json
```

This is the only rung that works in CI, and the only one that survives take
fifty. A Firebase session lives in IndexedDB, which a plain state file
drops: save it with `context.storageState({ path, indexedDB: true })`
(Playwright 1.51 and later).

## 2. Script the form, off camera

A local or self-hosted instance where you can create the account, or a
seeded user whose password is in an env var. Put the sign-in in `setup`
in `actions.json` (`@vosjs/cli` 0.43 and later): it runs after the first
navigation and BEFORE a frame is captured, with no cursor, no frames and
nothing in `meta.steps`, then the recorder opens `url` again and the take
begins signed in. No state file, nothing to mint, nothing to delete.

```json
{
  "url": "http://localhost:3000/dashboard",
  "setup": [
    { "do": "goto", "url": "http://localhost:3000/login" },
    { "do": "type", "selector": "#email", "text": "demo@acme.test" },
    { "do": "type", "selector": "#password", "text": { "env": "DEMO_PASSWORD" } },
    { "do": "press", "key": "Enter", "ms": 800 }
  ],
  "steps": [ ... ]
}
```

The password comes from the SHELL at run time (`{ "env": "NAME" }`) and is
never logged or stored: the log names the field, never the value.
`validate` refuses a literal typed into a password field, because
`actions.json` is committed and pushed with the take. Export the variable
in the shell that runs `vos record`; an unset one exits 2 in words. A
setup selector that never appears fails the take before anything is
recorded, so rehearse the setup with `--dry-run` like everything else. A
wrong password runs the setup and then meets the wall (exit 4), which is
the check working.

The same field dismisses a cookie banner, a "choose your editor" modal or
an onboarding tour off camera: a `click` on the dismiss, before the take.

Never put the sign-in in `steps`: every step there is IN the footage, and
a typed value is logged.

On an older CLI, or for an account you are creating: a few lines of
Playwright, then record with `--storage-state`. `playwright` is already
installed (it arrives with `@vosjs/cli`), launch the SYSTEM Chrome
(`channel: 'chrome'`), and run the script from INSIDE the project so the
import resolves; only the STATE FILE lives outside the repo.

```js
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext()
const page = await context.newPage()
await page.goto('http://localhost:3000/login')
await page.fill('input[name=email]', 'demo@acme.test')
await page.fill('input[name=password]', process.env.DEMO_PASSWORD) // or, for an account you are creating, a random throwaway you never print
await page.click('button[type=submit]')
await page.waitForURL('**/dashboard')
await context.storageState({ path: process.env.STATE })
await browser.close()
```

## 3. The human signs in once

A production app behind an emailed code, SSO, a passkey or a CAPTCHA:

```bash
vos session open https://app.example.com --name acme
```

A plain Chrome window opens on a profile vos owns (`@vosjs/cli` 0.45 and
later). Tell the human one sentence: a browser window opened, sign in with
a demo account and quit Chrome (⌘Q on a Mac; closing the window is not
quitting, Chrome stays running and the command keeps waiting). The
command returns when Chrome exits, and that is the moment the session is
saved; "I signed in" and "the session is saved" are different things, and
a person reports the first.
It then prints what the session holds as counts and dates, never a value.
Then:

```bash
vos session check acme --url https://app.example.com/dashboard   # still opens signed in? exit 0, or 4
vos record --actions actions.json --out take --session acme --dry-run
vos record --actions actions.json --out take --session acme --strict --json
```

`--session` and `--storage-state` are two doors to one take; pass one.
No file to mint, nothing in the take, nothing to delete: the profile lives
under `~/.config/vos/sessions/` and `vos push` refuses a take that holds a
state file. A re-record that exits 4 is the session expired: `vos session
check` says so and prints the `open` command to run again.

Google sign-in refuses an automated browser, which is why `open` is a
plain window: it goes through there. If the person cannot be at the
keyboard now, go to rung 4; do not wait on a window nobody will close.

On an older CLI: `npx playwright open --channel chrome
--save-storage="$STATE" <url>` writes a state file when the window closes,
for `--storage-state`. `--channel chrome` uses the system Chrome; without
it the command wants Playwright's own Chromium, which is usually not
installed.

**The human is not there right now?** Do not open a window nobody will see
and do not block on it. Get everything else ready (the script written and
validated, a rehearsal that exits 4 to prove the wall is the only thing
left), then STOP and leave the ask in the words you would say: the one
`vos session open` command, "sign in with a demo account and quit
Chrome", and the record command that follows. Ask, in the same note,
whether there is a faster way in you cannot see (a seeded account, a test
sign-in route): that turns the next re-record into rung 1.

## 4. The human records, you cut

Hand them the flow you worked out, as a shot list. Write `actions.json`
as you would for any take, give the steps ids and captions a person could
follow, then:

```bash
vos actions script actions.json
```

It prints the beats in plain words with the holds you asked for, the page
to start on and about how long (`@vosjs/cli` 0.44 and later). Put that in
your handoff with one sentence: record it with the vosso extension in your
own signed-in browser, press the icon again to stop, and it lands on your
shelf. When it does, `vos pull <vos-id> --out take --media` brings it down
and you cut it (the `vos-cut` skill): the beats you wrote are the moments
you will be looking for in the digest. This is a rung, not a failure. "I
cannot get in; here is the shot list, record it and I will cut it" is the
honest best thing, and the script survives for the day rung 1 or 2 opens.

A recording a person made has no `mask` and no exposure list (the scan
needs the page): look at the digest's frames yourself and say what they
show, before anything is pushed further or handed over.

## Rules, at every rung

- **Never type, ask for, or accept a production password, code or token.**
  If a human offers one in chat, decline and use rung 3.
- **The state file holds live credentials.** Keep it outside every take
  directory and outside git: a temp dir, or the gitignored path the project
  already uses. `vos push` uploads the recording and `doc.json`, never a
  state file, and nothing about a session ever goes to vos.so.
- **Delete the state file when the video is done**, unless the project
  keeps one on purpose (a gitignored `playwright/.auth`). It is cheap to
  mint again and it is a live credential for as long as it sits there.
- **A session expires.** When a re-record that worked last week skips its
  first selector, re-walk the ladder before touching the script.
- **A person signing in will use their REAL account**, whatever you asked
  for: it is the one they have. The recorder looks for you (`@vosjs/cli`
  0.42 and later): the rehearsal ends with `EXPOSED in the frame`, naming
  the KIND and the place of what it saw (an email address, something shaped
  like a key, a card number or its visible tail; addresses on `example.com`
  or a `.test` domain are demo data and are not reported). Read that list
  BEFORE you record. It also lands in the done event's `exposures`, in
  `vos validate <take>` and in the digest.
- **Hide it before the camera rolls, with `mask` in `actions.json`.** The
  selector in each report reaches that element and no other, so paste it:
  ```json
  "mask": [
    { "selector": "nav > span", "as": "text", "text": "jane@acme.test" },
    { "selector": ".card-number" }
  ]
  ```
  `as: "text"` swaps the words, which reads as a product where a blur reads
  as a redaction; the default blurs. It is applied before the first frame
  and re-applied after every navigation and re-render, so the real value is
  never in the recording. Use `text` for IDENTIFIERS only (an email, a
  name, an account id). NEVER substitute product copy or a number: the
  video stays true to the product, and that judgment is yours, no check
  makes it for you. Rehearse again: the list should be empty, and a mask
  that reached nothing fails the rehearsal by name.
- A recording a HUMAN made (the last rung) has no mask: the scan needs the
  page. Look at the frames yourself and say what they show.
- The list is a floor, not a verdict. It reads text: a face, a logo, a
  customer's name in a table, a private chart are yours to notice. Offer
  the re-record from a demo account; do not decide for them.
- **What the account shows ships in the video.** Use a demo or seeded
  account, never a real customer's. Before you push, look at a frame for
  email addresses, names, keys and card numbers, and re-record from an
  account that does not show them.
