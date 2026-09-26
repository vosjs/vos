# Troubleshooting

## Exit codes

| Code | Meaning | Fix |
|---|---|---|
| 0 | ok | |
| 1 | error | read stderr; `--json` puts the message in the done event |
| 2 | usage error, or `--strict` failure | see below |
| 3 | no browser | `npx playwright install chromium`, or set `VOS_BROWSER_PATH` to a Chrome/Chromium binary |
| 4 | the recorder met a sign-in instead of the page (`@vosjs/cli` 0.41 and later) | it needs a SESSION, not a new script: walk `sessions.md`, then pass `--storage-state <file>`. Nothing was recorded and nothing was cleared. `--allow-wall` only when the sign-in page IS the take |

## The wall (exit 4)

`vos record`, `create` and `--dry-run` check where the first navigation
landed before a frame is captured. Refused always: a 401 or 403, a redirect
to an identity provider or a sign-in path, a sign-in form rendered in place.
Refused under `--strict` and in a rehearsal, warned otherwise: a redirect
somewhere else with no sign-in in sight, which is what a site that shows
strangers its marketing page looks like.

- Do not touch `actions.json`. The script is fine; the browser is a
  stranger. One `curl -sI <url>` before you script tells you the same thing
  sooner: a 30x away from the page you asked for is a wall.
- A re-record that worked last week and exits 4 today is an EXPIRED session.
  Mint it again; the old footage is still there, the refusal clears nothing.
- A digest that prints `WALL` is footage recorded past a wall
  (`--allow-wall`, or a redirect without `--strict`): it may be the wrong
  page. Re-record with a session before cutting it.

## `setup #N … the selector never appeared` (exit 2)

The off-camera sign-in did not finish, so the take did not start. A
selector in `setup` is checked the same way a step's is: rehearse with
`--dry-run`. `the environment variable NAME is not set` means the shell
that ran `vos record` did not export it; the value is never read from a
file. A setup that ran and then met the wall (exit 4) signed in with the
wrong credentials or into the wrong place.

## `EXPOSED in the frame`

Not an error: the take recorded. The recorder read the visible text after
each step and saw something shaped like an email address, a key or a card.
It reports the kind and the place, never the string. Fix it in the script
(`mask`, or a demo account) and re-record; a blur added afterwards in
`doc.json` still leaves the real value in `recording.webm`, which is what
`vos push` uploads. `MASK hid nothing: <selector>` (exit 2) means the
selector matched no element, so whatever it was for may be showing.

## Strict-mode failures (exit 2)

`vos record --strict` exits 2 when a selector was skipped or a navigation
never reached networkidle, with `skipped[]` in the `--json` done event.

- A skipped selector means the flow is broken: the element wasn't there, the
  selector is unstable (nth-child chains), or the page needed more settle
  time. Fix the actions.json — never ship a take that silently skipped steps.
- Networkidle timeouts on pages with long-polling/websockets: add explicit
  `wait` steps after navigation instead of relying on networkidle.
- Always pass `--strict`. The lenient default exits 0 over broken flows,
  which is how bad takes ship.

## Dead time

The record done event reports `dead` (`@vosjs/cli` 0.46 and later): a
still frame under a parked cursor past the beat it takes to read what
changed, per step, with how long the hold ran after the page settled.
`freezePct` beside it is the plain fact of stillness and is not a defect
on its own (a page being read is content). Budget: ≤20% dead, no single
dead hold >1.5s. The take-ready line names the steps.

1. Cut the named steps' `ms` to their beat: about 1 s after a page
   changed, 0.6 s after a control did.
2. Where the flow allows, keep something alive in frame, and hover things
   that respond with motion — those dwells become zooms too.
3. Trim dead heads/tails with `segments`; compress slow stretches with
   `speed` spans.

Never choose a flow to make `freezePct` smaller.

## Browser and environment

- **MP4 output needs system Chrome** (`--format mp4`); Playwright's bundled
  Chromium lacks the H.264 encoder. WebM works everywhere.
- **Headless WebGL**: if a render hangs at scene init on a CI box, the
  browser may lack GPU/SwiftShader flags. Prefer system Chrome; file an
  issue with the `--json` output if it persists.
- **Network**: the render page imports three/mediabunny from esm.sh —
  rendering needs outbound network. A fully offline sandbox can record
  nothing and render nothing; surface that limitation rather than shipping a
  broken artifact.
- Recordings served to a render page must come from a server that supports
  HTTP Range/206 (the CLI's own take server does) — video seeking hangs
  forever without it.

## Performance expectations

- Recording is always real-time (it drives a real browser).
- Render ≈ 1.5× real-time at 1080p with ~5s fixed startup; 2K is ~2× the
  per-frame cost; `--parallel N` pays off past ~30s of footage (ignored when
  audio is muxed).

## Take directory anatomy

| Path | What | Keep? |
|---|---|---|
| `recording.webm` | the re-render source footage | KEEP |
| `doc.json` | every editable decision | KEEP — this is the document |
| `actions.json` | the recipe that recorded it | keep for re-records |
| `frames/` | encode intermediate (~1GB at 2K) | deletable |
| `meta.json` | capture geometry | keep |

## Determinism

Renders are deterministic: same take + same doc.json = same frames, on any
machine. If two renders differ, the doc changed (diff it) — not the weather.
