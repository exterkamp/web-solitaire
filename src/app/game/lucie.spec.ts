import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import { seeded } from './random';
import {
  FAN_COUNT,
  LucieState,
  REDEALS,
  apply,
  autoTarget,
  canAutoFinish,
  canDrop,
  cardsLeft,
  deal,
  hasWon,
  isDeadEnd,
  liftable,
} from './lucie';

let serial = 0;
function card(rank: Rank, suit: Suit = 'spades'): Card {
  return { id: `${suit}-${rank}-${serial++}`, suit, rank, faceUp: true };
}
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const upTo = (suit: Suit, rank: Rank): Card[] => RANKS.slice(0, RANKS.indexOf(rank) + 1).map((r) => card(r, suit));

function board(partial: Partial<LucieState> = {}): LucieState {
  return {
    foundations: [[], [], [], []],
    tableau: Array.from({ length: FAN_COUNT }, () => []),
    redeals: REDEALS,
    merci: false,
    seed: 1,
    moves: 0,
    ...partial,
  };
}

const fan = (index: number): PileRef => ({ kind: 'tableau', index });
const home = (index: number): PileRef => ({ kind: 'foundation', index });

describe('deal', () => {
  it('lays seventeen fans of three and one of one, all face up', () => {
    const state = deal(seeded(3));
    expect(state.tableau.map((f) => f.length)).toEqual([...Array(17).fill(3), 1]);
    expect(state.tableau.flat().every((c) => c.faceUp)).toBe(true);
    expect(new Set(state.tableau.flat().map((c) => c.id)).size).toBe(52);
    expect(state.redeals).toBe(2);
    expect(state.merci).toBe(false);
  });
});

describe('moves', () => {
  it('builds down in suit onto a fan, and never onto an empty one', () => {
    const state = board();
    state.tableau[0] = [card('9', 'hearts')];
    state.tableau[1] = [card('3', 'clubs'), card('8', 'hearts')];
    state.tableau[2] = [card('8', 'spades')];
    expect(canDrop(state, [state.tableau[1][1]], fan(0))).toBe(true);
    expect(canDrop(state, [state.tableau[2][0]], fan(0))).toBe(false);
    expect(canDrop(state, [state.tableau[1][1]], fan(5))).toBe(false);
  });

  it('moves only the top card of a fan', () => {
    const state = board();
    state.tableau[0] = [card('2'), card('9')];
    expect(liftable(state, fan(0), 2)).toBeUndefined();
    expect(liftable(state, fan(0), 1)?.[0].rank).toBe('9');
  });

  it('sends aces home and builds the foundations up in suit', () => {
    const state = board({ foundations: [upTo('spades', '4'), [], [], []] });
    state.tableau[0] = [card('5', 'spades')];
    state.tableau[1] = [card('A', 'hearts')];
    expect(autoTarget(state, fan(0))).toEqual(home(0));
    expect(autoTarget(state, fan(1))).toEqual(home(1));
    expect(canDrop(state, state.tableau[0], home(1))).toBe(false);
  });
});

describe('redealing', () => {
  it('gathers every fan, shuffles, and deals again in threes', () => {
    const state = deal(seeded(8));
    // One fan short, as after a few cards have gone home.
    state.tableau[17] = [];
    const left = state.tableau.flat().length;
    const next = apply(state, { kind: 'draw' })!.state;
    expect(next.redeals).toBe(1);
    expect(next.tableau.flat()).toHaveLength(left);
    expect(next.tableau.map((f) => f.length)).toEqual([...Array(17).fill(3), ...Array(1).fill(0)]);
    expect(next.tableau.flat().map((c) => c.id).sort()).toEqual(state.tableau.flat().map((c) => c.id).sort());
    expect(next.merci).toBe(false);
  });

  it('is the same shuffle from the same position, so undo and saves agree', () => {
    const state = deal(seeded(8));
    expect(apply(state, { kind: 'draw' })!.state).toEqual(apply(state, { kind: 'draw' })!.state);
  });

  it('twice, and the last brings the merci', () => {
    let state = deal(seeded(2));
    state = apply(state, { kind: 'draw' })!.state;
    state = apply(state, { kind: 'draw' })!.state;
    expect(state.redeals).toBe(0);
    expect(state.merci).toBe(true);
    expect(apply(state, { kind: 'draw' })).toBeUndefined();
  });

  it('deals a remainder as a fan of its own', () => {
    const state = board();
    state.tableau[0] = [card('K'), card('Q'), card('J')];
    state.tableau[1] = [card('10'), card('9')];
    const next = apply(state, { kind: 'draw' })!.state;
    expect(next.tableau.map((f) => f.length).slice(0, 3)).toEqual([3, 2, 0]);
  });
});

describe('the merci', () => {
  const lastDeal = () => {
    const state = board({ redeals: 0, merci: true });
    state.tableau[0] = [card('A', 'hearts'), card('K', 'clubs'), card('7', 'diamonds')];
    return state;
  };

  it('brings a buried card to the top of its fan, once', () => {
    const state = lastDeal();
    // A tap on the ace, which lifts it and the two over it.
    expect(autoTarget(state, fan(0), 3)).toEqual(fan(0));
    const next = apply(state, { kind: 'play', from: fan(0), to: fan(0), count: 3 })!.state;
    expect(next.tableau[0].map((c) => c.rank)).toEqual(['K', '7', 'A']);
    expect(next.merci).toBe(false);
    expect(liftable(next, fan(0), 3)).toBeUndefined();
  });

  it('is not to be had before the last deal', () => {
    const state = lastDeal();
    state.redeals = 1;
    state.merci = false;
    expect(liftable(state, fan(0), 3)).toBeUndefined();
  });

  it('keeps a hand alive that would otherwise be stuck', () => {
    const state = lastDeal();
    expect(isDeadEnd(state)).toBe(false);
    expect(isDeadEnd({ ...state, merci: false })).toBe(true);
  });
});

describe('the end of a hand', () => {
  it('finishes itself once every card left can go home', () => {
    const state = board({
      foundations: [upTo('spades', 'J'), upTo('hearts', 'K'), upTo('diamonds', 'K'), upTo('clubs', 'K')],
    });
    state.tableau[4] = [card('K', 'spades'), card('Q', 'spades')];
    expect(cardsLeft(state)).toBe(2);
    expect(canAutoFinish(state)).toBe(true);
    // A queen under its own king will not come out by itself.
    state.tableau[4] = [card('Q', 'spades'), card('K', 'spades')];
    expect(canAutoFinish(state)).toBe(false);
  });

  it('is won with all fifty-two home', () => {
    const state = board({
      foundations: (['spades', 'hearts', 'diamonds', 'clubs'] as Suit[]).map((s) => upTo(s, 'K')),
    });
    expect(hasWon(state)).toBe(true);
    expect(isDeadEnd(state)).toBe(false);
  });

  it('is stuck with nothing to move, no redeals and no merci', () => {
    const state = board({ redeals: 0, merci: false });
    state.tableau[0] = [card('2', 'hearts'), card('K', 'clubs')];
    expect(isDeadEnd(state)).toBe(true);
    expect(isDeadEnd({ ...state, redeals: 1 })).toBe(false);
  });
});
