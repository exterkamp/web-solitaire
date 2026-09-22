import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  CELL_COUNT,
  COLUMN_COUNT,
  FreeCellState,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDrop,
  canPlaceOnTableau,
  deal,
  emptyColumns,
  freeCells,
  hasWon,
  isDeadEnd,
  legalMoves,
  liftable,
  maxRun,
} from './freecell';
import { seeded } from './random';

function card(rank: Rank, suit: Suit): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp: true };
}

// A board dealt by hand. Everything in FreeCell is face up, so unlike
// Klondike's there is nothing hidden to arrange here - a rigged position is
// just the cards where you want them.
function board(partial: Partial<FreeCellState> = {}): FreeCellState {
  return {
    cells: Array.from({ length: CELL_COUNT }, () => [] as Card[]),
    foundations: [[], [], [], []],
    tableau: Array.from({ length: COLUMN_COUNT }, () => [] as Card[]),
    moves: 0,
    ...partial,
  };
}

const tableau = (index: number): PileRef => ({ kind: 'tableau', index });
const cell = (index: number): PileRef => ({ kind: 'cell', index });
const foundation = (index: number): PileRef => ({ kind: 'foundation', index });

describe('deal', () => {
  it('puts every card on the table, face up, in eight columns', () => {
    const state = deal(seeded(5));
    expect(state.tableau).toHaveLength(8);
    expect(state.tableau.flat()).toHaveLength(52);
    expect(state.tableau.flat().every((c) => c.faceUp)).toBe(true);
    expect(new Set(state.tableau.flat().map((c) => c.id)).size).toBe(52);
  });

  it('deals four columns of seven and four of six', () => {
    expect(deal(seeded(5)).tableau.map((p) => p.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
  });

  it('starts with four empty cells and nothing home', () => {
    const state = deal(seeded(5));
    expect(freeCells(state)).toBe(4);
    expect(emptyColumns(state)).toBe(0);
    expect(state.foundations.flat()).toEqual([]);
  });

  it('deals the same game twice from the same seed', () => {
    const ids = (s: FreeCellState) => s.tableau.flat().map((c) => c.id).join();
    expect(ids(deal(seeded(8)))).toBe(ids(deal(seeded(8))));
    expect(ids(deal(seeded(8)))).not.toBe(ids(deal(seeded(9))));
  });
});

describe('placement', () => {
  it('lets an empty column take anything at all', () => {
    // The rule Klondike does not have, and the reason an empty column here is
    // worth more than a free cell.
    expect(canPlaceOnTableau(card('7', 'hearts'), [])).toBe(true);
    expect(canPlaceOnTableau(card('K', 'spades'), [])).toBe(true);
  });

  it('builds down in alternating colours otherwise', () => {
    expect(canPlaceOnTableau(card('6', 'hearts'), [card('7', 'spades')])).toBe(true);
    expect(canPlaceOnTableau(card('6', 'diamonds'), [card('7', 'hearts')])).toBe(false);
    expect(canPlaceOnTableau(card('5', 'hearts'), [card('7', 'spades')])).toBe(false);
  });

  it('takes one card into an empty cell and nothing into a full one', () => {
    const state = board({ cells: [[card('K', 'spades')], [], [], []] });
    expect(canDrop(state, [card('2', 'hearts')], cell(0))).toBe(false);
    expect(canDrop(state, [card('2', 'hearts')], cell(1))).toBe(true);
    expect(canDrop(state, [card('3', 'hearts'), card('2', 'spades')], cell(1))).toBe(false);
  });

  it('sends a card only to its own suit’s foundation', () => {
    const state = board();
    expect(canDrop(state, [card('A', 'hearts')], foundation(1))).toBe(true);
    expect(canDrop(state, [card('A', 'hearts')], foundation(2))).toBe(false);
  });
});

describe('how much can move at once', () => {
  it('is one card with nothing free', () => {
    const full = board({
      cells: [[card('K', 'spades')], [card('K', 'hearts')], [card('K', 'diamonds')], [card('K', 'clubs')]],
      tableau: Array.from({ length: COLUMN_COUNT }, () => [card('9', 'hearts')]),
    });
    expect(maxRun(full)).toBe(1);
  });

  it('is one more than the free cells', () => {
    const state = board({
      cells: [[card('K', 'spades')], [], [], []],
      tableau: Array.from({ length: COLUMN_COUNT }, () => [card('9', 'hearts')]),
    });
    expect(maxRun(state)).toBe(4);
  });

  it('doubles for every empty column', () => {
    const state = board({
      cells: [[], [], [], []],
      // Six columns holding something, two standing empty.
      tableau: [
        [card('9', 'hearts')], [card('9', 'spades')], [card('9', 'diamonds')],
        [card('9', 'clubs')], [card('8', 'hearts')], [card('8', 'spades')], [], [],
      ],
    });
    expect(maxRun(state)).toBe(20);
    // Except the one being moved into, which cannot also be staged through.
    expect(maxRun(state, true)).toBe(10);
  });

  it('refuses a run longer than there is room to shuffle', () => {
    const run = [card('5', 'spades'), card('4', 'hearts'), card('3', 'spades')];
    const roomy = board({
      cells: [[], [], [], []],
      tableau: [run, [card('6', 'hearts')], [], [], [], [], [], []],
    });
    expect(canDrop(roomy, run, tableau(1))).toBe(true);

    const cramped = board({
      cells: [[card('K', 'spades')], [card('K', 'hearts')], [card('K', 'diamonds')], []],
      tableau: [run, [card('6', 'hearts')], [card('2', 'clubs')], [card('2', 'diamonds')],
                [card('2', 'hearts')], [card('2', 'spades')], [card('3', 'clubs')], [card('3', 'diamonds')]],
    });
    // One free cell and no empty columns: two cards at a time, not three.
    expect(maxRun(cramped)).toBe(2);
    expect(canDrop(cramped, run, tableau(1))).toBe(false);
    expect(canDrop(cramped, run.slice(1), tableau(1))).toBe(false);
  });
});

describe('lifting', () => {
  it('takes a run off a column and one card off a cell', () => {
    const state = board({
      cells: [[card('K', 'spades')], [], [], []],
      tableau: [[card('9', 'clubs'), card('8', 'hearts'), card('7', 'spades')], [], [], [], [], [], [], []],
    });
    expect(liftable(state, tableau(0), 2)?.map((c) => c.id)).toEqual(['hearts-8', 'spades-7']);
    expect(liftable(state, cell(0), 1)?.map((c) => c.id)).toEqual(['spades-K']);
    expect(liftable(state, cell(0), 2)).toBeUndefined();
  });

  it('refuses a stack that is not a run', () => {
    const state = board({
      tableau: [[card('9', 'clubs'), card('4', 'hearts')], [], [], [], [], [], [], []],
    });
    expect(liftable(state, tableau(0), 2)).toBeUndefined();
    expect(liftable(state, tableau(0), 1)?.map((c) => c.id)).toEqual(['hearts-4']);
  });
});

describe('moves', () => {
  it('moves a card into a cell and back out again', () => {
    const start = board({ tableau: [[card('K', 'spades')], [], [], [], [], [], [], []] });
    const parked = apply(start, { kind: 'play', from: tableau(0), to: cell(0), count: 1 })!;
    expect(parked.state.cells[0].map((c) => c.id)).toEqual(['spades-K']);
    expect(parked.state.tableau[0]).toEqual([]);
    expect(parked.state.moves).toBe(1);

    const back = apply(parked.state, { kind: 'play', from: cell(0), to: tableau(1), count: 1 })!;
    expect(back.state.cells[0]).toEqual([]);
    expect(back.state.tableau[1].map((c) => c.id)).toEqual(['spades-K']);
  });

  it('changes nothing when it is refused', () => {
    const state = board({
      tableau: [[card('9', 'hearts')], [card('7', 'spades')], [], [], [], [], [], []],
    });
    expect(apply(state, { kind: 'play', from: tableau(0), to: tableau(1), count: 1 })).toBeUndefined();
    expect(state.tableau[0]).toHaveLength(1);
  });
});

describe('tapping a card', () => {
  it('sends it home when it can go home', () => {
    const state = board({ tableau: [[card('A', 'hearts')], [], [], [], [], [], [], []] });
    expect(autoTarget(state, tableau(0))).toEqual(foundation(1));
  });

  it('prefers a column to a cell, because a cell costs something', () => {
    const state = board({
      tableau: [[card('6', 'hearts')], [card('7', 'spades')], [], [], [], [], [], []],
    });
    expect(autoTarget(state, tableau(0))).toEqual(tableau(1));
  });

  it('uses a cell when the table will not take the card', () => {
    const state = board({
      tableau: [[card('6', 'hearts')], [card('9', 'spades')], [card('9', 'clubs')],
                [card('9', 'diamonds')], [card('10', 'spades')], [card('10', 'clubs')],
                [card('10', 'hearts')], [card('10', 'diamonds')]],
    });
    expect(autoTarget(state, tableau(0))).toEqual(cell(0));
  });

  it('will not shuffle a whole column into an empty one', () => {
    const state = board({ tableau: [[card('K', 'spades')], [], [], [], [], [], [], []] });
    expect(autoTarget(state, tableau(0))).toEqual(cell(0));
  });
});

describe('the end of a game', () => {
  const full = (suit: Suit): Card[] =>
    (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as Rank[]).map((r) =>
      card(r, suit),
    );

  it('is won when all four foundations are complete', () => {
    expect(hasWon(board({
      foundations: [full('spades'), full('hearts'), full('diamonds'), full('clubs')],
    }))).toBe(true);
  });

  it('can be finished when every card left can be sent home in order', () => {
    const state = board({
      foundations: [full('spades').slice(0, 12), full('hearts').slice(0, 12),
                    full('diamonds').slice(0, 12), full('clubs').slice(0, 12)],
      tableau: [[card('K', 'spades')], [card('K', 'hearts')], [card('K', 'diamonds')],
                [card('K', 'clubs')], [], [], [], []],
    });
    expect(canAutoFinish(state)).toBe(true);
    expect(autoFinishMove(state)).toEqual({ kind: 'play', from: tableau(0), to: foundation(0), count: 1 });
  });

  it('cannot be finished while a card is buried under a lower one', () => {
    // The two of spades is under the three, so the three cannot go home
    // first and no amount of sending cards home unpicks it.
    const state = board({
      foundations: [[card('A', 'spades')], [], [], []],
      tableau: [[card('3', 'spades'), card('2', 'spades')].reverse(), [], [], [], [], [], [], []],
    });
    expect(canAutoFinish(state)).toBe(false);
  });

  it('is over when nothing can move at all', () => {
    // Every cell full, every column headed by a card that fits nowhere, and
    // no empty column to escape into.
    const stuck = board({
      cells: [[card('K', 'spades')], [card('K', 'hearts')], [card('K', 'diamonds')], [card('K', 'clubs')]],
      tableau: [
        [card('5', 'spades'), card('9', 'spades')],
        [card('5', 'hearts'), card('9', 'clubs')],
        [card('5', 'diamonds'), card('7', 'spades')],
        [card('5', 'clubs'), card('7', 'clubs')],
        [card('6', 'spades'), card('J', 'spades')],
        [card('6', 'hearts'), card('J', 'clubs')],
        [card('6', 'diamonds'), card('Q', 'spades')],
        [card('6', 'clubs'), card('Q', 'clubs')],
      ],
    });
    expect(legalMoves(stuck)).toEqual([]);
    expect(isDeadEnd(stuck)).toBe(true);
  });

  it('is not over while a card can still go into a cell', () => {
    const state = board({
      cells: [[card('K', 'spades')], [card('K', 'hearts')], [card('K', 'diamonds')], []],
      tableau: [[card('9', 'spades')], [card('9', 'clubs')], [card('7', 'spades')],
                [card('7', 'clubs')], [card('J', 'spades')], [card('J', 'clubs')],
                [card('Q', 'spades')], [card('Q', 'clubs')]],
    });
    expect(isDeadEnd(state)).toBe(false);
  });
});
