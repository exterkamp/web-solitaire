---
name: add-solitaire-game
description: Add a new solitaire variant to web-solitaire. Use when asked to implement, add, or port a new game/variant (e.g. "add Forty Thieves", "implement Klondike's cousin X") into this repo. Not for changes to an existing game's rules, and not for phaser-card-engine itself.
---

# Adding a solitaire game

Twelve games already follow one shape. A new one is normally **three new
files plus edits to five lists that have to stay exhaustive** — the compiler
catches a missed list because `GameId` is a union and the switches over it are
exhaustive, but the `Record<GameId, …>` maps and plain arrays below are not
all compiler-checked, so work through this list in order rather than trusting
`tsc` alone to say you're done.

Read `DEVELOP.md`'s "How it is put together" section first if you haven't —
it explains *why* the shape is this way, which matters for the judgment calls
below (fanStep, drops, homeFor).

## 0. Get the rules right before writing code

`game-setup.ts`'s guides are checked against Wikipedia and, where available,
Bicycle's rulebook, and are the *standard* rules — past looseness got
tightened rather than documented as a variant. Confirm deal, legal moves, and
win condition against a real source before implementing, especially for an
obscure variant.

## 1. Register the id

In `src/app/game/table-game.ts`:
- Add the new id to the `GameId` union and to `GAME_IDS`.
- Add its display name to `GAME_TITLES`.

## 2. The rules module — `src/app/game/<name>.ts`

Pure functions over a state. No Phaser, no Angular, no DOM. Every move
returns a new state rather than mutating the one it was given (this is what
makes undo a stack of old states). Reuse `card-rules.ts` for standard
build-down/alternating-colour logic — write your own `rankAbove`/`rankBelow`
only if the game's foundations don't start on an ace or its sequences wrap
(Canfield does both and says so explicitly; that's the exception, not the
pattern).

## 3. The table module — `src/app/game/<name>-table.ts`

Implement `TableGame<S>` from `table-game.ts`. Key decisions, not defaults:
- `slots()`: most games give `column`/`row` and let the board place them.
  Games whose layout isn't a grid (Tri Peaks, Pyramid, Golf, Black Hole) give
  exact `x`/`y` instead, plus `drops: false`, and mark `printed`/`target`
  per-slot. Only reach for `x`/`y` if the layout genuinely isn't a grid.
- `width`: only widen past the default if the column count needs it
  (Seahaven's ten columns is the existing example) — Phaser fits the board to
  the screen either way, but a wider board makes every card smaller.
- `homeFor`: omit it if the game has no foundations to flick a card to (a
  present-but-wrong answer is worse than no answer).
- `GameView` (from `view()`): only add a new field if the game has a genuinely
  new number to show. Three fields have been added across seven games total —
  treat a fourth as a sign to double check the game really needs it.

**Never import `phaser-card-engine` here.** Rendering is the shared board's
job (see CLAUDE.md's engine-boundary section); a table module only describes
state and layout.

## 4. Tests — `src/app/game/<name>.spec.ts`

Vitest, no browser. Cover: the deal's shape (right card counts in the right
piles), legal vs. illegal moves per the rules you confirmed in step 0,
win detection, and dead-end detection if the game can reach one.

## 5. Wire it into the app — four more edits

- **`src/app/pages/play/play.ts`**: add a case to `makeTable`'s switch. It's
  exhaustive over `GameId`, so a missed case is a compile error here — the one
  step you can't silently skip.
- **`src/app/pages/main-menu/main-menu.ts`**: one line in the `blurbs: Record<GameId, string>` map.
- **`src/app/pages/game-setup/game-setup.ts`**: one entry in `GUIDES: Record<GameId, Guide>`
  — title, summary, and the setup/play/winning rules from step 0.
- **`src/app/stats.ts`** (not compiler-checked — a spec checks it instead):
  - add the id to the `Variant` type and to `VARIANTS`
  - add its `emptyMode()` entry in `emptyStats()`'s `byVariant`
  - add a block to `VARIANT_GROUPS` (`title`, `variants`, `scored`)
  - only touch `variantOf()` if the game has sub-variants the way Klondike's
    draw count does (rare — most games are one variant, one id)

## 6. Verify

```bash
npm test                                 # rules + the VARIANT_GROUPS completeness spec
npx tsc --noEmit -p tsconfig.app.json    # NOT tsconfig.json — see CLAUDE.md
npm start                                # play it once, by hand
npm run smoke -- --host=http://127.0.0.1:4200   # if you built and served it
```

Optionally add a screenshot to `docs/screenshots/` via `tools/screenshots.mjs`
to keep the README's gallery complete.
