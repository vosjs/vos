# Params and Looks — the control surface you ship

A remix delivers output *plus the controls you considered while making it*.
The human's next instruction can be a knob turn, a prompt in knob
vocabulary, or both: human instructs → agent creates (program + knobs +
Looks) → human feels the space and settles or redirects → settled values
bake in, the surface renegotiates, repeat. **You ship an interface, not
just an artifact.**

## Format

```json
"params": [{ "key": "hue", "label": "Hue", "kind": "number",
             "min": 0, "max": 1, "default": 0.6,
             "hint": "Shifts every color around the wheel",
             "unit": "°", "group": "Color", "order": 1 }]
```

- kinds: `number` (min/max/step) | `color` | `select` (options) | `toggle`
- `hint`: ONE sentence on what visibly changes — always write it
- `unit` shows inside the number field (`px` `%` `s` `×` `°`);
  `group`/`order` cluster related knobs into their own panel card
- The program reads each key from `ctx.data` where it animates:
  ```js
  const d = ctx.data || {}
  if (typeof d.hue === 'number') u.uHue.value = d.hue
  ```

Looks are named points in param space — free variants (one program, three
directions, zero extra render cost):

```json
"presets": [{ "name": "Vivid", "values": { "hue": 0.9, "speed": 2 } },
            { "name": "Calm",  "values": { "hue": 0.3, "speed": 0.6 } }]
```

Values must reference declared param keys with matching types (anything
else is dropped on save; max 8 Looks, names ≤24 chars). Ship 2–3 Looks
whenever the program has 4+ params.

## The five rules

1. **The knob budget is a negotiation, not an accumulation.** Curate 2–4
   knobs (the schema caps at 12). A knob earns its slot by being touched or
   asked about. **Collapse**: when the human settles a value and stops
   touching it, bake it into the code as the new default and free the slot —
   the surface is a cache of live decisions, not an archive. **Promotion**:
   recurring prompt themes become knobs ("you keep circling pacing — I
   added `pace`").
2. **Knob honesty is renderable.** Every knob must visibly change the
   output. Verify: render frames at several points of the knob's range and
   compare — min, MIDPOINT, max for numbers. The midpoint matters:
   circular quantities (hue is the classic) look identical at the two range
   ends (±half a turn is the same rotation), so a min-vs-max check calls a
   working knob dead. If the best pair is near-identical, the knob is dead;
   wire it or drop it. Fake agency poisons the whole paradigm.
3. **Respect human-set values.** A value the human adjusted is theirs — when
   you regenerate code, preserve what each knob does. Renaming or retiring
   a knob is something you SAY in the iteration note ("replaced `speed`
   with `tempo`"), never something that happens silently. This rule is
   ENFORCED: the platform rejects a push that touches nodes a studio
   version edited since your last push, until you pass `--overrides` — the
   consent switch for "the user asked me to change exactly this".
4. **Name knobs by intent, not implementation** — `mood`, `drama`, `pace`;
   never `blurRadius`. The knob is language between two authors; its name
   becomes the vocabulary of the next prompt.
5. **State the boundary.** Knobs cover the aesthetic space (continuous or
   enumerable dimensions). Structural change — a new scene, a new object, a
   different narrative — stays prompt territory. Knobs are for feeling;
   prompts are for asking.

## Craft notes

- A `select` of curated combinations often beats three independent numbers
  (e.g. `mood: dusk | noon | neon` driving palette + light together).
- Defaults must reproduce the pushed output exactly: knobs at defaults =
  the video you shipped.
- On GLB/model swaps, template material knobs usually stop acting (the
  model brings its own materials) — see `3d-recipe.md`; declare only knobs
  you have verified act.
