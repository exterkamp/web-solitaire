# CLAUDE.md

Guidance for Claude Code working in this repo. For the full architecture
narrative, deploy mechanics and PWA details, read **DEVELOP.md** first — this
file only adds what an agent needs on top of it, and does not repeat it.

## What this is

Klondike-and-eleven-siblings solitaire. Angular 22 (zoneless, signals,
standalone) for the pages, Phaser 3.90 for the board, a hard line between
them. Card art, sprites and the deck come from `phaser-card-engine`, a
sibling package. Local only — no server, no accounts, stats in
`localStorage`.

## Commands

```bash
npm test                                     # rules, in vitest
npx tsc --noEmit -p tsconfig.app.json        # real typecheck
npm start                                    # dev server, :4200
npm run smoke -- --host=http://127.0.0.1:8083  # CDP plays a real game
./deploy.sh                                  # build + compose up, :8083
```

**`tsc --noEmit -p tsconfig.json` (no `.app`) checks nothing** — the root
config is a solution file with `"files": []`. Always target
`tsconfig.app.json` (or `.spec.json` for tests), or just run `ng build`.

## Architecture, in one paragraph

Each game is three files under `src/app/game/`: `<name>.ts` (pure rules —
no Phaser, no Angular, no DOM, every move returns a new state), `<name>-table.ts`
(implements the shared `TableGame<S>` interface from `table-game.ts` — where
its piles sit, and hands off to the rules), and `<name>.spec.ts`. One Phaser
scene, `solitaire-scene.ts`, runs all twelve games and knows nothing about any
of them specifically. See DEVELOP.md's "How it is put together" for the full
version, including the flags that let non-grid boards (Tri Peaks, Pyramid,
Golf, Black Hole) opt out of the column layout.

**To add a new game, use the `add-solitaire-game` skill** — it has the exact
checklist of files to create and the lists that have to stay exhaustive.

**To style or polish a screen, use the `ui-polish` skill** — it documents the
existing color/type/component/layout system in `styles.scss`, `_type.scss`
and `_page.scss`, and names the actual gap (no transitions, no elevation
scale) rather than inventing new conventions on top of what's there.

## The phaser-card-engine boundary

`phaser-card-engine` (`~/code/phaser-card-engine`, pinned in `package.json` as
`github:exterkamp/phaser-card-engine#vX.Y.Z`) owns card art, the `Card`/
`Stack`/`Hand` primitives and the renderer. In this repo it is imported from
exactly one layer — `board.ts`, `card-sprite.ts`, `config.ts`,
`deck-style.ts`, `deck-theme.ts`, `deck.ts`, `fonts.ts`,
`solitaire-scene.ts` — the shared board plumbing. **A per-game
`<name>.ts` or `<name>-table.ts` module should never import it directly**;
if a new game seems to need something new from the engine, that is a sign the
need belongs in one of those shared files instead.

Engine changes happen in the other repo, not here. To pick up a new engine
version: bump the tag in `package.json`, `npm install`, then verify with
`npm test` and `npm run smoke` before shipping — engine changes now reach
production solitaire, not just this repo's demo.

## Boundaries

- Don't touch `~/code/web-nert` or anything under it — different project,
  different agent, different port range (8080/8081 are nertz; this is 8083).
- `phaser-card-engine` is a separate repo with its own repo and its own
  `npm run demo`/`npm run smoke` — changes to card rendering, animation or
  the deck itself belong there, consumed here as a version bump.
- This repo is actively developed directly (not routed through
  `web-cardroom`'s agent pipeline) — that is a deliberate, explicit call, not
  an oversight.
