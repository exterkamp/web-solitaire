import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import { seeded } from './random';
import {
  CELL_COUNT,
  CribbageSquaresState,
  apply,
  canDrop,
  deal,
  handScore,
  hasWon,
  isDeadEnd,
  liftable,
  placeAt,
  score,
  starterOf,
  touches,
} from './cribbagesquares';

let serial = 0;
function named(name: string): Card {
  const suits: Record<string, Suit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
  const suit = suits[name.slice(-1)];
  return { id: `${suit}-${name.slice(0, -1)}-${serial++}`, suit, rank: name.slice(0, -1) as Rank, faceUp: true };
}
const cards = (...names: string[]) => names.map(named);
const waste: PileRef = { kind: 'waste', index: 0 };
const cell = (index: number): PileRef => ({ kind: 'tableau', index });

function board(partial: Partial<CribbageSquaresState> = {}): CribbageSquaresState {
  return {
    tableau: Array.from({ length: CELL_COUNT }, () => []),
    stock: cards('9c', '8c'),
    waste: cards('7h'),
    moves: 0,
    ...partial,
  };
}

describe('the count', () => {
  it('is twenty-nine for the best hand there is', () => {
    expect(handScore(cards('5h', '5d', '5c', 'Js'), named('5s'))).toBe(29);
  });

  it('counts fifteens, pairs and runs, double runs twice', () => {
    // 3 3 4 5 with a 10: two fifteens (5+10, 3+3+4+5), a pair, and the run
    // of three made two ways.
    expect(handScore(cards('3h', '3d', '4c', '5s'), named('10h'))).toBe(4 + 2 + 6);
    expect(handScore(cards('6h', '7d', '8c', '9s'))).toBe(4 + 4);
    expect(handScore(cards('Kh', 'Qd', '2c', '4s'))).toBe(0);
  });

  it('takes a flush only from the hand\'s own four cards', () => {
    // No fifteens, pairs or runs in these: only the flush counts.
    expect(handScore(cards('2h', '4h', '6h', 'Kh'), named('Qh'))).toBe(5);
    expect(handScore(cards('2h', '4h', '6h', 'Kh'), named('Qc'))).toBe(4);
    expect(handScore(cards('2h', '4h', '6h'), named('Qh'))).toBe(0);
  });

  it('gives his nobs for the jack of the starter\'s suit', () => {
    expect(handScore(cards('Jh', '2c', '7d', '9s'), named('Kh'))).toBe(1);
    expect(handScore(cards('Jh', '2c', '7d', '9s'), named('Kc'))).toBe(0);
  });
});

describe('deal', () => {
  it('turns one card and leaves the grid empty', () => {
    const state = deal(seeded(4));
    expect(state.tableau).toHaveLength(16);
    expect(state.waste).toHaveLength(1);
    expect(state.stock).toHaveLength(51);
  });
});

describe('placing a card', () => {
  it('may go anywhere first, and after that only beside a card already down', () => {
    const state = board();
    expect(touches(state, 15)).toBe(true);
    state.tableau[5] = cards('Ks');
    // Corners and edges of cell 5 (row 1, column 1).
    for (const i of [0, 1, 2, 4, 6, 8, 9, 10]) expect(canDrop(state, state.waste, cell(i))).toBe(true);
    for (const i of [3, 7, 11, 12, 13, 14, 15]) expect(canDrop(state, state.waste, cell(i))).toBe(false);
    expect(placeAt(state, cell(15))).toBeUndefined();
    expect(placeAt(state, cell(10))).toBeDefined();
  });

  it('turns the next card, and never moves one twice', () => {
    const state = board();
    const next = apply(state, { kind: 'play', from: waste, to: cell(0), count: 1 })!.state;
    expect(next.waste.map((c) => c.rank)).toEqual(['8']);
    expect(liftable(next, cell(0), 1)).toBeUndefined();
  });
});

describe('the end of a hand', () => {
  const full = (names: string[], starter: string): CribbageSquaresState =>
    board({ tableau: names.map((n) => [named(n)]), waste: [named(starter)] });

  it('turns the starter after the sixteenth card and counts it in every hand', () => {
    const state = board();
    state.tableau = Array.from({ length: CELL_COUNT }, (_, i) => (i === 15 ? [] : [named('Kc')]));
    const next = apply(state, { kind: 'play', from: waste, to: cell(15), count: 1 })!.state;
    expect(starterOf(next)?.rank).toBe('8');
    expect(liftable(next, waste, 1)).toBeUndefined();
  });

  it('is won at sixty-one', () => {
    // Fives and tens everywhere: every row and column full of fifteens.
    const state = full([
      '5h', 'Kd', '5c', 'Qs',
      'Jh', '5d', 'Kc', '5s',
      '5h', 'Qd', '5c', 'Js',
      'Kh', '5d', 'Qc', '5s',
    ], '10h');
    expect(score(state)).toBeGreaterThanOrEqual(61);
    expect(hasWon(state)).toBe(true);
  });

  it('adds his heels once for a jack turned as the starter', () => {
    const names = [
      'Ah', '3d', '7c', '9s',
      '2h', '4d', '8c', 'Ks',
      'Ah', '3d', '7c', '9s',
      '2h', '4d', '8c', 'Ks',
    ];
    const withQueen = score(full(names, 'Qc'));
    expect(score(full(names, 'Jc'))).toBe(withQueen + 2);
  });

  it('is over short of it', () => {
    const state = full([
      'Ah', '3d', '7c', '9s',
      '2h', '4d', '8c', 'Ks',
      'Qh', '6d', 'Ac', '8s',
      '2c', 'Kd', '9h', '4s',
    ], 'Qc');
    expect(score(state)).toBeLessThan(61);
    expect(isDeadEnd(state)).toBe(true);
    expect(hasWon(state)).toBe(false);
  });
});
