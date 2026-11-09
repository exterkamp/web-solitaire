import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import { seeded } from './random';
import {
  CalculationState,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDraw,
  canDrop,
  cardsLeft,
  deal,
  foundationFor,
  hasWon,
  isDeadEnd,
  liftable,
  sequenceOf,
  wantedValue,
} from './calculation';

let serial = 0;
function card(rank: Rank, suit: Suit = 'spades', faceUp = true): Card {
  return { id: `${suit}-${rank}-${serial++}`, suit, rank, faceUp };
}

const RANK_OF: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const r = (value: number): Rank => RANK_OF[value - 1];

/** A foundation part way along its count, `length` cards in. */
const counted = (index: number, length: number): Card[] => sequenceOf(index).slice(0, length).map((v) => card(r(v)));

function board(partial: Partial<CalculationState> = {}): CalculationState {
  return {
    foundations: [counted(0, 1), counted(1, 1), counted(2, 1), counted(3, 1)],
    tableau: [[], [], [], []],
    stock: [],
    waste: [],
    moves: 0,
    ...partial,
  };
}

const waste: PileRef = { kind: 'waste', index: 0 };
const pile = (index: number): PileRef => ({ kind: 'tableau', index });
const home = (index: number): PileRef => ({ kind: 'foundation', index });

describe('the counts', () => {
  it('are the four times tables, round the corner, each ending on a king', () => {
    expect(sequenceOf(0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(sequenceOf(1)).toEqual([2, 4, 6, 8, 10, 12, 1, 3, 5, 7, 9, 11, 13]);
    expect(sequenceOf(2)).toEqual([3, 6, 9, 12, 2, 5, 8, 11, 1, 4, 7, 10, 13]);
    expect(sequenceOf(3)).toEqual([4, 8, 12, 3, 7, 11, 2, 6, 10, 1, 5, 9, 13]);
  });

  it('wants nothing more of a foundation at its king', () => {
    const state = board({ foundations: [counted(0, 13), counted(1, 12), counted(2, 1), counted(3, 1)] });
    expect(wantedValue(state, 0)).toBeUndefined();
    expect(wantedValue(state, 1)).toBe(13);
  });
});

describe('deal', () => {
  it('starts the foundations from an ace, two, three and four, and keeps forty-eight to turn', () => {
    const state = deal(seeded(11));
    expect(state.foundations.map((p) => p.map((c) => c.rank))).toEqual([['A'], ['2'], ['3'], ['4']]);
    expect(state.stock).toHaveLength(48);
    expect(state.stock.every((c) => !c.faceUp)).toBe(true);
    expect(state.tableau.every((p) => p.length === 0)).toBe(true);
    const all = [...state.stock, ...state.foundations.flat()];
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
    expect(cardsLeft(state)).toBe(48);
  });
});

describe('turning the deck', () => {
  it('turns one card, and not another until that one has gone somewhere', () => {
    const state = board({ stock: [card('9'), card('7')] });
    expect(canDraw(state)).toBe(true);
    const turned = apply(state, { kind: 'draw' })!.state;
    expect(turned.waste.map((c) => c.rank)).toEqual(['7']);
    expect(turned.waste[0].faceUp).toBe(true);
    expect(canDraw(turned)).toBe(false);
    expect(apply(turned, { kind: 'draw' })).toBeUndefined();
    const placed = apply(turned, { kind: 'play', from: waste, to: pile(2), count: 1 })!.state;
    expect(canDraw(placed)).toBe(true);
  });

  it('goes through once', () => {
    expect(canDraw(board())).toBe(false);
  });
});

describe('moves', () => {
  it('puts a card up where the count wants it, whatever its suit', () => {
    const state = board({ waste: [card('2', 'diamonds')] });
    expect(canDrop(state, state.waste, home(0))).toBe(true);
    expect(canDrop(state, state.waste, home(1))).toBe(false);
    const next = apply(state, { kind: 'play', from: waste, to: home(0), count: 1 })!.state;
    expect(wantedValue(next, 0)).toBe(3);
  });

  it('discards only the turned card, onto any pile', () => {
    const state = board({ waste: [card('K')], tableau: [[card('5')], [], [], []] });
    for (let i = 0; i < 4; i++) expect(canDrop(state, state.waste, pile(i))).toBe(true);
    // A card already discarded does not move to another pile.
    const fromPile = liftable(state, pile(0), 1)!;
    expect(canDrop(state, fromPile, pile(1))).toBe(false);
  });

  it('plays the top of a discard pile up, and only the top', () => {
    const state = board({ tableau: [[card('2'), card('9')], [], [], []] });
    expect(liftable(state, pile(0), 2)).toBeUndefined();
    expect(apply(state, { kind: 'play', from: pile(0), to: home(0), count: 1 })).toBeUndefined();
    state.tableau[0] = [card('9'), card('2')];
    expect(apply(state, { kind: 'play', from: pile(0), to: home(0), count: 1 })).toBeDefined();
  });

  it('never moves a card off a foundation', () => {
    expect(liftable(board(), home(0), 1)).toBeUndefined();
  });

  it('sends a tapped card up, and leaves a card nothing wants for the player to place', () => {
    const state = board({ waste: [card('6')] });
    // Six is the threes' next card (3, 6).
    expect(autoTarget(state, waste)).toEqual(home(2));
    expect(foundationFor(state, card('6'))).toEqual(home(2));
    state.waste = [card('J')];
    expect(autoTarget(state, waste)).toBeUndefined();
  });
});

describe('the end of a hand', () => {
  const nearlyDone = (): CalculationState =>
    board({
      foundations: [counted(0, 12), counted(1, 12), counted(2, 12), counted(3, 13)],
      tableau: [[card('K', 'hearts'), card('K', 'clubs')], [card('K', 'diamonds')], [], []],
    });

  it('is won with every foundation at its king', () => {
    const state = board({ foundations: [0, 1, 2, 3].map((i) => counted(i, 13)) });
    expect(hasWon(state)).toBe(true);
    expect(isDeadEnd(state)).toBe(false);
  });

  it('offers to finish once the deck is gone and the rest plays out', () => {
    const state = nearlyDone();
    expect(canAutoFinish(state)).toBe(true);
    let current = state;
    for (let move = autoFinishMove(current); move; move = autoFinishMove(current)) {
      current = apply(current, move)!.state;
    }
    expect(hasWon(current)).toBe(true);
  });

  it('does not offer to finish with cards still to turn, or a hand that will not come out', () => {
    expect(canAutoFinish({ ...nearlyDone(), stock: [card('5', 'spades', false)] })).toBe(false);
    const blocked = nearlyDone();
    // A queen buried under the last king the twos want.
    blocked.foundations[1] = counted(1, 11);
    blocked.tableau[2] = [card('J'), card('K', 'spades')];
    expect(canAutoFinish(blocked)).toBe(false);
  });

  it('is stuck with the deck gone and nothing a foundation wants on top', () => {
    const state = board({ tableau: [[card('K')], [card('Q')], [], []] });
    expect(isDeadEnd(state)).toBe(true);
    // But never while a card is waiting to be placed.
    expect(isDeadEnd({ ...state, waste: [card('K')] })).toBe(false);
  });
});
