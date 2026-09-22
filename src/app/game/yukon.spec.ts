import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  COLUMN_COUNT,
  YukonState,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDrop,
  canPlaceOnTableau,
  deal,
  hasWon,
  hiddenCards,
  isDeadEnd,
  legalMoves,
  liftable,
} from './yukon';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

function board(partial: Partial<YukonState> = {}): YukonState {
  return {
    foundations: [[], [], [], []],
    tableau: Array.from({ length: COLUMN_COUNT }, () => [] as Card[]),
    moves: 0,
    ...partial,
  };
}

const tableau = (index: number): PileRef => ({ kind: 'tableau', index });
const foundation = (index: number): PileRef => ({ kind: 'foundation', index });

describe('deal', () => {
  it('lays one card, then columns of five face up over a growing burial', () => {
    const state = deal(seeded(3));
    expect(state.tableau.map((p) => p.length)).toEqual([1, 6, 7, 8, 9, 10, 11]);
    expect(state.tableau.map((p) => p.filter((c) => !c.faceUp).length)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('puts every card on the table and none in a deck', () => {
    const state = deal(seeded(3));
    const all = state.tableau.flat();
    expect(all).toHaveLength(52);
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
    expect(hiddenCards(state)).toBe(21);
  });

  it('deals the same game twice from the same seed', () => {
    const ids = (s: YukonState) => s.tableau.flat().map((c) => c.id).join();
    expect(ids(deal(seeded(6)))).toBe(ids(deal(seeded(6))));
    expect(ids(deal(seeded(6)))).not.toBe(ids(deal(seeded(7))));
  });
});

describe('lifting', () => {
  // The rule the whole game turns on, and the one thing that makes this not
  // Klondike: the cards on top of the one you grab can be in any order at all.
  it('takes a face-up card with whatever happens to be sitting on it', () => {
    const pile = [card('K', 'spades'), card('3', 'hearts'), card('7', 'clubs')];
    const state = board({ tableau: [pile, [], [], [], [], [], []] });
    expect(liftable(state, tableau(0), 3)?.map((c) => c.id)).toEqual([
      'spades-K', 'hearts-3', 'clubs-7',
    ]);
    expect(liftable(state, tableau(0), 2)?.map((c) => c.id)).toEqual(['hearts-3', 'clubs-7']);
  });

  it('will not lift a face-down card', () => {
    const state = board({
      tableau: [[card('K', 'spades', false), card('3', 'hearts')], [], [], [], [], [], []],
    });
    expect(liftable(state, tableau(0), 2)).toBeUndefined();
    expect(liftable(state, tableau(0), 1)?.map((c) => c.id)).toEqual(['hearts-3']);
  });

  it('gives up one card from a foundation and no more', () => {
    const state = board({ foundations: [[card('A', 'spades'), card('2', 'spades')], [], [], []] });
    expect(liftable(state, foundation(0), 1)?.map((c) => c.id)).toEqual(['spades-2']);
    expect(liftable(state, foundation(0), 2)).toBeUndefined();
  });
});

describe('placement', () => {
  it('lets only a king into an empty column', () => {
    expect(canPlaceOnTableau(card('K', 'spades'), [])).toBe(true);
    expect(canPlaceOnTableau(card('Q', 'spades'), [])).toBe(false);
  });

  it('builds down in alternating colours', () => {
    expect(canPlaceOnTableau(card('6', 'hearts'), [card('7', 'spades')])).toBe(true);
    expect(canPlaceOnTableau(card('6', 'diamonds'), [card('7', 'hearts')])).toBe(false);
  });

  it('judges a handful by its bottom card only', () => {
    // A seven of clubs riding on a six of hearts goes wherever the six goes.
    const carried = [card('6', 'hearts'), card('7', 'clubs')];
    const state = board({ tableau: [carried, [card('7', 'spades')], [], [], [], [], []] });
    expect(canDrop(state, carried, tableau(1))).toBe(true);
  });
});

describe('moves', () => {
  it('turns over the card it uncovers', () => {
    const state = board({
      tableau: [
        [card('5', 'hearts', false), card('K', 'spades')],
        [],
        [], [], [], [], [],
      ],
    });
    const result = apply(state, { kind: 'play', from: tableau(0), to: tableau(1), count: 1 })!;
    expect(result.flipped?.id).toBe('hearts-5');
    expect(result.state.tableau[0][0].faceUp).toBe(true);
    expect(result.state.moves).toBe(1);
  });

  it('refuses a move the rules do not allow, and changes nothing', () => {
    const state = board({
      tableau: [[card('9', 'hearts')], [card('7', 'spades')], [], [], [], [], []],
    });
    expect(apply(state, { kind: 'play', from: tableau(0), to: tableau(1), count: 1 })).toBeUndefined();
    expect(state.tableau[0]).toHaveLength(1);
  });

  it('has no deck to turn', () => {
    expect(apply(deal(seeded(1)), { kind: 'draw' })).toBeUndefined();
  });
});

describe('tapping a card', () => {
  it('sends a single card home when it can go', () => {
    const state = board({ tableau: [[card('A', 'hearts')], [], [], [], [], [], []] });
    expect(autoTarget(state, tableau(0))).toEqual(foundation(1));
  });

  it('moves a handful to a column that will take its bottom card', () => {
    const state = board({
      tableau: [[card('6', 'hearts'), card('K', 'clubs')], [card('7', 'spades')], [], [], [], [], []],
    });
    expect(autoTarget(state, tableau(0), 2)).toEqual(tableau(1));
  });

  it('will not move a whole column into an empty one', () => {
    const state = board({ tableau: [[card('K', 'spades')], [], [], [], [], [], []] });
    expect(autoTarget(state, tableau(0), 1)).toBeUndefined();
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
      tableau: [[card('K', 'spades')], [card('K', 'hearts')], [card('K', 'diamonds')],
                [card('K', 'clubs')], [], [], []],
    });
    expect(canAutoFinish(state)).toBe(true);
    expect(autoFinishMove(state)).toEqual({ kind: 'play', from: tableau(0), to: foundation(0), count: 1 });
  });

  it('cannot be finished while a card is still face down', () => {
    const state = board({
      foundations: [full('spades').slice(0, 12), [], [], []],
      tableau: [[card('2', 'hearts', false), card('K', 'spades')], [], [], [], [], [], []],
    });
    expect(canAutoFinish(state)).toBe(false);
  });

  it('is over when nothing on the table fits anywhere', () => {
    // Four kings in four columns and nothing else: no empty column is worth
    // anything to a king that is already at the bottom of one, and none of
    // them will sit on another.
    const dead = board({
      tableau: [[card('K', 'spades')], [card('K', 'hearts')], [card('K', 'diamonds')],
                [card('K', 'clubs')], [], [], []],
    });
    expect(legalMoves(dead)).toEqual([]);
    expect(isDeadEnd(dead)).toBe(true);
  });

  it('is not over while a handful can still be carried somewhere', () => {
    const state = board({
      tableau: [[card('K', 'spades'), card('9', 'hearts')], [card('10', 'spades')],
                [], [], [], [], []],
    });
    expect(isDeadEnd(state)).toBe(false);
  });
});
