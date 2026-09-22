import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  CELL_COUNT,
  COLUMN_COUNT,
  SeahavenState,
  apply,
  autoTarget,
  canAutoFinish,
  canDrop,
  canPlaceOnTableau,
  deal,
  freeCells,
  hasWon,
  isDeadEnd,
  legalMoves,
  liftable,
  maxRun,
} from './seahaven';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

function board(partial: Partial<SeahavenState> = {}): SeahavenState {
  return {
    cells: Array.from({ length: CELL_COUNT }, () => [] as Card[]),
    foundations: [[], [], [], []],
    tableau: Array.from({ length: COLUMN_COUNT }, () => [] as Card[]),
    moves: 0,
    ...partial,
  };
}

const columns = (...piles: Card[][]): Card[][] =>
  Array.from({ length: COLUMN_COUNT }, (_, i) => piles[i] ?? []);
const cells = (...held: (Card | undefined)[]): Card[][] =>
  Array.from({ length: CELL_COUNT }, (_, i) => (held[i] ? [held[i]!] : []));

const at = (index: number): PileRef => ({ kind: 'tableau', index });
const cell = (index: number): PileRef => ({ kind: 'cell', index });
const foundation = (index: number): PileRef => ({ kind: 'foundation', index });

describe('deal', () => {
  it('lays ten columns of five and puts the odd two in cells', () => {
    const state = deal(seeded(5));
    expect(state.tableau.map((p) => p.length)).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(state.cells.map((c) => c.length)).toEqual([1, 1, 0, 0]);
    expect(freeCells(state)).toBe(2);
    const all = [...state.tableau.flat(), ...state.cells.flat()];
    expect(all).toHaveLength(52);
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });

  it('turns everything face up', () => {
    const state = deal(seeded(5));
    expect([...state.tableau.flat(), ...state.cells.flat()].every((c) => c.faceUp)).toBe(true);
  });

  it('deals the same game twice from the same seed', () => {
    const ids = (s: SeahavenState) => s.tableau.flat().map((c) => c.id).join();
    expect(ids(deal(seeded(2)))).toBe(ids(deal(seeded(2))));
    expect(ids(deal(seeded(2)))).not.toBe(ids(deal(seeded(3))));
  });
});

describe('placement', () => {
  it('builds down in suit, not in colour', () => {
    expect(canPlaceOnTableau(card('6', 'hearts'), [card('7', 'hearts')])).toBe(true);
    expect(canPlaceOnTableau(card('6', 'spades'), [card('7', 'hearts')])).toBe(false);
    expect(canPlaceOnTableau(card('6', 'diamonds'), [card('7', 'hearts')])).toBe(false);
  });

  // The rule that makes an empty column nearly worthless, and the game hard.
  it('lets only a king into an empty column', () => {
    expect(canPlaceOnTableau(card('K', 'spades'), [])).toBe(true);
    expect(canPlaceOnTableau(card('Q', 'spades'), [])).toBe(false);
  });
});

describe('how far a run can travel', () => {
  it('is one card, plus one for each free cell', () => {
    expect(maxRun(board())).toBe(5);
    expect(maxRun(board({ cells: cells(card('2', 'clubs')) }))).toBe(4);
    expect(maxRun(board({
      cells: cells(card('2', 'clubs'), card('3', 'clubs'), card('4', 'clubs'), card('5', 'clubs')),
    }))).toBe(1);
  });

  // FreeCell doubles this for every empty column. Here an empty column takes
  // a king and nothing else, so it can never hold a card being shuffled out
  // of the way, and counting it would offer moves the game cannot make.
  it('is not doubled for an empty column', () => {
    const state = board({
      cells: cells(card('2', 'clubs')),
      tableau: columns([card('K', 'spades')]),
    });
    expect(maxRun(state)).toBe(4);
  });

  it('refuses a run longer than there is room for', () => {
    const run = [card('8', 'hearts'), card('7', 'hearts'), card('6', 'hearts')];
    const packed = board({
      cells: cells(card('2', 'clubs'), card('3', 'clubs'), card('4', 'clubs'), card('5', 'clubs')),
      tableau: columns(run, [card('9', 'hearts')]),
    });
    expect(canDrop(packed, run, at(1))).toBe(false);
    const roomy = board({ tableau: columns(run, [card('9', 'hearts')]) });
    expect(canDrop(roomy, run, at(1))).toBe(true);
  });
});

describe('lifting', () => {
  it('takes a run of one suit and nothing else', () => {
    const pile = [card('K', 'clubs'), card('8', 'hearts'), card('7', 'hearts')];
    const state = board({ tableau: columns(pile) });
    expect(liftable(state, at(0), 2)?.map((c) => c.id)).toEqual(['hearts-8', 'hearts-7']);
    expect(liftable(state, at(0), 3)).toBeUndefined();
  });

  it('gives up one card from a cell', () => {
    const state = board({ cells: cells(card('2', 'clubs')) });
    expect(liftable(state, cell(0), 1)?.map((c) => c.id)).toEqual(['clubs-2']);
    expect(liftable(state, cell(1), 1)).toBeUndefined();
  });
});

describe('moves', () => {
  it('parks a card in an empty cell and takes it back out', () => {
    const state = board({ tableau: columns([card('9', 'spades')]) });
    const parked = apply(state, { kind: 'play', from: at(0), to: cell(2), count: 1 })!;
    expect(parked.state.cells[2].map((c) => c.id)).toEqual(['spades-9']);
    expect(freeCells(parked.state)).toBe(3);
    const back = apply(parked.state, { kind: 'play', from: cell(2), to: at(1), count: 1 });
    // Nowhere to put it: an empty column wants a king.
    expect(back).toBeUndefined();
  });

  it('will not put two cards in one cell', () => {
    const state = board({
      cells: cells(card('2', 'clubs')),
      tableau: columns([card('9', 'spades')]),
    });
    expect(apply(state, { kind: 'play', from: at(0), to: cell(0), count: 1 })).toBeUndefined();
  });

  it('sends aces home and builds up in suit', () => {
    const state = board({ tableau: columns([card('A', 'spades')], [card('2', 'spades')]) });
    const first = apply(state, { kind: 'play', from: at(0), to: foundation(0), count: 1 })!;
    expect(first.state.foundations[0].map((c) => c.id)).toEqual(['spades-A']);
    const second = apply(first.state, { kind: 'play', from: at(1), to: foundation(0), count: 1 })!;
    expect(second.state.foundations[0]).toHaveLength(2);
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

  it('can be finished when everything left can go home in order', () => {
    const state = board({
      foundations: [full('spades').slice(0, 12), full('hearts').slice(0, 12),
                    full('diamonds').slice(0, 12), full('clubs').slice(0, 12)],
      tableau: columns([card('K', 'spades')], [card('K', 'hearts')], [card('K', 'diamonds')]),
      cells: cells(card('K', 'clubs')),
    });
    expect(canAutoFinish(state)).toBe(true);
  });

  it('is over when nothing can move anywhere', () => {
    // Four cells full of cards that fit nothing, and every column headed by a
    // card of the wrong suit for the others.
    const dead = board({
      cells: cells(card('5', 'clubs'), card('7', 'diamonds'), card('9', 'hearts'), card('J', 'spades')),
      tableau: columns([card('3', 'clubs')], [card('3', 'hearts')], [card('3', 'spades')],
                       [card('3', 'diamonds')], [card('5', 'hearts')], [card('5', 'spades')],
                       [card('5', 'diamonds')], [card('7', 'clubs')], [card('7', 'hearts')],
                       [card('7', 'spades')]),
    });
    expect(legalMoves(dead)).toEqual([]);
    expect(isDeadEnd(dead)).toBe(true);
  });

  it('offers a tapped card home, then a column, and a cell last', () => {
    const home = board({ tableau: columns([card('A', 'hearts')]) });
    expect(autoTarget(home, at(0))).toEqual(foundation(1));

    const column = board({ tableau: columns([card('6', 'hearts')], [card('7', 'hearts')]) });
    expect(autoTarget(column, at(0))).toEqual(at(1));

    const parked = board({ tableau: columns([card('9', 'spades'), card('6', 'hearts')]) });
    expect(autoTarget(parked, at(0))).toEqual(cell(0));
  });
});
