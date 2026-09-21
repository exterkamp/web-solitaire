# Fonts

Four files. Three are under the [SIL Open Font License
1.1](https://scripts.sil.org/OFL) — see OFL.txt, which carries their copyright
notices over one copy of the licence text. The OFL allows bundling,
modification and commercial use; its one real condition is that the fonts are
not sold on their own, which is not something a card game is at risk of doing.

Schoolbell is **not** one of them: it is Apache 2.0, and its licence is in
APACHE-2.0.txt. Also permissive, also fine to bundle, but a different licence
with its own attribution requirement, so it is kept and named separately
rather than folded in with the other three.

| File | Family | Designer | Used for |
| --- | --- | --- | --- |
| `cinzel-latin.woff2` | [Cinzel](https://github.com/NDISCOVER/Cinzel) | Natanael Gama | Display: headings, buttons, labels — set in caps |
| `jost-latin.woff2` | [Jost\*](https://github.com/indestructible-type/Jost) | Owen Earl | Body: sentences, rules, prices, small print |
| `archivo-latin.woff2` | [Archivo](https://github.com/Omnibus-Type/Archivo) | Omnibus-Type | The rank in a card's corner, and nothing else |
| `schoolbell-latin.woff2` | [Schoolbell](https://fonts.google.com/specimen/Schoolbell) | Font Diner, Inc. (Apache 2.0) | The scoreboard's entries — the hand, not the form |

All are the **latin subset**, and the three OFL ones are **variable**, which
is why there are so few files: one Cinzel covers 400–900, one Jost 300–700
and one Archivo 500–700, so asking for a different weight costs nothing extra
to download. Schoolbell has a single weight and that is all it needs — see
below. 108kB for the set.

They are served from here rather than from Google's CDN. A game that deals
its own cards and keeps its own scores should not need a third party to be up
in order to render its own menus, and a font that arrives late is a menu that
visibly reflows.

## Why these two, for the app itself

Cinzel is cut from Roman inscriptional capitals — the lettering on a
monument, a bank, a club door. It has lowercase but is drawn to be set in
caps, which is how it is used here. It is also why nearly all display text in
this app is uppercase rather than merely styled that way.

Jost\* is a geometric sans in Futura's line, which puts deco signage next to
Roman capitals — the two things a card room of this vintage would actually
have had lettered on its walls. It is a sans on purpose: a rule you have to
read should not be competing with the lettering above it, and the alternative
tried first here (EB Garamond, a book face) made every screen read as a page
rather than a table.

The one cost is that Jost has a low x-height, so its small greyed notes go
airier than a humanist sans would. If a note ever turns out to be genuinely
hard to read on felt, raise its size rather than its weight — Jost's lighter
weights are where its character is.

## Why there is a third one

The app has two voices, not three. Archivo is not a voice — it draws the
rank in a card's corner and nothing else, and it is there because a card
index is a different problem from a user interface.

Eleven glyphs have to be told apart instantly, inside a box a few units
tall, with no surrounding word to disambiguate them. Jost fails that on
exactly one: its `J` is the only rank with a descender, hanging six units
below every other glyph. Measured off a rendered card, that put the hook
that distinguishes a J from a plain bar *underneath the card below it* in a
fanned pile — the fan reveals 29.4 units and the J's ink ran to 31.2.

Archivo is a grotesque drawn for signage and small print. Its J sits on the
baseline with the rest, and at 27px it puts down the same 19px of ink that
the corner was originally laid out against.

## Why the scores are handwritten

A scorepad is a printed form with somebody's handwriting on it, and the
scoreboard is now drawn that way: the column headings stay in the body face,
and the names and numbers underneath are in a hand.

Schoolbell was picked over five other hands after rendering all of them in
the real scoreboard. That comparison was wrong the first time and worth
recording why: handwriting faces put very different amounts of ink into the
same em, so setting them all at one `font-size` is not a fair test. Reenie
Beanie needs 138px to match a digit height Jost reaches at 100, and at a
shared size it looked illegible when it simply looked small. Measure the
digit ink before comparing.

That measurement is also why the scoreboard's entries are set at 1.05rem
where the printed part is 0.95rem.

Schoolbell has one weight, so the table's `font-weight: 700` is the browser's
synthetic bold. That is usually worth avoiding on a thin hand, because faux
bold smears strokes together rather than thickening them — but rendered
against the 400 at 3x density this one fattens cleanly and keeps the counters
in 6 and 0 open, at both sizes the scoreboard uses. Checked rather than
assumed, and worth re-checking if the hand ever changes.

`-webkit-text-stroke` was the alternative and is the worse one here: it
paints its stroke in flat ink, which takes the grain off the outside of every
glyph.

## Replacing them

`src/styles.scss` holds the @font-face rules and the two variables every
other stylesheet reads, and `src/_type.scss` holds the display treatment
(caps and tracking) that travels with Cinzel. Phaser does not read CSS, so
the families are named again in `src/app/game/fonts.ts` for the canvas
(including the card index, which lives only there), and the app waits for
them before it bootstraps — see the note there
and in `src/main.ts`.
