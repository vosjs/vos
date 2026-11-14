# One film across several apps

Read this when the story leaves one window: a prompt in a chat app, a
command in a terminal, the result in a browser. Read `desktop.md` first;
everything in it holds for each app here.

**The unit is still one window.** A take records one app's window, and a
film is a list of takes: record each app as its own take, then
`vos join` them. There is no capture of several windows at once, and none
is needed. Needs `@vosjs/cli` 0.93 or later; what needs 0.94 says so.

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

- **Mask the title bar.** A terminal's title names the running process,
  and once a tool rewrites its process title (`npm` does) the title can
  show the environment of the shell that launched it. Cover the title's
  text before the command runs:
  `"mask": [{ "selector": "text[name*='<project> —']" }]` (read the role
  and the name from `vos look`).
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
- Trusting a terminal's title bar. Mask it.
- Typing into an address bar without selecting what is there.
- Filming across a change of the system's appearance.
- Leaving a server the agent started, or stopping one by pattern.
- A second browser profile that is the person's own.
