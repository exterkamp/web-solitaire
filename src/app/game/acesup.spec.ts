import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  AcesUpState,
  COLUMN_COUNT,
  DISCARD,
  apply,
  autoTarget,
  beaten,
  canAutoFinish,
  canDrop,
  cardsLeft,
  deal,
  hasWon,
  isDeadEnd,
  legalMoves,
  liftable,
} from './acesup';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

function board(partial: Partial<AcesUpState> = {}): AcesUpState {
  return {
    discard: [],
    tableau: Array.from({ length: COLUMN_COUNT }, () => [] as Card[]),
    stock: [],
    moves: 0,
    ...partial,
  };
}

const columns = (...piles: Card[][]): Card[][] =>
  Array.from({ length: COLUMN_COUNT }, (_, i) => piles[i] ?? []);

const at = (index: number): PileRef => ({ kind: 'tableau', index });

describe('deal', () => {
  it('turns four cards and keeps the rest', () => {
    const state = deal(seeded(4));
    expect(state.tableau.map((p) => p.length)).toEqual([1, 1, 1, 1]);
    expect(state.stock).toHaveLength(48);
    expect(state.tableau.flat().every((c) => c.faceUp)).toBe(true);
    const all = [...state.tableau.flat(), ...state.stock];
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });
});

describe('what beats what', () => {
  it('throws away the lower card of two in the same suit', () => {
    const state = board({ tableau: columns([card('4', 'hearts')], [card('9', 'hearts')]) });
    expect(beaten(state, card('4', 'hearts'), 0)).toBe(true);
    expect(beaten(state, card('9', 'hearts'), 1)).toBe(false);
  });

  it('leaves two cards of different suits alone', () => {
    const state = board({ tableau: columns([card('4', 'hearts')], [card('9', 'spades')]) });
    expect(beaten(state, card('4', 'hearts'), 0)).toBe(false);
  });

  // Where the game gets its name: an ace is the highest card, so no ace can
  // ever be thrown away.
  it('counts an ace above a king', () => {
    const state = board({ tableau: columns([card('K', 'clubs')], [card('A', 'clubs')]) });
    expect(beaten(state, card('K', 'clubs'), 0)).toBe(true);
    expect(beaten(state, card('A', 'clubs'), 1)).toBe(false);
  });

  it('only ever looks at the card on top of a column', () => {
    const state = board({
      tableau: columns([card('4', 'hearts')], [card('9', 'hearts'), card('3', 'spades')]),
    });
    expect(beaten(state, card('4', 'hearts'), 0)).toBe(false);
  });
});

describe('moves', () => {
  it('discards a beaten card', () => {
    const state = board({ tableau: columns([card('4', 'hearts')], [card('9', 'hearts')]) });
    const result = apply(state, { kind: 'play', from: at(0), to: DISCARD, count: 1 })!;
    expect(result.state.discard.map((c) => c.id)).toEqual(['hearts-4']);
    expect(result.state.tableau[0]).toHaveLength(0);
  });

  it('refuses to discard a card nothing beats', () => {
    const state = board({ tableau: columns([card('9', 'hearts')], [card('4', 'hearts')]) });
    expect(apply(state, { kind: 'play', from: at(0), to: DISCARD, count: 1 })).toBeUndefined();
  });

  it('moves a card into an empty column and nowhere else', () => {
    const state = board({
      tableau: columns([card('2', 'clubs'), card('9', 'hearts')], [], [card('5', 'spades')]),
    });
    expect(canDrop(state, [card('9', 'hearts')], at(1))).toBe(true);
    expect(canDrop(state, [card('9', 'hearts')], at(2))).toBe(false);
    const result = apply(state, { kind: 'play', from: at(0), to: at(1), count: 1 })!;
    expect(result.state.tableau[1].map((c) => c.id)).toEqual(['hearts-9']);
    expect(result.state.tableau[0].map((c) => c.id)).toEqual(['clubs-2']);
  });

  it('takes only the top card of a column', () => {
    const state = board({ tableau: columns([card('2', 'clubs'), card('9', 'hearts')]) });
    expect(liftable(state, at(0), 1)?.map((c) => c.id)).toEqual(['hearts-9']);
    expect(liftable(state, at(0), 2)).toBeUndefined();
  });
});

describe('dealing again', () => {
  it('puts a card on every column, empty ones included', () => {
    const state = board({
      tableau: columns([card('2', 'clubs')], [], [], []),
      stock: Array.from({ length: 4 }, (_, i) => card(String(i + 2) as Rank, 'spades', false)),
    });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.state.tableau.map((p) => p.length)).toEqual([2, 1, 1, 1]);
    expect(result.state.tableau.flat().every((c) => c.faceUp)).toBe(true);
  });

  it('refuses when the deck is gone', () => {
    expect(apply(board(), { kind: 'draw' })).toBeUndefined();
  });
});

describe('the end of a game', () => {
  const aces = () => columns([card('A', 'spades')], [card('A', 'hearts')],
                             [card('A', 'diamonds')], [card('A', 'clubs')]);

  it('is won when the deck is gone and four aces are left', () => {
    expect(hasWon(board({ tableau: aces() }))).toBe(true);
    expect(cardsLeft(board({ tableau: aces() }))).toBe(4);
  });

  it('is not won while the deck still holds a card', () => {
    expect(hasWon(board({ tableau: aces(), stock: [card('2', 'clubs', false)] }))).toBe(false);
  });

  it('is over when the deck is gone and nothing beats anything', () => {
    const dead = board({
      tableau: columns([card('A', 'spades')], [card('A', 'hearts')],
                       [card('A', 'diamonds')], [card('K', 'clubs')]),
    });
    expect(legalMoves(dead)).toEqual([]);
    expect(isDeadEnd(dead)).toBe(true);
  });

  it('plays out a finish that is only throwing cards away', () => {
    // The two of hearts is showing and the ace of hearts is showing in
    // another column, so it goes - and four aces are what is left.
    const state = board({
      tableau: columns([card('A', 'spades'), card('2', 'hearts')], [card('A', 'hearts')],
                       [card('A', 'diamonds')], [card('A', 'clubs')]),
    });
    expect(canAutoFinish(state)).toBe(true);
  });

  // A card is beaten by what is *showing* elsewhere, never by what is buried
  // underneath it - including in its own column.
  it('does not let a card be beaten by the card it is sitting on', () => {
    const state = board({
      tableau: columns([card('A', 'spades'), card('2', 'spades')], [card('A', 'hearts')],
                       [card('A', 'diamonds')], [card('A', 'clubs')]),
    });
    expect(beaten(state, card('2', 'spades'), 0)).toBe(false);
    expect(canAutoFinish(state)).toBe(false);
  });

  it('offers a tapped card the discard, then an empty column', () => {
    const beatable = board({ tableau: columns([card('4', 'hearts')], [card('9', 'hearts')]) });
    expect(autoTarget(beatable, at(0))).toEqual(DISCARD);

    const buried = board({ tableau: columns([card('2', 'clubs'), card('9', 'spades')], []) });
    expect(autoTarget(buried, at(0))).toEqual(at(1));

    const alone = board({ tableau: columns([card('9', 'spades')], []) });
    expect(autoTarget(alone, at(0))).toBeUndefined();
  });
});
