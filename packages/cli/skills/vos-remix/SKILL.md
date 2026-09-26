---
name: vos-remix
description: Remix a vos.so gallery program into your own — fetch its config, edit the declared knobs or code locally, validate with vos check, and push a private copy back with lineage that iterates as versions. Carries the params/Looks doctrine and the GLB 3D-showcase recipe. Use when asked to remix, customize or personalize a gallery animation, swap a 3D model into a showcase, or iterate a fetched program as versions.
license: MIT
---

# Remix a vos program

Every video on [vos.so/gallery](https://vos.so/gallery) is a program:
inputs + a deterministic function → video. Remixing is editing that
program's JSON config and pushing the result back as a **private** vos on
the user's account, with lineage. You edit locally; the platform validates,
compiles, and renders a preview.

## Setup

```bash
npm i -D @vosjs/cli   # the fetch/check/push/pull loop
```

No browser needed for this loop (rendering previews happens on the
platform). Everything also works as plain HTTP if the CLI is unavailable:
`references/remix-contract.md` documents every endpoint.

## Credentials (never print them)

Two shapes, both used as `Authorization: Bearer`:

1. **Remix grant** (`vos_rg_…`) — if the user's prompt contains one, use it.
   24h lifetime, bound to ONE source vos, max 5 pushes.
2. **Durable key** (`vos_sk_…`) — resolution order before asking:
   `VOS_API_KEY` env, then the first line of `~/.config/vos/credentials`.
   Humans mint keys at https://vos.so/app/api.
3. **No credential at all** — the claimable push (programs only):
   ```bash
   vos push my-remix.json --claimable --title "My remix"
   # → claim: https://vos.so/claim/…   expires: <72h from now>

   # No CLI, or an older one? The same thing over plain HTTP:
   curl -s -X POST https://vos.so/api/claim \
     -H 'content-type: application/json' \
     -d '{"title": "My remix", "config": <the VosConfigJson>}'
   # → { "claimUrl": "https://vos.so/claim/…", "expiresAt": "…" }
   ```
   Hand `claimUrl` to the user and nowhere else — it is the only reference
   and the only credential. The link lasts 72 hours; unclaimed work is
   deleted after that (deliberate cleanup, not data loss — re-push if it
   lapses). Claiming moves the vos into the user's library and starts its
   hosted preview; iteration after claim rides their key (the loop below).
   Limits: config ≤200KB, 5 pushes per day per network.

The CLI resolves grants and keys automatically (`export VOS_API_KEY=…`). No
shape can publish: pushed voses stay private until a human publishes on
vos.so.

## The loop

1. **Fetch** the source program (public programs need no auth):
   ```bash
   vos fetch https://vos.so/vos/<id>        # or the bare id
   # → <slug>/config.json (params preserved) + <slug>/vos.json (tracking)
   ```

2. **Edit** `config.json` locally. The function fields (`setup`,
   `createContent`, `createTimeline`, `onFrame`) are JavaScript **as
   strings** — no TypeScript syntax, no `${}` template interpolation.
   Change 1–2 axes decisively (palette, motion grammar, density) — never a
   10%-nudge duplicate. If the program declares `params`, prefer retuning
   or extending those knobs over surgery on function strings.

3. **Declare knobs and Looks** — the remix's control surface. 2–4
   intent-named params plus 2–3 presets. This is a craft with rules:
   `references/params-knobs.md`.

4. **Check** locally before pushing:
   ```bash
   vos check <slug>/config.json     # migrate → schema → syntax → compile → lints
   vos still <slug>/config.json probe.webp --time 2   # RUN it — check compiles
                                    # but never executes the module; a runtime
                                    # throw (a TDZ against the function's own
                                    # declarations) ships invisibly on check
                                    # alone. Render a still after every code
                                    # edit, before every push.
   ```
   Fix every error; treat determinism warnings seriously (a config that
   renders differently per run is broken by definition).

5. **Push** as a private vos with lineage (the CLI reads `vos.json` beside
   the config for the `remixOfId` credit):
   ```bash
   vos push <slug>/config.json --title "Aurora Ribbons — dusk"
   # → Created private vos <id>
   #   watch:  https://vos.so/vos/<id>
   #   studio: https://vos.so/studio?vos=<id>
   ```

6. **Iterate** — further edits become versions of the same vos:
   ```bash
   vos push <slug>/config.json --vos <id> --note "cooler palette, slower drift"
   ```
   The directory TRACKS its vos through `vos.json`, so the base version is
   carried automatically: if the human edited in the studio since your last
   push, the push is rejected WITH their typed changelog. `--note` is your
   handoff line — it is what the human reads first; `--label` names the
   version.

7. **Pull before every editing round** — the human may have fine-tuned:
   ```bash
   vos pull <slug>          # what changed since your base, then sync
   ```
   Prints each version attributed (`v3 (studio · warmer): knob hue 0.2→0.35`
   plus their notes), syncs `config.json` to the head (your previous copy is
   kept as `config.backup.json`), and repoints the base. **Human-edited
   nodes are protected**: a push that touches them is rejected unless you
   pass `--override <id>` — do that ONLY when the user's instruction
   explicitly targets that node. Their turns of your knobs are preference
   data: read the changelog before deciding what to do next.

8. **Hand back BOTH links** — the watch page (preview, knobs, code) and the
   studio (`https://vos.so/studio?vos=<id>`) where the user fine-tunes your
   knobs live. Publishing is their act, on vos.so.

## Rules that keep pushes honest

- **Private is the contract.** Never try `visibility: "public"` — it clamps
  to private, and publishing by key is rejected by design.
- **Quota-aware**: durable keys create ≤50 voses/24h; grants push ≤5. Iterate
  versions on one vos instead of creating many voses.
- **Server-render constraints** (the preview fleet is software-GL): no
  `THREE.DoubleSide` on transmission materials, no `dispersion`, and every
  fetched asset must be an absolute `https` URL the fleet can reach.
- **Every knob must act.** A param the code never reads is worse than no
  param — see the honesty section of `references/params-knobs.md`.
- 3D model swaps (GLB into a showcase program): `references/3d-recipe.md`.
- Full endpoint reference, quotas, and error table:
  `references/remix-contract.md`.
