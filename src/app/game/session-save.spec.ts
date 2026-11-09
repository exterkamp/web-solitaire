import { describe, expect, it } from 'vitest';
import { Move } from './piles';
import { seeded } from './random';
import { GameSession } from './session';
import { TableGame } from './table-game';
import { acesUpTable } from './acesup-table';
import { pokerSquaresTable } from './pokersquares-table';
import { cribbageSquaresTable } from './cribbagesquares-table';
import { blackjackTable } from './blackjack-table';
import { blackHoleTable } from './blackhole-table';
import { calculationTable } from './calculation-table';
import { lucieTable } from './lucie-table';
import { canfieldTable } from './canfield-table';
import { freecellTable } from './freecell-table';
import { golfTable } from './golf-table';
import { klondikeTable } from './klondike-table';
import { pyramidTable } from './pyramid-table';
import { scorpionTable } from './scorpion-table';
import { seahavenTable } from './seahaven-table';
import { spideretteTable } from './spiderette-table';
import { spiderTable } from './spider-table';
import { tripeaksTable } from './tripeaks-table';
import { yukonTable } from './yukon-table';

// A saved game goes out through JSON and comes back as a session that has to
// behave exactly like the one that was left: same state, same undo, and the
// rules still accepting moves on it. Every game, because every game's state
// is its own shape and any one of them holding a Map or a class would break
// only that one.

const TABLES: TableGame<any>[] = [
  klondikeTable(1), klondikeTable(3), freecellTable(), yukonTable(), canfieldTable(), spiderTable(1), spiderTable(4), spideretteTable(),
  scorpionTable(), seahavenTable(), calculationTable(), lucieTable(), tripeaksTable(), pyramidTable(), golfTable(), blackHoleTable(), acesUpTable(), pokerSquaresTable(), cribbageSquaresTable(), blackjackTable(() => 100),
];

/** The first thing the board would do with a tap on any pile, or a draw. */
// A move, or one of a game's own buttons for the game played with them.
type Step = Move | { kind: 'act'; action: string };

function someMove<S>(table: TableGame<S>, state: S): Step | undefined {
  const button = table.view(state).actions?.find((action) => action.enabled);
  if (button) return { kind: 'act', action: button.id };
  for (const pile of table.piles(state)) {
    const placed = pile.cards.length ? undefined : table.placeAt?.(state, pile.ref);
    if (placed) return placed;
    if (!pile.cards.length || !table.liftable(state, pile.ref, 1)) continue;
    const to = table.autoTarget(state, pile.ref, 1);
    if (to) return { kind: 'play', from: pile.ref, to, count: 1 };
  }
  const draw: Move = { kind: 'draw' };
  return table.apply(state, draw) ? draw : undefined;
}

function take<S>(session: GameSession<S>, step: Step) {
  return step.kind === 'act' ? session.act(step.action) : session.play(step);
}

function playSome<S>(session: GameSession<S>, table: TableGame<S>, count: number): number {
  let played = 0;
  for (let i = 0; i < count; i++) {
    const move = someMove(table, session.state);
    if (!move || !take(session, move)) break;
    played++;
  }
  return played;
}

describe('a saved game', () => {
  for (const table of TABLES) {
    it(`comes back the same, ${table.label}`, () => {
      let clock = 1_000_000;
      const now = () => clock;
      const session = new GameSession(table, seeded(42), now);
      const played = playSome(session, table, 12);
      expect(played).toBeGreaterThan(0);
      clock += 65_000;

      const saved = JSON.parse(JSON.stringify(session.snapshot()));
      clock += 3_600_000; // an hour on the menu, which the clock does not count
      const back = GameSession.restore(table, saved, now);

      expect(back.state).toEqual(session.state);
      expect(back.moves).toBe(session.moves);
      expect(back.canUndo).toBe(played > 0);
      expect(back.elapsed()).toBe(played > 0 ? 65 : 0);

      // And it is still a game: the same next move is legal on both, and
      // undo walks back through the same positions.
      const next = someMove(table, session.state);
      if (next) expect(take(back, next)?.state).toEqual(take(session, next)?.state);
      while (session.undo()) {
        expect(back.undo()).toBe(true);
        expect(back.state).toEqual(session.state);
      }
    });
  }

  it('keeps only so much undo', () => {
    const table = klondikeTable(1);
    const session = new GameSession(table, seeded(7));
    let draws = 0;
    while (draws < 400 && session.play({ kind: 'draw' })) draws++;
    expect(draws).toBe(400);
    expect(session.snapshot().history.length).toBeLessThan(400);
  });
});
