import { RANKS, SUITS, Suit } from './config';
import { Card, shuffle } from './deck';
import { Move, PileRef } from './piles';
import * as rules from './spiderette';
import { SpideretteState } from './spiderette';

// Spider, as rules rather than as a screen.
//
// The game Spiderette is the one-deck cut of: two decks, ten columns, and
// the same single rule underneath - build down by rank in any suit, but pick
// up only a run of one suit. Everything that rule implies (a suit goes home
// only finished, the deck will not deal over an empty column) is Spiderette's
// code, which already asks the state how many columns and foundations it has
// rather than assuming seven and four. What is Spider's own is the deck and
// the deal.
//
// The deck is a hundred and four cards in one, two or four suits. Fewer suits
// is not fewer cards: one suit is eight sets of spades, so every run you
// build is a run you can carry, and four suits is two of each - the real game
// and much the hardest. Two is the usual middle.

export type SuitCount = 1 | 2 | 4;
export const SUIT_COUNTS: readonly SuitCount[] = [1, 2, 4];

export function asSuitCount(value: unknown): SuitCount {
  return value === 2 || value === 4 ? value : 1;
}

export const COLUMN_COUNT = 10;
// Eight suits come off the table in a won game, whatever they are suits of.
export const FOUNDATION_COUNT = 8;
const SETS = 8;

// Fifty-four on the table - six to each of the first four columns, five to
// the other six - and fifty in the deck, which is five deals of ten.
const DEPTHS = [6, 6, 6, 6, 5, 5, 5, 5, 5, 5];

export interface SpiderState extends SpideretteState {
  suits: SuitCount;
}

/** Which suits make up the eight sets, at a given count. */
export function suitsOf(count: SuitCount): Suit[] {
  // Spades first, and hearts as the second, so a two-suit game is black and
  // red and a run of the wrong one is visible from across the room.
  const used: Suit[] = count === 1 ? ['spades'] : count === 2 ? ['spades', 'hearts'] : [...SUITS];
  return Array.from({ length: SETS }, (_, i) => used[i % used.length]);
}

/**
 * The hundred and four, unshuffled. Ids carry which set a card came from,
 * because two decks hold two of every card - and in one suit, eight - and
 * the board tells cards apart by id.
 */
export function spiderDeck(count: SuitCount): Card[] {
  return suitsOf(count).flatMap((suit, set) =>
    RANKS.map((rank) => ({ id: `${suit}-${rank}-${set}`, suit, rank, faceUp: false })),
  );
}

export function deal(suits: SuitCount = 1, random: () => number = Math.random): SpiderState {
  const deck = shuffle(spiderDeck(suits), random);
  let next = 0;
  const tableau = DEPTHS.map((depth) =>
    Array.from({ length: depth }, (_, i) => {
      const card = deck[next++];
      card.faceUp = i === depth - 1;
      return card;
    }),
  );
  const stock = deck.slice(next);
  for (const card of stock) card.faceUp = false;
  return {
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau,
    stock,
    moves: 0,
    suits,
  };
}

// The rest is Spiderette's, with the suit count carried through.

export function apply(state: SpiderState, move: Move): (rules.MoveResult & { state: SpiderState }) | undefined {
  const result = rules.apply(state, move);
  return result && { ...result, state: { ...result.state, suits: state.suits } };
}

export const liftable = (state: SpiderState, from: PileRef, count: number) => rules.liftable(state, from, count);
export const canDrop = (state: SpiderState, cards: readonly Card[], to: PileRef) => rules.canDrop(state, cards, to);
export const canDeal = (state: SpiderState) => rules.canDeal(state);
export const hasWon = (state: SpiderState) => rules.hasWon(state);
export const isDeadEnd = (state: SpiderState) => rules.isDeadEnd(state);
export const legalMoves = (state: SpiderState) => rules.legalMoves(state);
export const hiddenCards = (state: SpiderState) => rules.hiddenCards(state);
export const autoTarget = (state: SpiderState, from: PileRef, count = 1) => rules.autoTarget(state, from, count);
export const canAutoFinish = rules.canAutoFinish;
export const autoFinishMove = rules.autoFinishMove;
