# Developing web-solitaire

Everything a person needs to change this game, deploy it, or work out why it
is behaving oddly. The [README](README.md) is for people who want to play it.

```bash
npm install
npm start          # http://localhost:4200
npm test           # the rules, in vitest
npm run smoke      # a real browser plays a real game
```

Node 24 — see `.nvmrc`. Angular 22 (zoneless, signals, standalone components),
Phaser 3.90, vitest for the rules and the Chrome DevTools Protocol for
everything that needs a screen.

## Deploying

Serve the built game the way it is meant to be served:

```bash
./deploy.sh          # npm run build, then compose up
open http://localhost:8083
```

Three speeds, because the build is the whole cost:

```bash
./deploy.sh          # production: minified and hashed, what the public gets
./deploy.sh --fast   # development build, no minifier
npm run watch &      # rebuilds dist/ on save, about 85s a change here
./deploy.sh --now    # ships whatever is in dist/ — fifteen seconds
```

`--now` beside a running watcher is the loop to use while somebody is waiting
with a phone in their hand. Finish with a plain `./deploy.sh` so the site
strangers load is a real build.

`deploy.sh` rather than `docker compose up --build` because the image copies a
build instead of making one. That is a step backwards from a self-contained
multi-stage Dockerfile and it was taken for a reason: building inside the
Docker daemon on this host took enough memory to stop dockerd — twice — and
every container on the machine went down with it, Traefik and the tunnel
included. A build that can take the household offline is not a build worth
having in the image.

8083 because the neighbours got there first: 8080 and 8081 are Nertz,
production and development, 8082 is exterkamp.codes, and 8085 is the chiptune
studio. `SOLITAIRE_PORT` overrides it.

### Published

`solitaire.exterkamp.codes`, by the same path Nertz takes:

```
browser -> Cloudflare -> cloudflared (the personal site's stack)
        -> traefik:443 (wildcard cert, chain-tunnel)
        -> solitaire-web:80 on the `proxyhosts` network
```

Three pieces, in three places:

1. **The container joins `proxyhosts`**, Traefik's shared network, and answers
   there to `solitaire-web`. That is in this repo's `docker-compose.yml`. The
   published 8083 is unrelated to the public path and exists so the game can
   be played on the machine itself.
2. **A router**, in `~/code/traefik/dynamic/routers.yml`: `solitaire` ->
   `svc-solitaire` -> `http://solitaire-web:80`, behind `chain-tunnel@file` —
   crowdsec, security headers and rate limits keyed on `CF-Connecting-IP`, and
   deliberately no forward auth, because a login wall on a game of solitaire
   would be an odd thing to build.
3. **A DNS record and a public hostname on the tunnel.** The record is a
   proxied CNAME to `f3629069-….cfargotunnel.com`, the tunnel the personal
   site's stack runs. The hostname also has to be listed on that tunnel, in
   Cloudflare's Zero Trust dashboard, pointing at `https://traefik:443` — the
   tunnel is remotely managed, so its ingress rules live at Cloudflare rather
   than in any file here. Without that entry the name resolves, reaches
   cloudflared, and gets a bare 404 with none of Traefik's headers on it,
   which is the quickest way to tell this step is missing.

Because the tunnel belongs to the personal site's stack, this route goes down
whenever that stack is restarted, and the symptom will not point at solitaire.
Nertz has the same caveat, recorded in the same words next to its own router.

## Installing it, and playing offline

* `public/manifest.webmanifest` is what makes a browser offer to install it —
  name, icons, portrait, and the felt's own colour for the splash so the
  launch does not flash white.
* `ngsw-config.json` says what to keep. The app and the deck it deals by
  default are fetched on install, about 2.3MB; the other six decks are kept as
  they are used, which is another 3.9MB nobody should pay for up front.
* A deck that was never cached still deals — see the `textures.exists` check
  in `card-sprite.ts`. Its court cards come out wearing the big suit that
  number cards wear, which is a plainer card rather than a broken one.
* **Registration is immediate for a returning visitor and waits for the first
  board on a first visit.** A brand-new worker answers no request until it has
  finished prefetching, so registering it while the first game is still asking
  for its cards means the game waits on the cache instead of the other way
  round — half a minute of empty felt, before that was moved. But registration
  is also what starts Angular looking for a new version, so delaying it for
  somebody who already has a worker is delaying the *update*, and that shipped
  once: a new game went out and returning players could not see it. Both halves
  are in `app.config.ts`, and `first-board.ts` is the promise the first visit
  waits on.
* A new version reloads the app as soon as the player is somewhere a reload is
  free — anywhere but the board, where it would take the deal with it. See
  `app.ts`.
* Settings prints the running build, taken from the hash in the bundle's own
  name. An app that updates itself in the background makes "am I on the new
  one?" a real question, and that line is the answer.

`npm run smoke` proves the whole of it: it plays a game, waits for the worker
to fill its cache, cuts the network, and then **enters by address** rather than
reloading — asking for `/`, which has never existed as a file, so answering it
at all means the installed app can be opened cold rather than merely resumed.

## How it is put together

Angular for the pages, Phaser for the board, and a hard line between them.

```
src/app/game/
  table-game.ts      the interface a game implements for the board
  klondike.ts        the rules. no Phaser, no Angular, no DOM
  klondike.spec.ts   and their tests
  freecell.ts  yukon.ts  canfield.ts  spiderette.ts        the same,
  scorpion.ts  seahaven.ts  tripeaks.ts  pyramid.ts         ten more
  golf.ts  acesup.ts                                        times
  klondike-table.ts  where Klondike's piles go, and what the board shows
  card-rules.ts      the rules more than one game needs
  session.ts         one game in progress: history, undo, the clock
  deck.ts            what a card is, and a shuffled deck of them
  config.ts          the board's measurements, in 480x720 logical units
  deck-theme.ts      the seven decks and the colours a back is printed over
  solitaire-scene.ts the board: layout, gestures, animation, the cascade
  card-sprite.ts     one card, drawn
  table.ts           felt, rail, lamp, and the lettering printed on it
  board.ts           the Phaser game the scene runs in
  fonts.ts           the typefaces, named again for the canvas
src/app/pages/       menu, game setup, play, settings, record
src/app/settings.ts  standing preferences
src/app/stats.ts     the record book
```

Four things are worth knowing before changing any of it.

**The rules module decides nothing about the screen and the scene decides
nothing about the rules.** Each rules module is pure functions over a state:
every move returns a new state rather than editing the one it was given, which
is what makes undo a stack of old states instead of a second implementation of
every move running backwards. The scene asks whether a move is legal and
animates the answer. Where the two could disagree — what a tap means, which
pile a dropped card is nearest — the scene decides, because those are facts
about a thumb rather than about Klondike.

**One board, eleven games.** `solitaire-scene.ts` owns everything about a screen
and a thumb — picking a run up, following it, deciding what a release meant,
and the fifty-two cards that fall out of a won game — and knows nothing about
any particular game. Each game supplies a `TableGame` instead: its rules behind
one interface, and where its piles are printed. No game has heard of the board,
and the board has never heard of a stock or a free cell. The day that input
machinery is written twice is the day the games start behaving differently by
accident.

Most of them lay their piles out in columns and two rows and let the board
place them. Three do not: Tri Peaks, Pyramid and Golf give exact coordinates
for every pile, say they do not want the board's thumb-reach drop, and decide
for themselves which of their positions are printed on the felt and which can
be dropped onto. Those three flags — `x`/`y` instead of `column`/`row`,
`drops`, `printed`/`target` — are the whole of what it took to put a pyramid
and a wall on a board built for columns.

Those flags arrived with Tri Peaks, along with `homeFor` becoming optional for
a game with no foundations to flick a card to. Everything added since has cost
the interface three fields between seven games, all of them on `GameView` and
all of them numbers for the bar: `deck` for the Spider family's row counter,
`reserve` for Canfield's thirteen, and `base` for the one game whose
foundations do not start on an ace. Otherwise a new game touches only the lists
that have to name every game - the id union, the factory in `play.ts`, the
record book's variants and the menu - and is three new files. That is the
measure of whether the shape was right.

Two of those games are worth knowing about because they push at the edges.
**Canfield** keeps the reserve in a `cell` pile, which is what it is as far as
the board is concerned: a stack off to one side that gives up its top card. Its
foundations start on a rank the deal picks and both its sequences wrap, so it
cannot use `card-rules.ts` for either and says so with its own `rankAbove` and
`rankBelow`. **Seahaven** is the widest table here - ten columns is 677 units
against Klondike's 480, so its cards come out about 37 CSS pixels across on a
412-pixel phone where Klondike's are 51. That is the arithmetic that keeps
Spider off this menu; Seahaven survives it because its piles are five deep and
everything is visible at a glance.

Those lists are worth keeping exhaustive rather than defaulted. `GameId` is a
union and `makeTable` switches over it, so a game left out of the factory is a
compile error; the same goes for the menu's blurbs and the setup page's guides,
which are `Record<GameId, …>`. The one place that cannot work that way is the
route, which is a string a person can type - `asGameId` guards it and answers
Klondike for anything it does not know.

The one thing a game's shape changes outside its own module is the board's
width: eight columns of cards need a wider table than seven, so FreeCell asks
for one and Phaser fits it to the screen. The cards come out about a tenth
smaller and are drawn from exactly the same textures — the alternative was a
second set of every measurement in `card-sprite.ts`.

**The board is 480x720 logical units, always.** Phaser's `Scale.FIT` scales
that to whatever the screen is, and the scene scales its root container by the
device pixel ratio so the canvas is rasterized at real resolution while every
coordinate in the game stays in the original units. 720 rather than a phone's
own proportions because seven columns of cards decide the width, the width
decides how big a card is, and any height beyond the longest possible fan is
felt nobody plays on — bought by making every card smaller.

Within those units, the layout slides down to meet your thumbs. Those 720 units
reserve room for the deepest pile Klondike can deal, and a game spends almost
none of its time near it — so the whole layout, printing included, sits at the
bottom of the room the tableau is actually using and rises only when a pile
grows long enough to want that room back. It moves in steps of about one card
index rather than following the deepest pile exactly, because a table that
shifted on most moves would be worse than one sitting too high. See
`MAX_BOARD_DROP` in `config.ts`.

**Phaser owns the cards and nothing else.** The score, the clock, the buttons
and the win panel are DOM laid over the canvas, because they are text and
buttons, and a browser draws those better than a canvas can — with focus rings
and screen-reader labels that come for free.

### Three things this codebase keeps relearning

`Scene` already has members called `game` and `events`, and a field of your own
by either name replaces machinery Phaser needs. This file has learned that
lesson three times; the fields are called `table` and `report` now.

A hit area is in **texture space**, not centred on the sprite — Phaser adds the
display origin itself. `new Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT)` is right
and `new Rectangle(-w/2, -h/2, w, h)` puts every card's grabbable area half a
card up and to the left, which is subtle enough to ship and infuriating enough
to report.

A game laid out by hand has to start **below `TABLEAU_TOP_Y - 23`**, which is
where the board prints the game's name across the felt. Pyramid was given an
apex at 100 and put its second row straight through the lettering. Tri Peaks
and Golf both start at 150, and now so does Pyramid.

## Testing

`npm test` runs the rules in vitest: dealing, placement, lifting runs, drawing
and recycling, scoring, undo, what a tap means, and how a game ends. It is fast
because none of it draws anything.

`npm run smoke` is the other half, and needs a build being served:

```bash
npx ng build
(cd dist/web-solitaire/browser && python3 -m http.server 4380) &
npm run smoke -- --host=http://localhost:4380
```

It drives a real headless Chrome over the debugging protocol: deals a hand,
checks the deal behind the board, taps the stock at the coordinates the board
says it is at, presses all four corners of a card and the exposed index of two
buried ones to check that a hit area is where its card is, drags a queen onto a
king, rigs a position one move from won, presses Finish, and waits for the win
panel and the record book. `--dpr=2` runs the lot at a doubled pixel ratio,
which is worth doing after anything touching input or layout: the scene scales
its root container by that number, so a hit area can be right at 1 and wrong at
2. It catches the class of fault a unit test cannot see at all — a scene that
throws on start, art that 404s, a tap that lands on nothing, a win that never
reaches the page — and it writes a screenshot to `/tmp/solitaire-smoke.png`,
which is the only part a person still has to look at.

It runs the board's clocks at twenty times speed, because headless Chrome has
no GPU and draws this board at about one frame a second. That is nothing to do
with this game: Nertz's board measures the same on the same machine.

### The pictures in the README

```bash
./deploy.sh --now                  # or point --host at a dev server
node tools/screenshots.mjs         # --only=freecell,menu to retake some
```

Eleven games at eleven boards plus the menu and a game page is about seven
minutes of headless Chrome, which is why `--only` exists.

Same headless Chrome, at a phone's size and pixel ratio, writing webp into
`docs/screenshots/`. It taps its way through a few real moves first, because a
fresh deal is the picture every solitaire README already has and what this one
looks like under way is the part worth seeing. FreeCell is the exception and is
shown as dealt: the tapper is greedy rather than good, and one round of it
parks a card in all four cells.

A screenshot in a repository goes stale the moment somebody moves a button. The
only defence is making the retake a command rather than an afternoon.
