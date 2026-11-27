# One film across several apps

Read this when the story leaves one window: a prompt in a chat app, a
command in a terminal, the result in a browser. Read `desktop.md` first;
everything in it holds for each app here.

**Two shapes, chosen by one question: do the apps share a moment?**

- **They do not** (ask in one app, then run in another, then look in a
  third): each app is its own take of its own window, and the film is
  `vos join` of them. Most of this page is that film. Needs `@vosjs/cli`
  0.93 or later; what needs a later one says so.
- **They do** (a command in one window changes what another shows, a
  thing is dragged from one app into another, the viewer must see both
  at once): that moment is ONE take of both apps, a **stage**. "A stage:
  apps that share a moment", below. Needs `@vosjs/cli` 0.97 or later to
  perform one and 0.98 or later to script one.

A film may hold both: a stage for the hand-off, single takes for what
comes before and after, joined. What is steered by a program (`--play`)
is always a take of its own: a stage takes no program.

## Before the first take

Say these to the person, once, before anything is launched:

- **The takes, in order**, and which app each one is.
- **What each app will show that is theirs** (a name, a plan, recent work)
  and what you will mask. A picker that lists their recent work is chosen
  OFF camera (in `setup`), or masked row by row; off camera is simpler.
- **What will be launched and closed**: a terminal window, a throwaway
  browser, a dev server. And what will be left: a session in their
  account, a project on disk.
- **How long the pointer and keyboard are taken**, in total.
- **The look.** Apps follow the system's light or dark appearance, and a
  stage cannot pin it without changing the person's settings. Read it
  before EVERY take (`defaults read -g AppleInterfaceStyle`, which fails
  when it is light) and stop if it is not what the first take had: a
  long take plus a locked screen is enough for the evening to arrive.
  Say so if the film crosses the change. A take records which it was
  made under, and `vos validate` and `vos join` say when a film's inputs
  differ (`@vosjs/cli` 0.95 over `@vosjs/driver` 0.4.1).
- **The screen will lock.** A take that waits sends no input, so the
  system counts it as idle, sleeps the display and locks. The capture
  goes on, but the NEXT take cannot bring its app forward ("The app
  could not be brought to the front"), and only the person can unlock.
  From `@vosjs/driver` 0.4.1 the helper holds the display awake for the
  length of a take, and a script behind a locked screen is refused in
  those words. BETWEEN takes nothing holds it: keep the display awake
  for as long as the film's takes run (`caffeinate -d -t <seconds> &`,
  ended when they are done), and tell the person a film with a long wait
  needs the machine left awake.

## A stage per app

Each app is made fit to film before its take, and put back after. Keep
the stage in one script with an up and a down per app, and keep the
process ids it started.

### The app that is an account

`desktop.md`, "An app that is an account". Its window is resized by the
take (`viewport`), and a `setup` may change it (a sidebar hidden): put
it back RIGHT AFTER its take, not at the end of the film. An app that
was restarted in between is a new process, and the script that changed
it no longer reaches it.

Hiding the app's sidebar in `setup` keeps a whole list of the person's
work out of the picture with no mask at all.

### A terminal

Start a terminal that was not running, in the project's folder, with a
shell of its own: no name, no host, no history of the person's.

```bash
# stage/zdot/.zshrc
unsetopt PROMPT_SP
HISTFILE=/dev/null
PROMPT='%1~ ❯ '
printf '\e[3J'; clear
```

```bash
# stage/terminal.command (chmod +x), opened with: open -a Terminal stage/terminal.command
cd /path/to/project
export ZDOTDIR=/path/to/stage/zdot
exec zsh -i
```

- **Mask the title bar, by what it is.** A terminal's title names the
  running process, and once a tool rewrites its process title (`npm`
  does) the title can show the environment of the shell that launched
  it. The title's words CHANGE while a command runs, so a mask that
  names them (`text[name*='zsh']`) covers the title before and after the
  command and shows it during, and `--strict` still passes, because the
  mask matched when the take began. Name the role alone:
  `"mask": [{ "selector": "text" }, { "selector": "image" }]` (the title
  and the folder's icon beside it; read the roles from `vos look`, and
  check the mask covers nothing else of that role).
- **Give the window its size and place from inside**, when the take will
  not (a stage records its windows as they are):
  `printf '\e[8;24;70t\e[3;120;200t'` in the launch script makes it 24
  rows by 70 columns at 120, 200 on the screen.
- **A resize reflows the screen.** The take gives the window its
  `viewport`, and the prompt lands a third of the way down. Clear the
  screen in `setup`:
  ```json
  "setup": [
    { "do": "type", "selector": "textarea[name='shell']", "text": "clear" },
    { "do": "press", "key": "Enter" },
    { "do": "wait", "ms": 700 }
  ]
  ```
- **Only start the app if it was not running.** If it was, it is the
  person's: ask, or use another terminal.
- **The app reopens its last windows.** A terminal that was quit with a
  window open brings that window back on the next launch, with the
  person's own shell and a title that names them, and `--pid` picks the
  largest window, which may be that one. List the windows
  (`vos record --windows`) and name the stage's by `--window <id>`.
- **Close the stage window from inside before quitting the app**, so
  nothing is left to reopen: `Control+C`, `exit` and Return, then
  `Meta+W`, as a `vos look --actions … --until` walk. Then end the app
  (`pkill -x Terminal` only when the whole app is the stage's).

### A browser

A throwaway instance with its own profile, never the person's browser:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$STAGE/chrome-profile" --force-renderer-accessibility \
  --no-first-run --no-default-browser-check --disable-sync \
  --window-size=1440,900 about:blank &
echo $! > "$STAGE/chrome.pid"
```

- **A fresh profile suggests searches as you type**, and the suggestions
  are in the picture. Before the FIRST launch, write
  `{"search":{"suggest_enabled":false}}` to
  `$STAGE/chrome-profile/Default/Preferences`.
- **The address bar holds the page's address**, so typing lands inside
  it. Click the field, `press` `Mod+A`, then `type`.
- Aim every command at the process: `--pid "$(cat $STAGE/chrome.pid)"`.
  End it by that pid and check nothing with that profile is left
  (`pgrep -f "user-data-dir=$STAGE/chrome-profile"`).

### A server

A dev server the film needs is started ON camera, in the terminal take,
so the port must be free first. If an agent's session already started one,
stop that one by its process id, after checking it is the stage's:

```bash
for pid in $(lsof -ti :5173 -sTCP:LISTEN); do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn | grep '^n' | cut -c2-)
  case "$cwd" in "$PROJECT"*) kill "$pid" ;; *) echo "port 5173 is not the stage's: $cwd" ;; esac
done
```

Never kill by pattern.

### A panel that is another window

An app's Open panel is its own window: no selector of the take reaches
it. Drive it with keys (`Meta+Shift+G`, the path, `Enter`, `Enter`), and
expect what follows (a workspace trust dialog). When opening the folder
is not the story, do it in `setup`.

## A stage: apps that share a moment

When two apps share a moment, record them in one take. The CLI calls that
take a **stage** (above, a stage is the set-up an app is given before it
is filmed; from here it is the take): one display with only the named
apps' windows in its pixels, each where it is. Set each app up as above
first.

```bash
vos record --windows                       # every window, with its app and pid
vos record --actions ship.json --pid "$(cat $STAGE/chrome.pid)" \
  --out take-ship --strict            # the script names the apps; --pid narrows the browser to the throwaway
```

```json
{
  "apps": ["Terminal", "Google Chrome"],
  "setup": [
    { "do": "type", "app": "Terminal", "selector": "textarea[name='shell']", "text": "clear" },
    { "do": "press", "key": "Enter", "ms": 300 },
    { "do": "click", "app": "Google Chrome", "selector": "button[name='Reload']", "ms": 900 }
  ],
  "mask": [
    { "app": "Terminal", "selector": "text" },
    { "app": "Terminal", "selector": "image" }
  ],
  "steps": [
    { "do": "type", "app": "Terminal", "selector": "textarea[name='shell']", "text": "./deploy.sh", "id": "command", "caption": "Ship it" },
    { "do": "press", "key": "Enter", "id": "run", "ms": 3400 },
    { "do": "click", "app": "Google Chrome", "selector": "button[name='View release']", "id": "release", "caption": "And it is live", "payoff": true }
  ]
}
```

- **Nothing that was not named is recorded.** No other app, no
  wallpaper, no Dock, no menu bar, and there is no flag that records the
  screen as it is. Another app's window that crosses the stage mid-take
  is kept out of every frame, and the take says so in a note.
  `--desk menubar,dock,wallpaper` keeps a part of the desk when the desk
  is the subject (a menu-bar app).
- **A name is every running instance of that app.** Naming a browser the
  person has open puts their windows on the stage. Name the throwaway by
  `--pid <n>`, once for each process (0.98 and later): an app the script
  also names is then that process alone. Name by name only an app that
  was not running before you started it, and check with
  `vos record --windows` that it has the stage's window and no other: a
  terminal that reopened an old window has two, and both are on the
  stage.
- **The windows are recorded where and as they are.** A stage takes no
  `viewport` and no `--window`. Give each app its size and place when it
  is launched (a browser's `--window-size` and `--window-position`, the
  terminal's own escape), side by side, with air between them and
  nothing over what will be pressed. The frame is the whole display under
  its menu bar: size the windows so that together they fill most of it,
  or the film opens on small windows in an empty picture.
- **The script names its apps** (`"apps"`, where one app's script names
  `"app"`). A step says which app it acts on with its own `"app"`; a step
  that says none stays with the app of the step before it, and the first
  with the first app named. The app is brought forward when its step
  runs. A drag may end in another app:
  `"to": { "app": "Google Chrome", "selector": "…" }`. A `mask` and a
  `setup` or `teardown` step say their app the same way.
- **Look before scripting.** `vos look --app "A" --app "B"` takes one
  picture of the stage and lists each app's controls. A throwaway is
  looked at by its process, alone: `vos look --pid <n>`.
- **Reset every app off camera, in `setup`**: clear the shell, reload the
  page. The take then opens on the same state every time, and another
  attempt needs nothing done by hand.
- **`--float`** (0.98 and later) records the windows with nothing behind
  them. In the film they stand on the backdrop, each with its own corners
  and its own shadow, and no card is drawn around them. Without it they
  sit on a plain ground inside the card. Not given with `--desk`.
- **Performed, too.** With no `--actions` the take records while a person
  works (`vos record --app "A" --app "B" --out take`, ended with
  `--seconds <n>` or Control+C). The pointer's track is silent while the
  pointer is over a window that was not named.
- **Refused, in words**: `--play`, `--window`, a script's `viewport`.

**Cutting it.** The plan knows which window each press belongs to: a zoom
stays inside the window being worked in, and between beats the camera
rests on that window (the spans named `w0`, `w1`). So when the point of a
stretch is what the OTHER window does meanwhile (the page going live
while the terminal prints), the camera is on the wrong window. Drop the
rest over that stretch and put it in `rejected`: with no span there the
camera steps back to the whole stage. That is the cut (the `vos-cut`
skill's loop), never a second take.

## What answers back is played by a program

A script is a list. A game, a chart that moves, a drag that depends on
where something landed need a loop that looks, decides and acts. Do not
script it with guessed coordinates. Write a play (`@vosjs/cli` 0.94 and
later):

```bash
vos record --pid "$(cat $STAGE/chrome.pid)" --play play.mjs --out take-play
```

```js
// play.mjs
export const take = { viewport: { width: 1280, height: 800 } }

export default async function (play, { window }) {
  await play.step('start', () => play.click("button[name='Play']"), {
    caption: 'And it plays',
  })
  await play.step(
    'fly',
    async () => {
      const until = play.now() + 25
      while (play.now() < until) {
        const ring = await nextRing() // your read of the world
        await play.move(ring.x * window.w, ring.y * window.h, 12)
      }
    },
    { zoom: false, payoff: true },
  )
}
```

- **`play`** has `click`, `type`, `press`, `move`, `find`, `gone`, `sleep`,
  `now` and `send`. `click` and `type` keep a script's rules (waited for,
  never a disabled control, never typed where keys are commands), and
  whatever the program throws ends the take. A play has no rehearsal.
- **Prove the player before it has the pointer.** Run the game on a port
  of its own in a headless browser and steer it with pointer events over
  the debugging port: no window, no footage, nobody's pointer. It finds
  what the real take would have spent a minute of the machine to find
  (a board not recognised in the scene, a judgement that crosses walls).
  A headless browser renders slowly, so a player that lives there lives
  longer on the real one. Let the play ride again when a run ends early,
  as a person would; the film uses the run that holds.
- **`play.step(id, fn, marks)`** names a stretch: that is what a caption,
  a pin and the plan hold on to. Mark the stretch that is play
  `zoom: false`: the pointer there is steering, not pointing, and the
  planner then proposes nothing over it. Mark the reveal `payoff: true`.
- **Reading the world.** For a page, start the stage's browser with
  `--remote-debugging-port=<port>` and read state over it (the position
  of what must be followed, the score). Read, never write: the product's
  code is not touched and nothing is injected that changes what it does.
  For a native app, `play.find(selector)` answers an element's bounds and
  name.
- **Keep it honest.** The program plays the product as a person would,
  through the real pointer and keys. Never set a score, skip a level or
  edit state to make the picture.

Before 0.94 there is no `--play`: the film then shows the thing running
without play, and says so.

## A long task

"Ask, wait, show the result" is one take when the working is worth
showing (0.94 and later): wait inside the take, then cut it.

```json
{ "do": "expect", "gone": "button[name='Stop']", "timeout": 1800, "id": "working", "caption": "It builds" }
```

with `--max-duration` above the wait. From 0.95 a `wait` or an `expect`
may carry `"zoom": false`: the wait is watched whole, and the planner
proposes nothing over it whatever the pointer does meanwhile (before
0.95 `vos validate` refuses the mark). A window that stands still
costs almost nothing (about 7 KB a second); an app that is working is
about 120 KB a second, so eighteen minutes is about 130 MB. A wait looks
again when the window cannot be read for a moment. The machine is taken
for the whole wait and must stay awake (above), so say how long.

**Cutting it.** From 0.95 `vos digest` looks inside a wait: an idle of
45 seconds or more carries `glance` moments, the seconds where the
picture changed while nothing was pressed and an even pace through the
rest, each with a frame on the sheet. Choose the windows from those.
Before 0.95 the digest has one `idle` moment for the whole wait, and you
make your own eyes, a contact sheet with a frame every 40 seconds:

```bash
ffmpeg -i take/recording.mp4 -vf "fps=1/40,scale=480:-1,tile=6x5" -frames:v 1 contact.png
```

Then keep four or five windows of about 40 seconds as `segments` (the
checklist appearing, the first files, the first picture, the last
checks), one `speed` span at 16 over all of them, a short `fade` between
them, and the finished state at its own pace. Put the plan's own span in
`rejected`. The app's own counter in the picture ("18m 3s") is the
film's proof of how long it took.

When the wait is long and nobody can leave the machine alone, it is two
takes joined, as `desktop.md` says. Either way, never take clips on a
clock: they catch the same moment three times.

## Join, then cut

```bash
vos join take-ask take-terminal take-play --out film --captions
vos digest film            # one digest per take: digest/, digest/m1/, digest/m2/
```

The first take is the primary; each next one is `m1`, `m2`, in order. A
span on a later take carries `"media": "m1"` and its seconds are that
take's own footage.

- **The cold open is a segment.** Open on two or three seconds of the
  payoff, then tell the story from the start: the first entry of
  `segments` names the last take
  (`{ "in": 14, "out": 16.5, "media": "m2", "camera": "rest" }`), and the
  rest follow in story order. Say it in a caption ("One prompt made
  this").
- **A change of app is a transition**, written on the segment that
  enters: `"anim": { "enter": { "kind": "slide", "side": "right", "seconds": 0.5 } }`
  between apps, a short `fade` between two takes of one app.
- **Captions sit where the app was not pressed.** A chat app's composer
  is in the lower third, where the house caption goes. From 0.94 the
  plan puts that take's captions at the top and says so; before it, set
  `transform.y` (0.14) on that take's captions by hand. Judge each
  caption at its own instant.
- **The pointer is off where nobody points**: `cursor.off` spans over
  the cold open and over play.
- **Reject by take.** A proposal you drop goes in `rejected` with its
  `media`. (Before 0.94, `vos validate` refuses a rejection that starts
  later than the FIRST take is long: upgrade, do not delete the span by
  hand and re-plan.)
- **One bed across the film**, placed after the cut, with its swell on
  the step marked `payoff`.

## The report

Beside the film: every app that was launched and that it is closed, the
servers stopped, what is left in an account (a session, by name) and on
disk, what of the person's showed and for how long, and how long the
pointer and keyboard were taken.

## Avoid

- Scripting play. If the thing answers back, it needs a loop.
- Opening a picker of the person's recent work on camera.
- Clips of a long task taken on a clock.
- Trusting a terminal's title bar. Mask it, by its role: a mask that
  names the title's words loses it when a command runs.
- Two takes joined for a moment two apps share. That is a stage.
- Naming an app the person has open on a stage. Name the throwaway by
  `--pid`.
- A second take because the camera sat on the wrong window. Drop the
  rest in the cut.
- Typing into an address bar without selecting what is there.
- Filming across a change of the system's appearance.
- Leaving a server the agent started, or stopping one by pattern.
- A second browser profile that is the person's own.
