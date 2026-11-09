import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import { seeded } from './random';
import {
  COLUMN_COUNT,
  FOUNDATION_COUNT,
  SpiderState,
  SuitCount,
  apply,
  autoTarget,
  canDeal,
  deal,
  hasWon,
  hiddenCards,
  isDeadEnd,
  liftable,
  spiderDeck,
} from './spider';

let serial = 0;
function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}-t${serial++}`, suit, rank, faceUp };
}

function board(partial: Partial<SpiderState> = {}): SpiderState {
  return {
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => [] as Card[]),
    tableau: Array.from({ length: COLUMN_COUNT }, () => [card('K', 'clubs')]),
    stock: [],
    moves: 0,
    suits: 1,
    ...partial,
  };
}

const at = (index: number): PileRef => ({ kind: 'tableau', index });
const RANKS_DOWN: Rank[] = ['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2', 'A'];
const fullRun = (suit: Suit): Card[] => RANKS_DOWN.map((rank) => card(rank, suit));

describe('the deck', () => {
  it.each([1, 2, 4] as SuitCount[])('is a hundred and four distinct cards in %i suit(s)', (suits) => {
    const deck = spiderDeck(suits);
    expect(deck).toHaveLength(104);
    expect(new Set(deck.map((c) => c.id)).size).toBe(104);
    expect(new Set(deck.map((c) => c.suit)).size).toBe(suits);
    // Every suit in it the same number of times: eight sets, shared out.
    for (const suit of new Set(deck.map((c) => c.suit))) {
      expect(deck.filter((c) => c.suit === suit)).toHaveLength(104 / suits);
    }
  });

  it('two suits are spades and hearts', () => {
    expect([...new Set(spiderDeck(2).map((c) => c.suit))].sort()).toEqual(['hearts', 'spades']);
  });
});

describe('deal', () => {
  it('lays fifty-four in ten columns and keeps fifty to deal', () => {
    const state = deal(2, seeded(7));
    expect(state.tableau.map((pile) => pile.length)).toEqual([6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
    expect(state.stock).toHaveLength(50);
    expect(state.foundations).toHaveLength(8);
    expect(state.suits).toBe(2);
  });

  it('turns up the last card of each column and nothing else', () => {
    const state = deal(4, seeded(7));
    state.tableau.forEach((pile) =>
      pile.forEach((c, i) => expect(c.faceUp).toBe(i === pile.length - 1)),
    );
    expect(hiddenCards(state)).toBe(44);
    expect(state.stock.every((c) => !c.faceUp)).toBe(true);
  });

  it('is the same deal from the same seed', () => {
    expect(deal(4, seeded(3))).toEqual(deal(4, seeded(3)));
  });
});

describe('moves', () => {
  it('carries a one-suit run and not a mixed one', () => {
    const state = board();
    state.tableau[0] = [card('9', 'spades'), card('8', 'spades'), card('7', 'hearts')];
    expect(liftable(state, at(0), 2)).toBeUndefined();
    expect(liftable(state, at(0), 1)).toHaveLength(1);
    state.tableau[0][2] = card('7', 'spades');
    expect(liftable(state, at(0), 3)).toHaveLength(3);
  });

  it('builds down by rank in any suit, and keeps the suit count through a move', () => {
    const state = board({ suits: 4 });
    state.tableau[0] = [card('10', 'clubs')];
    state.tableau[1] = [card('9', 'hearts')];
    const result = apply(state, { kind: 'play', from: at(1), to: at(0), count: 1 });
    expect(result?.state.tableau[0].map((c) => c.rank)).toEqual(['10', '9']);
    expect(result?.state.suits).toBe(4);
    expect(apply(state, { kind: 'play', from: at(0), to: at(1), count: 1 })).toBeUndefined();
  });

  it('prefers a same-suit home for a tapped card', () => {
    const state = board();
    state.tableau[0] = [card('10', 'clubs')];
    state.tableau[1] = [card('10', 'hearts')];
    state.tableau[2] = [card('9', 'hearts')];
    expect(autoTarget(state, at(2))).toEqual(at(1));
  });
});

describe('dealing a row', () => {
  it('puts one card on each of the ten columns', () => {
    const state = deal(1, seeded(9));
    const result = apply(state, { kind: 'draw' })!;
    expect(result.state.stock).toHaveLength(40);
    expect(result.drawn).toHaveLength(10);
    result.state.tableau.forEach((pile, i) => {
      expect(pile).toHaveLength(state.tableau[i].length + 1);
      expect(pile[pile.length - 1].faceUp).toBe(true);
    });
  });

  it('will not deal over an empty column', () => {
    const state = board({ stock: Array.from({ length: 10 }, () => card('5', 'spades', false)) });
    expect(canDeal(state)).toBe(true);
    state.tableau[3] = [];
    expect(canDeal(state)).toBe(false);
    expect(apply(state, { kind: 'draw' })).toBeUndefined();
  });
});

describe('finishing suits', () => {
  it('sends a finished suit to the first free foundation, even a second of the same suit', () => {
    const state = board();
    state.foundations[0] = fullRun('spades');
    state.tableau[0] = [card('5', 'diamonds', false), ...fullRun('spades').slice(0, 12)];
    state.tableau[1] = [card('A', 'spades')];
    const result = apply(state, { kind: 'play', from: at(1), to: at(0), count: 1 })!;
    expect(result.state.foundations[1]).toHaveLength(13);
    expect(result.state.foundations[1][0].suit).toBe('spades');
    // And turns over what it was sitting on.
    expect(result.state.tableau[0]).toHaveLength(1);
    expect(result.state.tableau[0][0].faceUp).toBe(true);
  });

  it('is won with eight suits home', () => {
    const state = board({
      foundations: Array.from({ length: 8 }, () => fullRun('spades')),
      tableau: Array.from({ length: COLUMN_COUNT }, () => []),
    });
    expect(hasWon(state)).toBe(true);
    expect(isDeadEnd(state)).toBe(false);
    state.foundations[7] = [];
    expect(hasWon(state)).toBe(false);
  });

  it('is stuck with no deck and nothing to move', () => {
    const state = board({ tableau: Array.from({ length: COLUMN_COUNT }, () => [card('K', 'clubs')]) });
    expect(isDeadEnd(state)).toBe(true);
  });
});
