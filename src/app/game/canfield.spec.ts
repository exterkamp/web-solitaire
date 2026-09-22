import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  COLUMN_COUNT,
  CanfieldState,
  DRAW_COUNT,
  RESERVE_REF,
  RESERVE_SIZE,
  apply,
  autoTarget,
  canAutoFinish,
  canDrop,
  canPlaceOnFoundation,
  canPlaceOnTableau,
  deal,
  hasWon,
  isDeadEnd,
  legalMoves,
  liftable,
  rankAbove,
  rankBelow,
} from './canfield';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

function board(partial: Partial<CanfieldState> = {}): CanfieldState {
  return {
    base: '7',
    foundations: [[], [], [], []],
    tableau: Array.from({ length: COLUMN_COUNT }, () => [] as Card[]),
    reserve: [],
    stock: [],
    waste: [],
    moves: 0,
    ...partial,
  };
}

const columns = (...piles: Card[][]): Card[][] =>
  Array.from({ length: COLUMN_COUNT }, (_, i) => piles[i] ?? []);

const at = (index: number): PileRef => ({ kind: 'tableau', index });
const foundation = (index: number): PileRef => ({ kind: 'foundation', index });
const waste: PileRef = { kind: 'waste', index: 0 };

describe('deal', () => {
  it('lays a reserve of thirteen, four columns and one card home', () => {
    const state = deal(seeded(5));
    expect(state.reserve).toHaveLength(RESERVE_SIZE);
    expect(state.tableau.map((p) => p.length)).toEqual([1, 1, 1, 1]);
    expect(state.foundations.filter((p) => p.length)).toHaveLength(1);
    expect(state.stock).toHaveLength(34);
    const all = [
      ...state.reserve, ...state.tableau.flat(), ...state.foundations.flat(), ...state.stock,
    ];
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });

  it('takes its base rank from the card that went home first', () => {
    const state = deal(seeded(5));
    const first = state.foundations.flat()[0];
    expect(state.base).toBe(first.rank);
  });

  it('shows only the top of the reserve', () => {
    const state = deal(seeded(5));
    state.reserve.forEach((card, i) => {
      expect(card.faceUp).toBe(i === state.reserve.length - 1);
    });
  });
});

describe('ranks that go round the corner', () => {
  it('counts up past the king to the ace', () => {
    expect(rankAbove('K')).toBe('A');
    expect(rankAbove('A')).toBe('2');
    expect(rankAbove('10')).toBe('J');
  });

  it('counts down past the ace to the king', () => {
    expect(rankBelow('A')).toBe('K');
    expect(rankBelow('2')).toBe('A');
    expect(rankBelow('J')).toBe('10');
  });
});

describe('the foundations', () => {
  it('start on the base rank, whatever it is', () => {
    const state = board({ base: '7' });
    expect(canPlaceOnFoundation(state, card('7', 'hearts'), [])).toBe(true);
    expect(canPlaceOnFoundation(state, card('A', 'hearts'), [])).toBe(false);
  });

  it('build up in suit, round the corner and on past the ace', () => {
    const state = board({ base: 'Q' });
    expect(canPlaceOnFoundation(state, card('K', 'hearts'), [card('Q', 'hearts')])).toBe(true);
    expect(canPlaceOnFoundation(state, card('A', 'hearts'), [card('Q', 'hearts'), card('K', 'hearts')]))
      .toBe(true);
    expect(canPlaceOnFoundation(state, card('A', 'spades'), [card('Q', 'hearts'), card('K', 'hearts')]))
      .toBe(false);
  });
});

describe('the columns', () => {
  it('build down in alternating colours, round the corner', () => {
    const state = board();
    expect(canPlaceOnTableau(state, card('6', 'hearts'), [card('7', 'spades')])).toBe(true);
    expect(canPlaceOnTableau(state, card('6', 'diamonds'), [card('7', 'hearts')])).toBe(false);
    // A king onto an ace, which is the wrap the other games here do not have.
    expect(canPlaceOnTableau(state, card('K', 'hearts'), [card('A', 'spades')])).toBe(true);
  });

  it('carry a run that is built the same way', () => {
    const pile = [card('2', 'clubs'), card('A', 'hearts'), card('K', 'spades')];
    const state = board({ tableau: columns(pile) });
    expect(liftable(state, at(0), 3)?.map((c) => c.id))
      .toEqual(['clubs-2', 'hearts-A', 'spades-K']);
  });

  // An empty column is not a free column: the reserve claims it first.
  it('refuse a card into an empty column while the reserve has anything in it', () => {
    const waiting = board({ reserve: [card('3', 'clubs')] });
    expect(canPlaceOnTableau(waiting, card('K', 'hearts'), [])).toBe(false);
    const spent = board({ reserve: [] });
    expect(canPlaceOnTableau(spent, card('K', 'hearts'), [])).toBe(true);
  });
});

describe('the reserve', () => {
  it('gives up its top card and turns over the next', () => {
    const state = board({
      base: '7',
      reserve: [card('2', 'clubs', false), card('7', 'hearts')],
      tableau: columns([card('K', 'spades')], [card('K', 'hearts')], [card('K', 'diamonds')],
                       [card('K', 'clubs')]),
    });
    const result = apply(state, { kind: 'play', from: RESERVE_REF, to: foundation(1), count: 1 })!;
    expect(result.state.foundations[1].map((c) => c.id)).toEqual(['hearts-7']);
    expect(result.state.reserve).toHaveLength(1);
    expect(result.state.reserve[0].faceUp).toBe(true);
    expect(result.flipped?.id).toBe('clubs-2');
  });

  it('fills an empty column by itself, without being asked', () => {
    const state = board({
      base: '7',
      reserve: [card('4', 'spades', false), card('9', 'clubs')],
      tableau: columns([card('7', 'hearts')], [card('K', 'hearts')], [card('K', 'diamonds')],
                       [card('K', 'clubs')]),
    });
    const result = apply(state, { kind: 'play', from: at(0), to: foundation(1), count: 1 })!;
    // Column 0 emptied, and the reserve has already refilled it.
    expect(result.state.tableau[0].map((c) => c.id)).toEqual(['clubs-9']);
    expect(result.state.reserve).toHaveLength(1);
    expect(result.state.reserve[0].faceUp).toBe(true);
  });

  it('leaves a column empty once it has nothing left to give', () => {
    const state = board({
      base: '7',
      reserve: [],
      tableau: columns([card('7', 'hearts')], [card('K', 'hearts')]),
    });
    const result = apply(state, { kind: 'play', from: at(0), to: foundation(1), count: 1 })!;
    expect(result.state.tableau[0]).toEqual([]);
  });
});

describe('the deck', () => {
  it('turns three at a time', () => {
    const state = board({
      stock: [card('2', 'clubs', false), card('3', 'clubs', false), card('4', 'clubs', false),
              card('5', 'clubs', false)],
    });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.drawn).toHaveLength(DRAW_COUNT);
    expect(result.state.waste.at(-1)?.id).toBe('clubs-3');
    expect(result.state.waste.every((c) => c.faceUp)).toBe(true);
    expect(result.state.stock).toHaveLength(1);
  });

  it('turns the waste back over, for ever', () => {
    const state = board({ waste: [card('2', 'clubs'), card('3', 'clubs')] });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.recycled).toBe(true);
    expect(result.state.stock).toHaveLength(2);
    expect(result.state.waste).toHaveLength(0);
  });

  it('refuses when there is nothing anywhere', () => {
    expect(apply(board(), { kind: 'draw' })).toBeUndefined();
  });

  it('plays the top of the waste and nothing under it', () => {
    const state = board({ waste: [card('2', 'clubs'), card('7', 'hearts')] });
    expect(liftable(state, waste, 1)?.map((c) => c.id)).toEqual(['hearts-7']);
    expect(liftable(state, waste, 2)).toBeUndefined();
  });
});

describe('the end of a game', () => {
  const full = (suit: Suit): Card[] =>
    (['7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '3', '4', '5', '6'] as Rank[]).map((r) =>
      card(r, suit),
    );

  it('is won when every foundation holds thirteen', () => {
    expect(hasWon(board({
      foundations: [full('spades'), full('hearts'), full('diamonds'), full('clubs')],
    }))).toBe(true);
  });

  it('is a formality only once the reserve is gone', () => {
    expect(canAutoFinish(board({ reserve: [card('2', 'clubs', false)] }))).toBe(false);
    expect(canAutoFinish(board({ tableau: columns([card('7', 'hearts')]) }))).toBe(true);
  });

  it('is over when nothing plays and the deck only repeats', () => {
    const dead = board({
      base: '7',
      tableau: columns([card('5', 'spades')], [card('5', 'hearts')], [card('5', 'diamonds')],
                       [card('5', 'clubs')]),
      stock: [card('9', 'spades', false)],
    });
    expect(legalMoves(dead)).toEqual([]);
    expect(isDeadEnd(dead)).toBe(true);
  });

  it('is not over while a card in the deck can still be played', () => {
    const state = board({
      base: '7',
      tableau: columns([card('5', 'spades')], [card('5', 'hearts')], [card('5', 'diamonds')],
                       [card('5', 'clubs')]),
      stock: [card('7', 'hearts', false)],
    });
    expect(isDeadEnd(state)).toBe(false);
  });

  it('sends a tapped card home before it puts it on a column', () => {
    const state = board({
      base: '7',
      tableau: columns([card('7', 'hearts')], [card('8', 'spades')]),
    });
    expect(autoTarget(state, at(0))).toEqual(foundation(1));
  });
});
