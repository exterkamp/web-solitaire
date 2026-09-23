import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  BlackHoleState,
  FAN_COUNT,
  FAN_SIZE,
  HOLE,
  apply,
  autoTarget,
  canDrop,
  cardsLeft,
  deal,
  hasWon,
  isDeadEnd,
  legalMoves,
  liftable,
} from './blackhole';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

function board(fans: Record<number, Card[]>, hole: Card[] = [card('A', 'spades')]): BlackHoleState {
  return {
    fans: Array.from({ length: FAN_COUNT }, (_, i) => fans[i] ?? []),
    hole,
    moves: 0,
  };
}

const at = (index: number): PileRef => ({ kind: 'tableau', index });

describe('deal', () => {
  it('lays seventeen fans of three and puts the ace of spades in the hole', () => {
    const state = deal(seeded(4));
    expect(state.fans).toHaveLength(FAN_COUNT);
    expect(state.fans.every((fan) => fan.length === FAN_SIZE)).toBe(true);
    expect(cardsLeft(state)).toBe(51);
    expect(state.hole.map((c) => c.id)).toEqual(['spades-A']);
  });

  it('uses the whole deck once, face up', () => {
    const state = deal(seeded(4));
    const all = [...state.fans.flat(), ...state.hole];
    expect(all).toHaveLength(52);
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
    expect(all.every((c) => c.faceUp)).toBe(true);
  });

  it('deals the same game twice from the same seed', () => {
    const ids = (s: BlackHoleState) => s.fans.flat().map((c) => c.id).join();
    expect(ids(deal(seeded(9)))).toBe(ids(deal(seeded(9))));
    expect(ids(deal(seeded(9)))).not.toBe(ids(deal(seeded(10))));
  });
});

describe('what can be played', () => {
  it('takes a card one rank either side of the card in the hole', () => {
    const state = board({ 0: [card('6', 'hearts')], 1: [card('8', 'clubs')] }, [card('7', 'spades')]);
    expect(canDrop(state, [card('6', 'hearts')], HOLE)).toBe(true);
    expect(canDrop(state, [card('8', 'clubs')], HOLE)).toBe(true);
    expect(canDrop(state, [card('9', 'clubs')], HOLE)).toBe(false);
  });

  // Parlett's rule, and the difference between this and Golf.
  it('treats the ranks as a ring, so an ace follows a king', () => {
    const onKing = board({ 0: [card('A', 'hearts')] }, [card('K', 'spades')]);
    expect(canDrop(onKing, [card('A', 'hearts')], HOLE)).toBe(true);
    const onAce = board({ 0: [card('K', 'hearts')] }, [card('A', 'spades')]);
    expect(canDrop(onAce, [card('K', 'hearts')], HOLE)).toBe(true);
  });

  it('only ever offers the card on top of a fan', () => {
    const state = board({ 0: [card('2', 'clubs'), card('9', 'hearts'), card('6', 'hearts')] });
    expect(liftable(state, at(0), 1)?.map((c) => c.id)).toEqual(['hearts-6']);
    expect(liftable(state, at(0), 2)).toBeUndefined();
  });

  it('never gives a card back out of the hole', () => {
    const state = board({}, [card('A', 'spades'), card('2', 'hearts')]);
    expect(liftable(state, HOLE, 1)).toBeUndefined();
  });

  it('has no deck to turn', () => {
    expect(apply(board({ 0: [card('2', 'spades')] }), { kind: 'draw' })).toBeUndefined();
  });
});

describe('playing a card', () => {
  it('moves it into the hole and uncovers the one beneath', () => {
    const state = board({ 0: [card('4', 'clubs'), card('2', 'hearts')] }, [card('A', 'spades')]);
    const result = apply(state, { kind: 'play', from: at(0), to: HOLE, count: 1 })!;
    expect(result.state.hole.at(-1)?.id).toBe('hearts-2');
    expect(result.state.fans[0].map((c) => c.id)).toEqual(['clubs-4']);
    expect(result.state.moves).toBe(1);
  });

  it('refuses a card that does not fit, and changes nothing', () => {
    const state = board({ 0: [card('9', 'hearts')] }, [card('A', 'spades')]);
    expect(apply(state, { kind: 'play', from: at(0), to: HOLE, count: 1 })).toBeUndefined();
    expect(state.fans[0]).toHaveLength(1);
  });

  it('will not put a card anywhere but the hole', () => {
    const state = board({ 0: [card('2', 'hearts')], 1: [card('3', 'clubs')] });
    expect(canDrop(state, [card('2', 'hearts')], at(1))).toBe(false);
  });
});

describe('the end of a game', () => {
  it('is won when every fan is empty', () => {
    expect(hasWon(board({}))).toBe(true);
    expect(hasWon(board({ 0: [card('2', 'hearts')] }))).toBe(false);
  });

  it('is over the moment nothing showing fits', () => {
    const stuck = board({ 0: [card('9', 'hearts')], 1: [card('5', 'clubs')] }, [card('A', 'spades')]);
    expect(legalMoves(stuck)).toEqual([]);
    expect(isDeadEnd(stuck)).toBe(true);
  });

  it('is not over while one card still fits', () => {
    const state = board({ 0: [card('9', 'hearts')], 1: [card('2', 'clubs')] }, [card('A', 'spades')]);
    expect(legalMoves(state)).toHaveLength(1);
    expect(isDeadEnd(state)).toBe(false);
  });

  it('sends a tapped card to the hole, or nowhere', () => {
    const state = board({ 0: [card('2', 'hearts')], 1: [card('9', 'clubs')] }, [card('A', 'spades')]);
    expect(autoTarget(state, at(0))).toEqual(HOLE);
    expect(autoTarget(state, at(1))).toBeUndefined();
  });
});
