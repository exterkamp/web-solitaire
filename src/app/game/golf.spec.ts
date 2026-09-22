import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  COLUMN_COUNT,
  GolfState,
  apply,
  autoTarget,
  canDrop,
  cardsLeft,
  deal,
  hasWon,
  isDeadEnd,
  isNeighbour,
  legalMoves,
  liftable,
} from './golf';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

function board(partial: Partial<GolfState> = {}): GolfState {
  return {
    tableau: Array.from({ length: COLUMN_COUNT }, () => [] as Card[]),
    stock: [],
    waste: [card('7', 'spades')],
    moves: 0,
    ...partial,
  };
}

const columns = (...piles: Card[][]): Card[][] =>
  Array.from({ length: COLUMN_COUNT }, (_, i) => piles[i] ?? []);

const at = (index: number): PileRef => ({ kind: 'tableau', index });
const waste: PileRef = { kind: 'waste', index: 0 };

describe('deal', () => {
  it('lays a wall of thirty-five and keeps seventeen in the deck', () => {
    const state = deal(seeded(3));
    expect(state.tableau.map((p) => p.length)).toEqual([5, 5, 5, 5, 5, 5, 5]);
    expect(cardsLeft(state)).toBe(35);
    expect(state.stock).toHaveLength(16);
    expect(state.waste).toHaveLength(1);
    const all = [...state.tableau.flat(), ...state.stock, ...state.waste];
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });

  it('turns the whole wall face up', () => {
    const state = deal(seeded(3));
    expect(state.tableau.flat().every((c) => c.faceUp)).toBe(true);
    expect(state.stock.every((c) => !c.faceUp)).toBe(true);
  });
});

describe('what can be taken', () => {
  it('takes a card one rank either side of the one in play', () => {
    const state = board({ tableau: columns([card('6', 'hearts')], [card('8', 'clubs')], [card('9', 'clubs')]) });
    expect(canDrop(state, [card('6', 'hearts')], waste)).toBe(true);
    expect(canDrop(state, [card('8', 'clubs')], waste)).toBe(true);
    expect(canDrop(state, [card('9', 'clubs')], waste)).toBe(false);
  });

  // The rule that separates this from Tri Peaks, and the reason a king on the
  // wall is a problem rather than a card.
  it('does not go round the corner from king to ace', () => {
    expect(isNeighbour(card('A', 'spades'), card('2', 'hearts'))).toBe(true);
    expect(isNeighbour(card('K', 'spades'), card('Q', 'hearts'))).toBe(true);
    expect(isNeighbour(card('A', 'spades'), card('K', 'hearts'))).toBe(false);
  });

  it('takes only the foot of a column', () => {
    const state = board({ tableau: columns([card('2', 'clubs'), card('6', 'hearts')]) });
    expect(liftable(state, at(0), 1)?.map((c) => c.id)).toEqual(['hearts-6']);
    expect(liftable(state, at(0), 2)).toBeUndefined();
  });

  it('is never played from the deck or the card in play', () => {
    const state = board({ stock: [card('2', 'clubs', false)] });
    expect(liftable(state, waste, 1)).toBeUndefined();
    expect(liftable(state, { kind: 'stock', index: 0 }, 1)).toBeUndefined();
  });
});

describe('playing', () => {
  it('moves the card onto the one in play', () => {
    const state = board({ tableau: columns([card('2', 'clubs'), card('6', 'hearts')]) });
    const result = apply(state, { kind: 'play', from: at(0), to: waste, count: 1 })!;
    expect(result.state.waste.at(-1)?.id).toBe('hearts-6');
    expect(result.state.tableau[0]).toHaveLength(1);
  });

  it('refuses a card that does not fit, and changes nothing', () => {
    const state = board({ tableau: columns([card('10', 'hearts')]) });
    expect(apply(state, { kind: 'play', from: at(0), to: waste, count: 1 })).toBeUndefined();
    expect(state.tableau[0]).toHaveLength(1);
  });

  it('turns the next card off the deck, and has no second pass', () => {
    const state = board({ stock: [card('2', 'clubs', false)] });
    const drawn = apply(state, { kind: 'draw' })!;
    expect(drawn.state.waste.at(-1)?.id).toBe('clubs-2');
    expect(drawn.state.waste.at(-1)?.faceUp).toBe(true);
    expect(apply(drawn.state, { kind: 'draw' })).toBeUndefined();
  });
});

describe('the end of a game', () => {
  it('is won when the wall is gone', () => {
    expect(hasWon(board())).toBe(true);
    expect(hasWon(board({ tableau: columns([card('6', 'hearts')]) }))).toBe(false);
  });

  it('is over when nothing fits and the deck is spent', () => {
    const stuck = board({ tableau: columns([card('10', 'hearts')], [card('2', 'clubs')]) });
    expect(legalMoves(stuck)).toEqual([]);
    expect(isDeadEnd(stuck)).toBe(true);
  });

  it('is not over while there is a card left to turn', () => {
    const state = board({
      tableau: columns([card('10', 'hearts')]),
      stock: [card('9', 'clubs', false)],
    });
    expect(isDeadEnd(state)).toBe(false);
  });

  it('sends a tapped card to the one in play, or nowhere', () => {
    const state = board({ tableau: columns([card('6', 'hearts')], [card('10', 'clubs')]) });
    expect(autoTarget(state, at(0))).toEqual(waste);
    expect(autoTarget(state, at(1))).toBeUndefined();
  });
});
