import { Card, shuffledDeck } from './deck';
import { Move, PileRef } from './piles';
import { isNeighbourWrapping, topOf } from './card-rules';

// Black Hole, as rules rather than as a screen.
//
// David Parlett's game, and the only one here that is pure position: fifty-one
// cards in seventeen fans of three, the ace of spades alone in the middle, and
// one move available - put any card you can see that is one rank either side
// of the middle card onto it. The ranks go round the corner, so an ace follows
// a king. No deck, no redeal, no moving a card from one fan to another, and
// nothing hidden from the first moment to the last.
//
// It looks like Golf and it is the opposite game. Golf gives you a deck to
// turn when you run out of ideas, which means a hand is half luck; here there
// is nothing to turn, so every card that goes into the hole was a choice and
// the hand you lose is one you misplayed. Something like eight deals in ten
// can be won - by somebody who can see the whole thing.

export const FAN_COUNT = 17;
export const FAN_SIZE = 3;

export interface BlackHoleState {
  // Seventeen fans of three, all face up. The last card of each is the one
  // on top of it, which is the only one available.
  fans: Card[][];
  // Everything played so far, bottom card first. Only its top matters to the
  // rules; the rest is kept so undo has something to put back.
  hole: Card[];
  moves: number;
}

export interface MoveResult {
  state: BlackHoleState;
  move: Move;
  moved: Card[];
}

export const HOLE: PileRef = { kind: 'foundation', index: 0 };

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): BlackHoleState {
  // The ace of spades goes into the hole and the other fifty-one are dealt
  // over it. Any card would do - Parlett's rules say so - but the ace of
  // spades is the one everybody pictures, and a fixed starting card means two
  // players comparing a deal are comparing the same game.
  const deck = shuffledDeck(random);
  const start = deck.findIndex((card) => card.suit === 'spades' && card.rank === 'A');
  const [hole] = deck.splice(start, 1);
  for (const card of deck) card.faceUp = true;
  hole.faceUp = true;

  const fans: Card[][] = Array.from({ length: FAN_COUNT }, (_, i) =>
    deck.slice(i * FAN_SIZE, (i + 1) * FAN_SIZE),
  );
  return { fans, hole: [hole], moves: 0 };
}

export function cloneState(state: BlackHoleState): BlackHoleState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return { ...state, fans: state.fans.map(copy), hole: copy(state.hole) };
}

export function cardsLeft(state: BlackHoleState): number {
  return state.fans.reduce((total, fan) => total + fan.length, 0);
}

// --- what is allowed ------------------------------------------------------

export function liftable(
  state: BlackHoleState, from: PileRef, count: number,
): Card[] | undefined {
  // The hole is where cards go, and nothing ever comes back out of it.
  if (count !== 1 || from.kind !== 'tableau') return undefined;
  const fan = state.fans[from.index];
  return fan?.length ? fan.slice(-1) : undefined;
}

export function canDrop(
  state: BlackHoleState, cards: readonly Card[], to: PileRef,
): boolean {
  if (cards.length !== 1 || to.kind !== 'foundation') return false;
  const top = topOf(state.hole);
  return !!top && isNeighbourWrapping(cards[0], top);
}

// --- making moves ---------------------------------------------------------

export function apply(state: BlackHoleState, move: Move): MoveResult | undefined {
  // No deck to turn, so the only move there is is a card into the hole.
  if (move.kind !== 'play') return undefined;
  const cards = liftable(state, move.from, move.count);
  if (!cards) return undefined;
  if (!canDrop(state, cards, move.to)) return undefined;

  const next = cloneState(state);
  const taken = next.fans[move.from.index].pop()!;
  next.hole.push(taken);
  next.moves = state.moves + 1;
  return { state: next, move, moved: [taken] };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: BlackHoleState): boolean {
  return cardsLeft(state) === 0;
}

export function legalMoves(state: BlackHoleState): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i < FAN_COUNT; i++) {
    const from: PileRef = { kind: 'tableau', index: i };
    const cards = liftable(state, from, 1);
    if (cards && canDrop(state, cards, HOLE)) {
      moves.push({ kind: 'play', from, to: HOLE, count: 1 });
    }
  }
  return moves;
}

/**
 * Whether the game is over: nothing showing fits the hole.
 *
 * The simplest dead end here, because there is nothing to turn and nothing to
 * wait for. When no card fits, no card will ever fit - the position cannot
 * change except by a move, and there are none.
 */
export function isDeadEnd(state: BlackHoleState): boolean {
  return !hasWon(state) && legalMoves(state).length === 0;
}

/** Where a tapped card goes: into the hole, if the hole will have it. */
export function autoTarget(
  state: BlackHoleState, from: PileRef, count = 1,
): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards) return undefined;
  return canDrop(state, cards, HOLE) ? HOLE : undefined;
}

// Nothing to play out. Every move in this game is a choice between cards that
// all fit, which is the whole of it - there is no position where the rest is
// a formality, only positions with one legal move in them.
export function canAutoFinish(): boolean {
  return false;
}

export function autoFinishMove(): Move | undefined {
  return undefined;
}
