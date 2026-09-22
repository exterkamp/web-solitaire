import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  COLUMN_COUNT,
  SpideretteState,
  apply,
  autoTarget,
  canDrop,
  canPlaceOnTableau,
  deal,
  hasWon,
  hiddenCards,
  isDeadEnd,
  legalMoves,
  liftable,
} from './spiderette';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

function board(partial: Partial<SpideretteState> = {}): SpideretteState {
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

// A king-to-ace run of one suit, which is the only thing this game is played
// to produce.
const RANKS_DOWN: Rank[] = ['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2', 'A'];
const fullRun = (suit: Suit): Card[] => RANKS_DOWN.map((rank) => card(rank, suit));

describe('deal', () => {
  it('lays a staircase of twenty-eight and keeps twenty-four to deal', () => {
    const state = deal(seeded(5));
    expect(state.tableau.map((pile) => pile.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(state.stock).toHaveLength(24);
    const all = [...state.tableau.flat(), ...state.stock];
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });

  it('turns up the last card of each column and nothing else', () => {
    const state = deal(seeded(5));
    state.tableau.forEach((pile) => {
      pile.forEach((card, index) => expect(card.faceUp).toBe(index === pile.length - 1));
    });
    expect(hiddenCards(state)).toBe(21);
    expect(state.stock.every((c) => !c.faceUp)).toBe(true);
  });

  it('deals the same game twice from the same seed', () => {
    const ids = (s: SpideretteState) => s.tableau.flat().map((c) => c.id).join();
    expect(ids(deal(seeded(8)))).toBe(ids(deal(seeded(8))));
    expect(ids(deal(seeded(8)))).not.toBe(ids(deal(seeded(9))));
  });
});

describe('placement', () => {
  it('builds down by rank and does not care about suit', () => {
    expect(canPlaceOnTableau(card('9', 'hearts'), [card('10', 'hearts')])).toBe(true);
    expect(canPlaceOnTableau(card('9', 'spades'), [card('10', 'hearts')])).toBe(true);
    expect(canPlaceOnTableau(card('8', 'spades'), [card('10', 'hearts')])).toBe(false);
  });

  it('takes anything at all into an empty column', () => {
    expect(canPlaceOnTableau(card('7', 'clubs'), [])).toBe(true);
  });
});

describe('lifting', () => {
  // The rule the whole game turns on, and the reason a convenient placement
  // is a card buried on purpose.
  it('takes a run of one suit', () => {
    const pile = [card('5', 'clubs'), card('10', 'hearts'), card('9', 'hearts')];
    const state = board({ tableau: columns(pile) });
    expect(liftable(state, at(0), 2)?.map((c) => c.id)).toEqual(['hearts-10', 'hearts-9']);
  });

  it('will not take a run that changes suit, however tidy it looks', () => {
    const pile = [card('10', 'spades'), card('9', 'hearts')];
    const state = board({ tableau: columns(pile) });
    expect(liftable(state, at(0), 2)).toBeUndefined();
    expect(liftable(state, at(0), 1)?.map((c) => c.id)).toEqual(['hearts-9']);
  });

  it('will not take a face-down card', () => {
    const state = board({ tableau: columns([card('4', 'spades', false)]) });
    expect(liftable(state, at(0), 1)).toBeUndefined();
  });

  it('is never lifted off a foundation', () => {
    const state = board({ foundations: [fullRun('spades'), [], [], []] });
    expect(liftable(state, { kind: 'foundation', index: 0 }, 1)).toBeUndefined();
  });
});

describe('moves', () => {
  it('turns over the card it uncovers', () => {
    const state = board({
      tableau: columns([card('7', 'diamonds', false), card('4', 'clubs')], [card('5', 'hearts')]),
    });
    const result = apply(state, { kind: 'play', from: at(0), to: at(1), count: 1 })!;
    expect(result.flipped?.id).toBe('diamonds-7');
    expect(result.state.tableau[0][0].faceUp).toBe(true);
  });

  it('refuses a move the rules do not allow, and changes nothing', () => {
    const state = board({ tableau: columns([card('4', 'clubs')], [card('9', 'hearts')]) });
    expect(apply(state, { kind: 'play', from: at(0), to: at(1), count: 1 })).toBeUndefined();
    expect(state.tableau[0]).toHaveLength(1);
  });

  it('sends a finished suit home by itself, and turns over what was under it', () => {
    const run = fullRun('hearts');
    const state = board({
      tableau: columns(
        [card('6', 'spades', false), ...run.slice(0, 12)],
        [run[12]],
      ),
    });
    const result = apply(state, { kind: 'play', from: at(1), to: at(0), count: 1 })!;
    expect(result.state.foundations[1]).toHaveLength(13);
    expect(result.state.tableau[0]).toHaveLength(1);
    expect(result.state.tableau[0][0].faceUp).toBe(true);
    expect(hasWon(result.state)).toBe(false);
  });

  it('is won when all four suits have gone home', () => {
    expect(hasWon(board({
      foundations: [fullRun('spades'), fullRun('hearts'), fullRun('diamonds'), fullRun('clubs')],
    }))).toBe(true);
  });
});

describe('dealing a row', () => {
  it('puts one card face up on every column', () => {
    const state = board({
      tableau: columns([card('4', 'clubs')], [card('9', 'hearts')]),
      stock: Array.from({ length: 7 }, (_, i) => card(String(i + 2) as Rank, 'spades', false)),
    });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.drawn).toHaveLength(7);
    expect(result.state.tableau.map((p) => p.length)).toEqual([2, 2, 1, 1, 1, 1, 1]);
    expect(result.state.tableau.every((pile) => pile.every((c) => c.faceUp))).toBe(true);
  });

  it('deals the short last row to the leftmost columns', () => {
    const state = board({ stock: [card('2', 'spades', false), card('3', 'spades', false)] });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.state.tableau.map((p) => p.length)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(result.state.stock).toHaveLength(0);
  });

  it('refuses when the deck is done', () => {
    expect(apply(board(), { kind: 'draw' })).toBeUndefined();
  });
});

describe('tapping a card', () => {
  it('prefers the column that continues the suit', () => {
    const state = board({
      tableau: columns([card('9', 'hearts')], [card('10', 'spades')], [card('10', 'hearts')]),
    });
    expect(autoTarget(state, at(0), 1)).toEqual(at(2));
  });

  it('would rather use a column with cards on it than spend an empty one', () => {
    const state = board({ tableau: columns([card('9', 'hearts')], [card('10', 'spades')]) });
    expect(autoTarget(state, at(0), 1)).toEqual(at(1));
  });

  it('will not move a whole column into an empty one', () => {
    const state = board({ tableau: columns([card('9', 'hearts')]) });
    expect(autoTarget(state, at(0), 1)).toBeUndefined();
  });
});

describe('the end of a game', () => {
  it('is over when nothing fits and the deck is empty', () => {
    const dead = board({
      tableau: columns([card('4', 'clubs')], [card('4', 'hearts')], [card('4', 'spades')],
                       [card('4', 'diamonds')], [card('9', 'hearts')], [card('9', 'spades')],
                       [card('9', 'clubs')]),
    });
    expect(legalMoves(dead)).toEqual([]);
    expect(isDeadEnd(dead)).toBe(true);
  });

  it('is not over while there is a row left to deal', () => {
    const state = board({
      tableau: columns([card('4', 'clubs')], [card('4', 'hearts')], [card('4', 'spades')],
                       [card('4', 'diamonds')], [card('9', 'hearts')], [card('9', 'spades')],
                       [card('9', 'clubs')]),
      stock: [card('2', 'spades', false)],
    });
    expect(isDeadEnd(state)).toBe(false);
  });
});
