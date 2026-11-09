import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import { seeded } from './random';
import {
  CELL_COUNT,
  PokerSquaresState,
  TARGET,
  apply,
  canDrop,
  deal,
  emptyCells,
  handOf,
  hasWon,
  isDeadEnd,
  liftable,
  placeAt,
  score,
} from './pokersquares';

let serial = 0;
function card(rank: Rank, suit: Suit = 'spades', faceUp = true): Card {
  return { id: `${suit}-${rank}-${serial++}`, suit, rank, faceUp };
}
/** "10h", "As", "Kd": a card by its short name. */
function named(name: string): Card {
  const suits: Record<string, Suit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
  return card(name.slice(0, -1) as Rank, suits[name.slice(-1)]);
}
const hand = (...names: string[]) => handOf(names.map(named));

const waste: PileRef = { kind: 'waste', index: 0 };
const cell = (index: number): PileRef => ({ kind: 'tableau', index });

function board(partial: Partial<PokerSquaresState> = {}): PokerSquaresState {
  return {
    tableau: Array.from({ length: CELL_COUNT }, () => []),
    stock: [card('9', 'clubs', false), card('8', 'clubs', false)],
    waste: [card('7', 'hearts')],
    moves: 0,
    ...partial,
  };
}

/** A grid filled from twenty-five short names, row by row. */
function grid(names: string[]): PokerSquaresState {
  return board({ tableau: names.map((name) => [named(name)]), waste: [] });
}

describe('the hands', () => {
  it('names every hand on the table', () => {
    expect(hand('As', 'Ks', 'Qs', 'Js', '10s')).toBe('royal flush');
    expect(hand('9h', '8h', '7h', '6h', '5h')).toBe('straight flush');
    expect(hand('5d', '4d', '3d', '2d', 'Ad')).toBe('straight flush');
    expect(hand('7s', '7h', '7d', '7c', '2s')).toBe('four of a kind');
    expect(hand('7s', '7h', '7d', '2c', '2s')).toBe('full house');
    expect(hand('As', '9s', '7s', '4s', '2s')).toBe('flush');
    expect(hand('As', 'Kh', 'Qd', 'Jc', '10s')).toBe('straight');
    expect(hand('As', '2h', '3d', '4c', '5s')).toBe('straight');
    expect(hand('7s', '7h', '7d', 'Kc', '2s')).toBe('three of a kind');
    expect(hand('7s', '7h', 'Kd', 'Kc', '2s')).toBe('two pair');
    expect(hand('7s', '7h', 'Qd', 'Kc', '2s')).toBe('pair');
    expect(hand('7s', '9h', 'Qd', 'Kc', '2s')).toBe('nothing');
  });

  it('does not run a straight round the corner', () => {
    expect(hand('Qs', 'Kh', 'Ad', '2c', '3s')).toBe('nothing');
  });

  it('scores a line as it fills, but straights and flushes only once it is full', () => {
    expect(hand('7s', '7h')).toBe('pair');
    expect(hand('7s', '7h', '7d', '7c')).toBe('four of a kind');
    expect(hand('7s', '7h', 'Kd', 'Kc')).toBe('two pair');
    expect(hand('9h', '8h', '7h', '6h')).toBe('nothing');
  });
});

describe('deal', () => {
  it('turns one card and leaves the grid empty', () => {
    const state = deal(seeded(5));
    expect(state.tableau).toHaveLength(25);
    expect(emptyCells(state)).toBe(25);
    expect(state.waste).toHaveLength(1);
    expect(state.waste[0].faceUp).toBe(true);
    expect(state.stock).toHaveLength(51);
    expect(state.stock.every((c) => !c.faceUp)).toBe(true);
    expect(score(state)).toBe(0);
  });
});

describe('placing a card', () => {
  it('goes into any empty cell, and turns the next card', () => {
    const state = board();
    const next = apply(state, { kind: 'play', from: waste, to: cell(12), count: 1 })!.state;
    expect(next.tableau[12].map((c) => c.rank)).toEqual(['7']);
    expect(next.waste.map((c) => c.rank)).toEqual(['8']);
    expect(next.waste[0].faceUp).toBe(true);
    expect(next.stock).toHaveLength(1);
  });

  it('never into a cell that is taken, and never moves a card twice', () => {
    const state = board();
    state.tableau[0] = [card('K')];
    expect(canDrop(state, state.waste, cell(0))).toBe(false);
    expect(liftable(state, cell(0), 1)).toBeUndefined();
    expect(apply(state, { kind: 'play', from: cell(0), to: cell(1), count: 1 })).toBeUndefined();
    expect(apply(state, { kind: 'draw' })).toBeUndefined();
  });

  it('is what a press on an empty cell means', () => {
    const state = board();
    expect(placeAt(state, cell(3))).toEqual({ kind: 'play', from: waste, to: cell(3), count: 1 });
    state.tableau[3] = [card('2')];
    expect(placeAt(state, cell(3))).toBeUndefined();
    expect(placeAt(state, waste)).toBeUndefined();
  });

  it('turns nothing after the twenty-fifth', () => {
    const state = board();
    state.tableau = Array.from({ length: CELL_COUNT }, (_, i) => (i === 24 ? [] : [card('2', 'clubs')]));
    const next = apply(state, { kind: 'play', from: waste, to: cell(24), count: 1 })!.state;
    expect(next.waste).toHaveLength(0);
    expect(next.stock).toHaveLength(2);
    expect(emptyCells(next)).toBe(0);
  });
});

describe('the end of a hand', () => {
  // A royal flush, two straight flushes, fours and a flush across, and a
  // pair in every column - a hand built to clear two hundred.
  const winner = grid([
    'As', 'Ks', 'Qs', 'Js', '10s',
    '9h', '8h', '7h', '6h', '5h',
    '4d', '4c', '4h', '4s', '2d',
    '9d', '8d', '7d', '6d', '5d',
    '2c', '3c', '5c', '7c', '9c',
  ]);

  it('is won at two hundred', () => {
    expect(score(winner)).toBe(100 + 75 + 50 + 75 + 20 + 5 * 2);
    expect(score(winner)).toBeGreaterThanOrEqual(TARGET);
    expect(hasWon(winner)).toBe(true);
    expect(isDeadEnd(winner)).toBe(false);
  });

  it('is over short of it, with its score', () => {
    const loser = grid([
      '2s', '2h', '9d', 'Jc', 'Ks',
      '3h', '4d', '8c', 'Qs', 'Ah',
      '5d', '6c', '10s', 'Kh', '7d',
      '6s', '7h', 'Jd', '2c', '9s',
      '8h', '9h', 'Qd', 'Ac', '4s',
    ]);
    expect(score(loser)).toBeLessThan(TARGET);
    expect(hasWon(loser)).toBe(false);
    expect(isDeadEnd(loser)).toBe(true);
  });

  it('is neither while there is a cell left to fill', () => {
    const state = board();
    expect(hasWon(state)).toBe(false);
    expect(isDeadEnd(state)).toBe(false);
  });
});
