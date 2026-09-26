# The remix contract (HTTP)

Mirror of https://vos.so/llms-remix.txt — the canonical, always-current
copy. Everything the CLI's `fetch`/`check`/`push` do rides these endpoints;
use them directly when the CLI is unavailable.

## Auth

Two credential shapes; NEVER print either.

1. **Remix grant** (`vos_rg_…`) — ephemeral, zero-setup. The watch page's
   "remix with your agent" prompt embeds one. Grants expire in 24h and are
   bound to ONE source vos: they can only POST remixes of it (`remixOfId`
   required, max 5 pushes), iterate the voses they created, and read those.
2. **Durable content key** (`vos_sk_…`) — minted at https://vos.so/app/api.
   Resolution order before asking the user: `VOS_API_KEY` env, then
   `~/.config/vos/credentials` (first line). If the user pastes a key into
   chat, use it — and suggest rotating it afterward.

```
Authorization: Bearer <token>
```

Both shapes can create/read/iterate voses. They can NEVER publish
(`visibility: "public"` is clamped or rejected — publishing stays a human
act on vos.so) and never touch the render API. Durable-key creates are
quota'd (50/24h).

## Endpoints

| Call | What |
| --- | --- |
| `GET /api/vos/{id}` | metadata: title, slug, params, `contentUrls`, `forkedFrom`, `currentVersionId` |
| `GET /api/vos/{id}/config` | `{ "config": VosConfigJson }` — the raw stored config, params included |
| `POST /api/vos` | create: `{ title, slug, visibility: "private", config, remixOfId? }` → `201 { vos: { id, … } }`; preview render auto-queues |
| `POST /api/vos/{id}/versions` | iterate: `{ config, baseVersionId?, label?, note?, overrides? }` → `201 { version: { id, versionNumber } }`; stale base or protected nodes → 409 (see Errors) |
| `GET /api/vos/{id}/changes?since={versionId}` | owner-only: the typed changelog after your base — attributed versions (origin/label/note), semantic `summary` + ops per version, and the `protected` human-edited node set |
| `PATCH /api/vos/{id}` | `{ title \| config \| tags \| visibility: "private"\|"unlisted" }` |
| `POST /api/claim` | **no auth** — the claimable push: `{ title, slug?, config }` → `201 { claimUrl, expiresAt, vos: { id } }`. Programs only, config ≤200KB, 5/24h per network. The claimUrl goes to the user and nowhere else; unclaimed work is deleted after 72h |

Base URL `https://vos.so`. `slug` is `[a-z0-9-]`, unique per user, ≤50
chars. `remixOfId` stamps the "remixed from" credit — always set it when
the work started from someone's program.

## Config rules (enforced server-side)

- Function fields are JS **strings**: no TypeScript syntax; escape
  backticks/`${}` that must survive into output.
- `createContent` returns `{ objects, refs, dispose }`; `createTimeline`
  reaches custom handles via `content.refs.<x>`.
- Server-render constraints: no `THREE.DoubleSide` on transmission
  materials, no `dispersion`, assets by absolute `https` URL only.
- The platform compiles on every push — a push that 400s with a compile
  error was going to render nothing; fix and re-push. `vos check` runs the
  same compiler locally first.

## Params and presets (preserved by contract)

`config.params` (max 12 declared; curate 2–4) and `config.presets` (max 8,
names ≤24 chars) survive every create/version/PATCH — the platform
re-attaches them even though its schema strips unknown fields. Format and
craft rules: `params-knobs.md`.

## Hand-back

Give the user both URLs every time:

- watch: `https://vos.so/vos/{id}` — preview, knobs, the program
- studio: `https://vos.so/studio?vos={id}` — live fine-tuning of your knobs

## Errors

| Status | Meaning | Do |
| --- | --- | --- |
| 400 | Invalid input / Failed to compile config | fix locally (`vos check`), re-push |
| 401 | Invalid or revoked key | re-resolve credentials; ask the user |
| 403 | missing `content` scope · cannot publish · grant off its source vos | respect the boundary; don't retry |
| 409 | slug exists (on create) | pick another slug (the CLI retries derived slugs automatically) |
| 409 | `stale_base` (on versions) | the platform copy moved since your base — the body EMBEDS the typed changes you missed; `vos pull`, re-apply, push with the fresh base |
| 409 | `protected_conflict` (on versions) | your push touches nodes a studio version edited since your last push — keep the human's values, or include the listed ids in `overrides` ONLY when the user asked for that change |
| 429 | 50/24h create quota, or grant's 5-push cap | iterate versions instead of creating; or wait |
