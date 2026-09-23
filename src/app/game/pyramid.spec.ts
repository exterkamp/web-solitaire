import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  BOARD_SIZE,
  COVERED_BY,
  DISCARD,
  POSITIONS,
  PyramidState,
  ROW_COUNT,
  apply,
  autoTarget,
  canDraw,
  canDrop,
  cardsLeft,
  deal,
  hasWon,
  isDeadEnd,
  isUncovered,
  legalMoves,
  liftable,
  pairs,
} from './pyramid';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

// Only the positions named still hold cards; everything else has been taken.
function board(cards: Record<number, Card>, rest: Partial<PyramidState> = {}): PyramidState {
  return {
    pyramid: Array.from({ length: BOARD_SIZE }, (_, i) => (cards[i] ? [cards[i]] : [])),
    stock: [],
    waste: [],
    discard: [],
    moves: 0,
    ...rest,
  };
}

const at = (index: number): PileRef => ({ kind: 'tableau', index });
const waste: PileRef = { kind: 'waste', index: 0 };

describe('the shape of the pyramid', () => {
  it('is twenty-eight cards in seven rows', () => {
    expect(BOARD_SIZE).toBe(28);
    const rows = POSITIONS.reduce<number[]>((counts, p) => {
      counts[p.row] = (counts[p.row] ?? 0) + 1;
      return counts;
    }, []);
    expect(rows).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('covers every card but the bottom row with the two beneath it', () => {
    POSITIONS.forEach((pos, i) => {
      expect(COVERED_BY[i]).toHaveLength(pos.row === ROW_COUNT - 1 ? 0 : 2);
    });
    // The apex sits on the two cards of the second row.
    expect(COVERED_BY[0]).toEqual([1, 2]);
  });
});

describe('deal', () => {
  it('lays twenty-eight face up and leaves twenty-four in the deck', () => {
    const state = deal(seeded(7));
    expect(cardsLeft(state)).toBe(28);
    expect(state.stock).toHaveLength(24);
    expect(state.waste).toHaveLength(0);
    expect(state.pyramid.flat().every((c) => c.faceUp)).toBe(true);
    const all = [...state.pyramid.flat(), ...state.stock];
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });

  it('deals the same game twice from the same seed', () => {
    const ids = (s: PyramidState) => s.pyramid.flat().map((c) => c.id).join();
    expect(ids(deal(seeded(3)))).toBe(ids(deal(seeded(3))));
    expect(ids(deal(seeded(3)))).not.toBe(ids(deal(seeded(4))));
  });
});

describe('what pairs with what', () => {
  it('adds to thirteen, counting an ace as one and a queen as twelve', () => {
    expect(pairs(card('A', 'spades'), card('Q', 'hearts'))).toBe(true);
    expect(pairs(card('6', 'spades'), card('7', 'hearts'))).toBe(true);
    expect(pairs(card('5', 'spades'), card('7', 'hearts'))).toBe(false);
  });

  it('will not take a card that is still covered', () => {
    const state = board({ 21: card('6', 'hearts'), 22: card('7', 'clubs'), 15: card('9', 'spades') });
    // Position 15 is in row five and both cards beneath it are still there.
    expect(isUncovered(state, 15)).toBe(false);
    expect(liftable(state, at(15), 1)).toBeUndefined();
    expect(isUncovered(state, 21)).toBe(true);
  });

  it('takes a pair once both cards are clear', () => {
    const state = board({ 21: card('6', 'hearts'), 22: card('7', 'clubs') });
    expect(canDrop(state, [card('6', 'hearts')], at(22))).toBe(true);
    expect(canDrop(state, [card('6', 'hearts')], at(21))).toBe(false);
  });

  it('pairs a pyramid card with the card beside the deck', () => {
    const state = board({ 21: card('6', 'hearts') }, { waste: [card('7', 'clubs')] });
    expect(canDrop(state, [card('6', 'hearts')], waste)).toBe(true);
  });

  // Two cards turned one after the other that happen to make thirteen come
  // off together. The standard rule, and without it a winnable deal can be
  // unwinnable.
  it('pairs the card beside the deck with the one underneath it', () => {
    const state = board({ 21: card('2', 'spades') }, { waste: [card('7', 'clubs'), card('6', 'hearts')] });
    expect(canDrop(state, [card('6', 'hearts')], waste)).toBe(true);
    expect(autoTarget(state, waste)).toEqual(waste);

    const result = apply(state, { kind: 'play', from: waste, to: waste, count: 1 })!;
    expect(result.state.waste).toEqual([]);
    expect(result.state.discard.map((c) => c.id).sort()).toEqual(['clubs-7', 'hearts-6']);
  });

  it('will not pair two waste cards that do not add up', () => {
    const state = board({}, { waste: [card('7', 'clubs'), card('7', 'hearts')] });
    expect(canDrop(state, [card('7', 'hearts')], waste)).toBe(false);
    expect(apply(state, { kind: 'play', from: waste, to: waste, count: 1 })).toBeUndefined();
  });

  it('has nothing to pair with when the waste holds one card', () => {
    const state = board({}, { waste: [card('6', 'hearts')] });
    expect(canDrop(state, [card('6', 'hearts')], waste)).toBe(false);
  });
});

describe('taking cards', () => {
  it('takes both cards of a pair onto the heap', () => {
    const state = board({ 21: card('6', 'hearts'), 22: card('7', 'clubs') });
    const result = apply(state, { kind: 'play', from: at(21), to: at(22), count: 1 })!;
    expect(result.moved?.map((c) => c.id).sort()).toEqual(['clubs-7', 'hearts-6']);
    expect(result.state.pyramid[21]).toEqual([]);
    expect(result.state.pyramid[22]).toEqual([]);
    expect(result.state.discard).toHaveLength(2);
  });

  it('takes a king on its own', () => {
    const state = board({ 21: card('K', 'hearts') });
    const result = apply(state, { kind: 'play', from: at(21), to: DISCARD, count: 1 })!;
    expect(result.state.discard.map((c) => c.id)).toEqual(['hearts-K']);
    expect(hasWon(result.state)).toBe(true);
  });

  it('refuses to send anything but a king to the heap alone', () => {
    const state = board({ 21: card('Q', 'hearts') });
    expect(apply(state, { kind: 'play', from: at(21), to: DISCARD, count: 1 })).toBeUndefined();
  });

  it('refuses a pair that does not add up, and changes nothing', () => {
    const state = board({ 21: card('6', 'hearts'), 22: card('8', 'clubs') });
    expect(apply(state, { kind: 'play', from: at(21), to: at(22), count: 1 })).toBeUndefined();
    expect(state.pyramid[21]).toHaveLength(1);
  });

  it('uncovers what a pair was lying on', () => {
    const state = board({ 15: card('9', 'spades'), 21: card('6', 'hearts'), 22: card('7', 'clubs') });
    const result = apply(state, { kind: 'play', from: at(21), to: at(22), count: 1 })!;
    expect(isUncovered(result.state, 15)).toBe(true);
  });
});

describe('the deck', () => {
  it('turns one card at a time', () => {
    const state = board({}, { stock: [card('2', 'clubs', false), card('3', 'clubs', false)] });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.state.waste.at(-1)?.id).toBe('clubs-3');
    expect(result.state.waste.at(-1)?.faceUp).toBe(true);
    expect(result.state.stock).toHaveLength(1);
  });

  // One pass, and the strict rule: the deck does not come round again.
  it('does not turn the waste back into a deck', () => {
    const state = board({}, { waste: [card('2', 'clubs'), card('3', 'clubs')] });
    expect(canDraw(state)).toBe(false);
    expect(apply(state, { kind: 'draw' })).toBeUndefined();
  });
});

describe('the end of a hand', () => {
  it('is won when the pyramid is bare', () => {
    expect(hasWon(board({}))).toBe(true);
    expect(hasWon(board({ 21: card('6', 'hearts') }))).toBe(false);
  });

  it('is over when nothing pairs and the deck is spent', () => {
    const stuck = board({ 21: card('6', 'hearts'), 22: card('4', 'clubs') });
    expect(legalMoves(stuck)).toEqual([]);
    expect(isDeadEnd(stuck)).toBe(true);
  });

  it('is not over while a card can still be turned', () => {
    const state = board(
      { 21: card('6', 'hearts'), 22: card('4', 'clubs') },
      { stock: [card('9', 'clubs', false)] },
    );
    expect(isDeadEnd(state)).toBe(false);
  });

  it('taps a king away, and a card that matches the one beside the deck', () => {
    const king = board({ 21: card('K', 'hearts') });
    expect(autoTarget(king, at(21))).toEqual(DISCARD);

    const matching = board({ 21: card('6', 'hearts') }, { waste: [card('7', 'clubs')] });
    expect(autoTarget(matching, at(21))).toEqual(waste);
  });

  // The searching is the game. A tap that found the partner in the pyramid
  // would be playing it for you.
  it('does not go looking through the pyramid for a partner', () => {
    const state = board({ 21: card('6', 'hearts'), 22: card('7', 'clubs') });
    expect(autoTarget(state, at(21))).toBeUndefined();
  });
});
