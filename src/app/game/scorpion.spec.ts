import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  COLUMN_COUNT,
  RESERVE,
  ScorpionState,
  apply,
  autoTarget,
  canPlaceOnTableau,
  deal,
  hasWon,
  hiddenCards,
  isDeadEnd,
  legalMoves,
  liftable,
} from './scorpion';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

function board(partial: Partial<ScorpionState> = {}): ScorpionState {
  return {
    foundations: [[], [], [], []],
    tableau: Array.from({ length: COLUMN_COUNT }, () => [] as Card[]),
    stock: [],
    moves: 0,
    ...partial,
  };
}

const columns = (...piles: Card[][]): Card[][] =>
  Array.from({ length: COLUMN_COUNT }, (_, i) => piles[i] ?? []);

const at = (index: number): PileRef => ({ kind: 'tableau', index });

const RANKS_DOWN: Rank[] = ['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2', 'A'];
const fullRun = (suit: Suit): Card[] => RANKS_DOWN.map((rank) => card(rank, suit));

describe('deal', () => {
  it('lays seven columns of seven and keeps three back', () => {
    const state = deal(seeded(11));
    expect(state.tableau.map((p) => p.length)).toEqual([7, 7, 7, 7, 7, 7, 7]);
    expect(state.stock).toHaveLength(RESERVE);
    const all = [...state.tableau.flat(), ...state.stock];
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });

  it('buries three cards in each of the first four columns and nothing elsewhere', () => {
    const state = deal(seeded(11));
    expect(state.tableau.map((p) => p.filter((c) => !c.faceUp).length)).toEqual([3, 3, 3, 3, 0, 0, 0]);
    expect(hiddenCards(state)).toBe(12);
  });

  it('deals the same game twice from the same seed', () => {
    const ids = (s: ScorpionState) => s.tableau.flat().map((c) => c.id).join();
    expect(ids(deal(seeded(1)))).toBe(ids(deal(seeded(1))));
    expect(ids(deal(seeded(1)))).not.toBe(ids(deal(seeded(2))));
  });
});

describe('placement', () => {
  // The whole difference between this and Yukon: one suit, not one colour.
  it('builds down in the same suit only', () => {
    expect(canPlaceOnTableau(card('9', 'hearts'), [card('10', 'hearts')])).toBe(true);
    expect(canPlaceOnTableau(card('9', 'diamonds'), [card('10', 'hearts')])).toBe(false);
    expect(canPlaceOnTableau(card('9', 'spades'), [card('10', 'hearts')])).toBe(false);
  });

  it('lets only a king into an empty column', () => {
    expect(canPlaceOnTableau(card('K', 'spades'), [])).toBe(true);
    expect(canPlaceOnTableau(card('Q', 'spades'), [])).toBe(false);
  });
});

describe('lifting', () => {
  it('takes a face-up card with whatever happens to be sitting on it', () => {
    const pile = [card('K', 'spades'), card('3', 'hearts'), card('7', 'clubs')];
    const state = board({ tableau: columns(pile) });
    expect(liftable(state, at(0), 3)?.map((c) => c.id)).toEqual(['spades-K', 'hearts-3', 'clubs-7']);
  });

  it('will not lift a face-down card', () => {
    const state = board({ tableau: columns([card('K', 'spades', false), card('3', 'hearts')]) });
    expect(liftable(state, at(0), 2)).toBeUndefined();
  });
});

describe('moves', () => {
  it('carries a handful by its bottom card and turns over what it leaves', () => {
    const state = board({
      tableau: columns(
        [card('2', 'clubs', false), card('9', 'hearts'), card('4', 'spades')],
        [card('10', 'hearts')],
      ),
    });
    const result = apply(state, { kind: 'play', from: at(0), to: at(1), count: 2 })!;
    expect(result.state.tableau[1].map((c) => c.id)).toEqual(['hearts-10', 'hearts-9', 'spades-4']);
    expect(result.flipped?.id).toBe('clubs-2');
  });

  it('refuses a handful whose bottom card is the wrong suit', () => {
    const state = board({
      tableau: columns([card('9', 'diamonds')], [card('10', 'hearts')]),
    });
    expect(apply(state, { kind: 'play', from: at(0), to: at(1), count: 1 })).toBeUndefined();
  });

  it('sends a finished suit home by itself', () => {
    const run = fullRun('spades');
    const state = board({
      tableau: columns([...run.slice(0, 12)], [run[12]]),
    });
    const result = apply(state, { kind: 'play', from: at(1), to: at(0), count: 1 })!;
    expect(result.state.foundations[0]).toHaveLength(13);
    expect(result.state.tableau[0]).toHaveLength(0);
  });

  it('is won when all four suits have gone home', () => {
    expect(hasWon(board({
      foundations: [fullRun('spades'), fullRun('hearts'), fullRun('diamonds'), fullRun('clubs')],
    }))).toBe(true);
  });
});

describe('the three held back', () => {
  it('go face up onto the first three columns, once', () => {
    const state = board({
      tableau: columns([card('4', 'clubs')], [card('9', 'hearts')], [card('2', 'spades')]),
      stock: [card('5', 'clubs', false), card('6', 'clubs', false), card('7', 'clubs', false)],
    });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.drawn).toHaveLength(3);
    expect(result.state.tableau.map((p) => p.length)).toEqual([2, 2, 2, 0, 0, 0, 0]);
    expect(result.state.stock).toHaveLength(0);
    expect(apply(result.state, { kind: 'draw' })).toBeUndefined();
  });
});

describe('the end of a game', () => {
  it('is over when nothing fits and the three are dealt', () => {
    const dead = board({
      tableau: columns([card('4', 'clubs')], [card('9', 'hearts')], [card('2', 'spades')]),
    });
    expect(legalMoves(dead)).toEqual([]);
    expect(isDeadEnd(dead)).toBe(true);
  });

  it('is not over while the three are still in hand', () => {
    const state = board({
      tableau: columns([card('4', 'clubs')], [card('9', 'hearts')]),
      stock: [card('5', 'clubs', false)],
    });
    expect(isDeadEnd(state)).toBe(false);
  });

  it('offers a tapped card its one home', () => {
    const state = board({
      tableau: columns([card('9', 'hearts')], [card('10', 'spades')], [card('10', 'hearts')]),
    });
    expect(autoTarget(state, at(0), 1)).toEqual(at(2));
  });
});
