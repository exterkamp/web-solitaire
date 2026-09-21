# web-solitaire

Klondike solitaire, in a browser, for one person. No account, no server, no
network: the game is a directory of static files, and everything it remembers
about you is in your browser's own storage.

It shares a deck with [web-nert](../web-nert) — the same court cards, the same
seven deck themes, the same felt — and shares nothing else. See
[Where the art came from](#where-the-art-came-from).

```bash
npm install
npm start          # http://localhost:4200
npm test           # the rules, in vitest
npm run smoke      # a real browser plays a real game (see below)
```

Or serve the built game the way it is meant to be served:

```bash
docker compose up -d --build
open http://localhost:8083
```

8083 because the neighbours got there first: 8080 and 8081 are Nertz,
production and development, 8082 is exterkamp.codes, and 8085 is the chiptune
studio. `SOLITAIRE_PORT` overrides it.

## Published

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
   `svc-solitaire` -> `http://solitaire-web:80`, behind `chain-tunnel@file` -
   crowdsec, security headers and rate limits keyed on `CF-Connecting-IP`, and
   deliberately no forward auth, because a login wall on a game of solitaire
   would be an odd thing to build.
3. **A DNS record and a public hostname on the tunnel.** The record is a
   proxied CNAME to `f3629069-….cfargotunnel.com`, the tunnel the personal
   site's stack runs. The hostname also has to be listed on that tunnel, in
   Cloudflare's Zero Trust dashboard, pointing at `https://traefik:443` -
   the tunnel is remotely managed, so its ingress rules live at Cloudflare
   rather than in any file here. Without that entry the name resolves, reaches
   cloudflared, and gets a bare 404 with none of Traefik's headers on it,
   which is the quickest way to tell this step is missing.

Because the tunnel belongs to the personal site's stack, this route goes down
whenever that stack is restarted, and the symptom will not point at solitaire.
Nertz has the same caveat, recorded in the same words next to its own router.

## The game

Klondike, drawing one card or three. Both are offered from the menu and are
scored and recorded separately, because they are not the same game: draw-one
is won most of the time by anybody paying attention, and draw-three is won
perhaps one hand in ten.

* **Tap** a card to send it wherever it obviously goes — its foundation if it
  can go home, otherwise a tableau pile that will take it. An occupied pile is
  preferred to an empty one, because an empty column is a resource and filling
  it by accident is how it gets wasted.
* **Drag** a card, or a run of cards, to say exactly where it goes. The pile
  under it lights up only where the move is legal; a refused drop snaps back.
* **Flick** a card up the board and it goes to its foundation, wherever you
  let go of it. One card at a time, since that is all a foundation takes, and
  a throw the foundations will not accept costs nothing — it lands as an
  ordinary drop would have.
* **Undo** as far back as you like, including past a win. Undoing costs
  nothing: a score is a measure of the game you played, and an undone move is
  a game that did not happen.
* **Hint** flashes one move, then the pile it should go to a beat later. It
  offers a card going home first, then the move that turns a card over — the
  only kind of move that adds information — then getting something out of the
  waste.
* **Finish** appears once every card is face up and the rest of the game is a
  formality, and plays it out. The cards then fall out of the foundations and
  bounce off the bottom of the screen, which is the oldest piece of
  choreography in computer games and the only reason anybody finishes a hand
  they have already won.
* The **stock** turns a card whether you press the top of it or the empty
  slot it leaves behind — the second of those is how the waste goes back to
  being a deck. Unlimited passes, with the usual price: see the scoring below.

### Scoring

Windows Solitaire's standard scoring, which is what people mean when they say
a solitaire game has a score:

| | |
| --- | --- |
| Waste → tableau | +5 |
| Waste or tableau → foundation | +10 |
| Turning over a tableau card | +5 |
| Foundation → tableau | −15 |
| Turning the deck over again (draw one) | −100 |
| Turning the deck over again (draw three) | −20, after two free passes |
| Finishing | +700000 / seconds, if the game took over half a minute |

The score never goes below zero. There is **no** time penalty, which Windows
had at two points every ten seconds: on a phone a game is put down mid-hand
constantly, and a score that drains while the screen is off punishes the
interruption rather than the play. The time bonus is the other half of that
bargain — finishing quickly is still worth something, thinking slowly is not
worth anything at all.

### What is remembered

Games played and won, win rate, best score, best time, fewest moves, average
length of a win, current streak and longest streak — kept separately for
draw-one and draw-three, in `localStorage` under `solitaire.stats.v1`. A game
counts as played once you have made a move in it, so dealing a hand, looking at
it and dealing another is free.

Clearing your browser's storage clears the record. That is a real limitation
and a deliberate one: the alternative is an account, a password, and somewhere
for both to live.

## How it is put together

Angular for the pages, Phaser for the board, and a hard line between them.

```
src/app/game/
  klondike.ts        the rules. no Phaser, no Angular, no DOM
  klondike.spec.ts   and their tests
  session.ts         one game in progress: history, undo, the clock
  deck.ts            what a card is, and a shuffled deck of them
  config.ts          the board's measurements, in 480x720 logical units
  deck-theme.ts      the seven decks and the colours a back is printed over
  solitaire-scene.ts the board: layout, gestures, animation, the cascade
  card-sprite.ts     one card, drawn
  table.ts           felt, rail, lamp, and the lettering printed on it
  board.ts           the Phaser game the scene runs in
  fonts.ts           the typefaces, named again for the canvas
src/app/pages/       menu, play, settings, record
src/app/settings.ts  standing preferences
src/app/stats.ts     the record book
```

Three things are worth knowing before changing any of it:

**The rules module decides nothing about the screen and the scene decides
nothing about the rules.** `klondike.ts` is pure functions over a state: every
move returns a new state rather than editing the one it was given, which is
what makes undo a stack of old states instead of a second implementation of
every move running backwards. The scene asks it whether a move is legal and
animates the answer. Where the two could disagree — what a tap means, which
pile a dropped card is nearest — the scene decides, because those are facts
about a thumb rather than about Klondike.

**The board is 480x720 logical units, always.** Phaser's `Scale.FIT` scales
that to whatever the screen is, and the scene scales its root container by the
device pixel ratio so the canvas is rasterized at real resolution while every
coordinate in the game stays in the original units. 720 rather than a phone's
own proportions because seven columns of cards decide the width, the width
decides how big a card is, and any height beyond the longest possible fan is
felt nobody plays on — bought by making every card smaller.

**Within those units, the layout slides down to meet your thumbs.** Those 720
units reserve room for the deepest pile Klondike can deal, and a game spends
almost none of its time near it — so the whole layout, printing included, sits
at the bottom of the room the tableau is actually using and rises only when a
pile grows long enough to want that room back. It moves in steps of about one
card index rather than following the deepest pile exactly, because a table
that shifted on most moves would be worse than one sitting too high. See
`MAX_BOARD_DROP` in `config.ts`.

**Phaser owns the cards and nothing else.** The score, the clock, the buttons
and the win panel are DOM laid over the canvas, because they are text and
buttons, and a browser draws those better than a canvas can — with focus rings
and screen-reader labels that come for free.

## Testing

`npm test` runs the rules in vitest: dealing, placement, lifting runs, drawing
and recycling, scoring, undo, what a tap means, and how a game ends. It is
fast because none of it draws anything.

`npm run smoke` is the other half, and needs a build being served:

```bash
npx ng build
(cd dist/web-solitaire/browser && python3 -m http.server 4380) &
npm run smoke -- --host=http://localhost:4380
```

It drives a real headless Chrome over the debugging protocol: deals a hand,
checks the deal behind the board, taps the stock at the coordinates the board
says it is at, presses all four corners of a card and the exposed index of two
buried ones to check that a hit area is where its card is, drags a queen onto
a king, rigs a position one move from won, presses Finish, and waits for the
win panel and the record book. `--dpr=2` runs the lot at a doubled pixel
ratio, which is worth doing after anything touching input or layout: the scene
scales its root container by that number, so a hit area can be right at 1 and
wrong at 2. It catches
the class of fault a unit test cannot see at all — a scene that throws on
start, art that 404s, a tap that lands on nothing, a win that never reaches the
page — and it writes a screenshot to `/tmp/solitaire-smoke.png`, which is the
only part a person still has to look at.

It runs the board's clocks at twenty times speed, because headless Chrome has
no GPU and draws this board at about one frame a second. That is nothing to do
with this game: Nertz's board measures the same on the same machine.

## Where the art came from

The deck is Nertz's, copied rather than shared — see
[public/cards/ATTRIBUTION.md](public/cards/ATTRIBUTION.md). The courts are
Dmitry Fomin's CC0 English pattern cards; the backs are generated guilloche
line work printed over whichever colour you pick; the suits are drawn for the
deck rather than taken from a typeface, because in most faces the club and the
spade are the same blob at card size and telling them apart is exactly what a
card game asks of you.

Copied, not symlinked and not packaged, because these are different games.
Nothing about a solitaire deck should be waiting on a change made for a
four-player race, and the whole deck is five megabytes on disk.

The fonts came the same way and carry their own licences in
[public/fonts](public/fonts): Cinzel for display, Jost for text, Archivo for
the rank in a card's corner, and Schoolbell for what is written on the record
book.

No sound. Nertz has music and this does not — solitaire is the game you play
in a waiting room.
