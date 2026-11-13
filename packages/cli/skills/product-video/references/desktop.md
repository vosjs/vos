# A desktop app, not a page

Read this when the product is an app on the Mac (a native app, an Electron
app, a terminal) and not a URL. The take, the cut, the render and the push
are the same; the recorder is `vos record --app`, and four things about it
are not like a page.

Needs `@vosjs/cli` 0.90 or later, macOS 14 or later, and two grants a
PERSON gives to the app the CLI runs from (the terminal, the editor, the
agent host): Screen Recording, and Accessibility for a scripted take.
`vos doctor` has a `desktop` line with both. You do not approve a system
prompt; you ask.

## What is different

1. **The script presses the real app.** There is no browser to throw away
   and no `--dry-run`. A key that lands in the wrong place renames a file.
2. **The real pointer and keyboard are used.** The app comes to the front
   and nobody else can use the machine while a take runs. Say so to the
   person BEFORE the first take, and keep takes short. In a run with
   nobody to tell first, say it in your report: what was launched, that the
   pointer and keyboard were taken, and for how long.
3. **Selectors are a role and a name**, read from the app's accessibility
   tree, not CSS: `button[name='Save']`, `textfield[id='title']`.
4. **The app is somebody's.** Their own window has their files in it.

## The rule that comes first: film a throwaway instance

Never run `vos record --app <name>` against an app the person has open
with real work. `--app` picks the largest window of that name, and with
two instances that can be theirs.

Start a second instance that owns nothing: its own profile, no account, a
scratch project you wrote. Find its process, and aim every verb at it with
`--pid`:

```bash
vos record --windows            # id, app, size and pid of every window
vos look --pid 36026            # look at that process's window
vos record --pid 36026 --actions actions.json --out take --strict
```

For an Electron app (VS Code, Slack, Linear, most new desktop apps):

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --user-data-dir "$STAGE/profile" --extensions-dir "$STAGE/ext" \
  --force-renderer-accessibility --new-window "$STAGE/project"
```

- `--user-data-dir` is what makes it a separate process with nothing of
  the person's in it.
- **`--force-renderer-accessibility` is not optional.** An Electron or
  Chromium app builds its accessibility tree only when asked, and a running
  one can take minutes. Without the flag `vos look` lists a window frame
  and says so; with it the controls are there from the first frame.
- Write the profile's `settings.json` before launch and switch off what
  moves by itself: onboarding, suggestions and hovers, auto-closing
  brackets and auto-indent (typed code must land as typed), git
  decorations, update checks. Give a terminal a prompt of its own (a
  `ZDOTDIR` with a two-line `.zshrc`): the person's prompt is their name,
  their host and their path.
- **Rewrite the stage before every attempt** (delete the profile and the
  project, write them again, launch). The reset is a script, never an undo.

A native app with no profile flag (Calculator, a document app) is safe to
film directly only when it holds nothing: check it is not already running
(`pgrep -x <Name>`), and leave it alone when it is.

## An app that is an account

Some products have no throwaway instance: the app IS a signed-in account
(a chat app, a team's workspace, a design tool), and a second profile is a
sign-in page. Then the person's own app is the stage, only when they asked
for it to be, and four things change.

1. **Say what will show before the first take.** Their name and plan, the
   titles of their other work, their recent items. A demo account or a
   second workspace is the answer; what is left is covered with `mask`
   (`@vosjs/cli` 0.93 and later):
   ```json
   "mask": [
     { "selector": "popup[name*='Account']" },
     { "selector": "link[name*='redesign']" }
   ]
   ```
   Every match of each selector is covered BEFORE a frame is encoded, with
   one flat colour, so it is in no file; the take says how many elements
   each mask covered, and a mask that matched nothing is a note to read.
   Have what must never show on screen before the take begins: an element
   that appears mid-take is covered from the next reading of the app, a
   frame or two late. `vos look` is not masked. It is your eyes, and its
   picture and outline hold the person's content: keep only the roles and
   names you need, and never paste the listing.
2. **Nothing here is thrown away, so the script undoes itself.** Every
   `vos look --actions --until` walk and every take presses the real app:
   the prompt a walk typed is still in the field. Write the undo ONCE, as
   the script's `teardown` (0.93 and later), and what the take needs
   first as its `setup`. Both are the page's verbs (`wait`, `click`,
   `type`, `press`, `if`), run off camera through the same driver, after
   a take that stopped early and after a look's walk too:
   ```json
   "teardown": [
     { "do": "if", "selector": "button[name='Send']" },
     { "do": "click", "selector": "textarea[name='Prompt']" },
     { "do": "press", "key": "Mod+A" },
     { "do": "press", "key": "Backspace" }
   ]
   ```
   Open it with an `if` on what only a leftover has, so a clean app says
   `teardown: nothing to undo`. A list has ONE `if`, and everything after
   it is skipped when it is not there: write the teardown for the state a
   walk stops in, and let the next take's `setup` put right what a
   finished take leaves (a pane left open, a view left full). A teardown undoes what a WALK leaves; it
   never deletes what the film is about, and it never presses a control
   that sends, buys or deletes.
3. **Choose the door that touches least, and write the ledger.** An app
   that works in a folder of the person's disk is offered the choice that
   names none. What the take creates in the account (a session, a file, a
   message) is said before the take and listed in the report, so they can
   delete it. A step that spends (a generation, a send) carries
   `"guard": "spend"`, and the command names it with `--confirm <id>`:
   once, in the take, never in a walk.
4. **A result that arrives later is two takes, or one long one.** A
   desktop take cannot stop its camera and wait. Two takes: take A ends a
   few seconds into the wait, on the product working. Wait off camera
   with `vos look --pid <n> --json`, which acts on nothing, until what
   only a running job has is gone (a Stop button). Look at the result,
   script take B from that state, and make them one film:
   `vos join take-a take-b --out film`. Say the wait in a caption with
   the time you measured. One take (0.94 and later), when the working is
   worth showing and the machine can be left alone for the whole wait:
   an `expect` with `gone` and a `timeout` above the wait, cut down with
   `segments` and a `speed` span. `references/multi-app.md`, "A long
   task".

**Quit what you launched, and only that**: end the process you started
(`pkill -x <Name>` for an app that was not running before, `kill <pid>` for
a stage). Not AppleScript, which needs a grant of its own and asks the
person for it. Say in the report that it is closed, or that it is not.

## Look, then script

```bash
vos look --pid <n> --out look        # look.png + every control, one selector each
```

Each control comes with ONE selector, marked UNIQUE or AMBIGUOUS. Take a
UNIQUE one as it is. An identifier (`[id='…']`) survives a redesign; a name
that carries a shortcut or a state (`radio[name='Explorer (⇧⌘E)']`,
`group[name='notes.js, preview']`) breaks when either changes, so prefer a
plainer one when the listing offers it. Read `look.png` once to see the
stage; do not print the whole outline of a working window, which holds the
text of the open file: take `--json` and keep only the roles you need.

The screen a click opens has selectors you cannot see yet:

```bash
vos look --pid <n> --actions actions.json --until <step id>
```

runs the script up to that step FOR REAL, then looks, and keeps no take.
Rewrite the stage afterwards: the app is no longer at the start.

`vos validate actions.json` refuses a selector that is not one before
anything runs (0.93 and later): the two tests are `=` and `*=`, so
`[name^='Save']` is refused when the script is read, not at its step
after the steps before it have pressed the app.

The script is the same `actions.json`, with `"app"` where a page has
`"url"`. Always write `"app"`: it is what tells `vos validate` and the
recorder that this is a desktop script (without it a `type` with no field
is refused as a page's). `--pid` on the command line still decides WHICH
window:

```json
{
  "app": "Code",
  "viewport": { "width": 1280, "height": 800 },
  "steps": [
    { "do": "click", "selector": "row[name='src']", "id": "src" },
    { "do": "click", "selector": "row[name='launch.js']", "id": "open", "caption": "Open the launch script" },
    { "do": "expect", "selector": "group[name*='launch.js']", "id": "opened" },
    { "do": "click", "x": 800, "y": 300, "id": "editor" },
    { "do": "type", "focus": false, "text": "await preflight([\n  'Fuel pressure',\n])", "id": "write", "caption": "Write the checks", "zoom": true, "delayMs": 45 },
    { "do": "press", "keys": "Control+`", "id": "terminal", "ms": 900 },
    { "do": "type", "selector": "textfield[name*='Terminal 1']", "focus": false, "text": "node src/launch.js", "id": "run", "caption": "Run it", "zoom": true },
    { "do": "press", "keys": "Enter" },
    { "do": "wait", "ms": 3400 }
  ]
}
```

- **Steps**: `wait`, `hover`, `click`, `type`, `press`, `scroll`, `move`,
  `drag`, `expect`, with `id`, `caption`, `zoom`, `payoff`, `read`,
  `guard` and `ms` as on a page. `viewport` is the size the window is
  given first, in points; `x`/`y` are the window's points.
- **Refused, in words, before anything runs**: `url`, `ready`, `peers`,
  a `mask` with `as: "text"`, a `goto` in `setup` or `teardown`, and the
  steps `paste`, `download`, `await`, an `expect` on `js`, a drag `path`.
  (Before 0.93, `mask`, `setup` and `teardown` are refused too.) Where a page would `await`, give an
  `expect` a `timeout`, which is in SECONDS (`"timeout": 10`), not ms.
- **`type` with `"focus": false` and no selector** types where the keyboard
  already is: an editor the app draws itself offers no field to name. A new
  line in `text` is the Return key, so several lines are ONE step. Typing
  code a character at a time needs the app's own completions off (see the
  stage).
- **`Mod` is Command.** A menu-bar menu is not in the window: reach it with
  its key chord.
- **A wide field that is typed into** (a terminal's text, an address
  bar) has its words at the left. Frame the words; from 0.94 `vos
  validate` holds such a zoom to the typed line and not to the field's
  centre.

## What stops a take, and why you want it to

- **The first step that misses ends the take** (exit 1, the step and the
  reason): an element that never appeared, an `expect` that never held, a
  disabled control. The steps after it were written for a state the app is
  not in. `"onSkip": "continue"` goes on; do not reach for it.
- **A `type` whose keys would land on a row, a button or a list is refused
  before the first key**: there, a key is a command.
- **Another app taking the keyboard stops the typing.**

So put an `expect` between a beat that OPENS something and a beat that
TYPES into it, always pass `--strict`, and read the last line: `FAILED`
names the step. Fix the script, rewrite the stage, record again. A take
that stopped is not cut.

## Cutting a desktop take

The digest says `surface: "app"`. Cut it as any take (the `vos-cut`
skill's loop), with what a desktop take gets wrong by itself:

- **Typing zooms.** The planner proposes one zoom per typing run, aimed at
  a caret that an editor may report stale. Replace them with ONE held zoom
  per beat, framed on the text (the code block, the terminal's lines), and
  put every proposal you drop in `rejected`.
- **Speed.** Typing at 3× reads as a glitch: 2× over the typing, 1× over
  the command that runs and all of its output. Output that prints is
  playback.
- **The ending.** Hold on the proof (the whole window, the code and its
  passing run), then leave: an end card's title belongs after the window
  has stepped back, not over it. Judge it as a still half a second after
  the title lands. Over a dark window the house end card reads; over a
  light or wordy last frame (a page, a document) its title lands on the
  page's own words. Then the words wait for the window: shorten the
  closing freeze to under a second and start the end card's clips where
  it ends. That is data in `doc.json`, not a second take.
- **The payoff.** Mark the step that IS the reveal `"payoff": true`
  (0.93 and later). Without it `vos music pick` lands the swell on the
  last step marked `zoom: true`, which is the wrong moment when the
  reveal plays wide and a smaller beat is zoomed on. Place the bed with
  the line `vos music pick` prints (`vos score … --at <seconds>`) or
  with `--track best`: a track named without `--at` starts at its top,
  not on the payoff.
- **The end card is laid by the verb**, never typed by hand:
  `vos plan <take> --motion --headline "…"` on the cut film. It keeps
  every manual span, the later takes' too (0.93 and later), and may
  propose a speed span you did not ask for: read what it reports and
  put what you drop in `rejected`.
- **A joined film has a digest per take.** `vos digest film` writes the
  first take's moments to `digest/digest.json` and each later take's to
  `digest/m1/digest.json`, with its own sheet (0.93 and later). Read
  them all: source seconds are that take's own footage, and a span on a
  later take carries `"media": "m1"`.
- A window has its own title bar and corners; the take wears no browser
  bar, and the card is rounded to the window.
- **Pace is the cut's, not a second take's.** A film that runs short or
  long is a speed span or a longer hold in `doc.json`. Recording again
  takes the person's pointer and keyboard again; do it for a script that
  was wrong, never for timing.

Push it as any take, named: `vos push take --title "…" --label "…" --note
"…"` (the first push of a take uploads its recording and asks for `--yes`).
A bare push lands on the shelf as "Take take <date>".

## Avoid

- `vos record --app <name>` on an app the person has open. Launch a
  throwaway instance and use `--pid`.
- Following a click that might miss with keys, with no `expect` between.
- Concluding from one `vos look` that an Electron app cannot be scripted.
  Launch it with `--force-renderer-accessibility`.
- A person's own terminal prompt, files or account in the picture, with
  nothing said and nothing masked.
- A hand-written undo script after every walk: it is the script's
  `teardown`.
- Clips of a long task taken on a clock: two takes joined, or one take
  that waits inside itself (0.94 and later).
- Scripting what answers back (a game, a live chart) with guessed
  coordinates: that is a play, `references/multi-app.md`.
- Pasting the full outline of a real window into your context.
- Recording while the person is using the machine, without saying so.
