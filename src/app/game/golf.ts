import { TABLEAU_COUNT, rankValue } from './config';
import { Card, shuffledDeck } from './deck';
import { Move, PileRef } from './piles';
import { topOf } from './card-rules';

// Golf, as rules rather than as a screen.
//
// Thirty-five cards in seven columns of five, one card face up beside the
// deck, and any card at the foot of a column that is one rank above or below
// it can be taken. Take them until nothing fits, turn the next card off the
// deck, and go again. Seventeen cards in the deck and no second pass: that is
// the whole game, and a hand takes about ninety seconds.
//
// It is Tri Peaks' mechanic on a wall instead of three peaks, with two rules
// changed, and the changed rules are the game. The ranks do **not** go round
// the corner - a king takes only a queen, an ace only a two - and nothing
// whatsoever may be played onto a king, so a king turned off the deck ends
// the sequence there and then. Tri Peaks lets an ace follow a king and is a
// game of long runs; Golf is a game of a wall with four dead ends in it.

export const COLUMN_COUNT = TABLEAU_COUNT;
export const COLUMN_DEPTH = 5;
const DEALT = COLUMN_COUNT * COLUMN_DEPTH;

export interface GolfState {
  tableau: Card[][];
  stock: Card[];
  waste: Card[];
  moves: number;
}

export interface MoveResult {
  state: GolfState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
}

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): GolfState {
  const deck = shuffledDeck(random);
  const tableau: Card[][] = Array.from({ length: COLUMN_COUNT }, () => []);
  for (let i = 0; i < DEALT; i++) {
    const card = deck[i];
    // Everything on the wall is face up. There is nothing to discover in this
    // game and nothing to dig for - only whether you can see a way through
    // what is already in front of you.
    card.faceUp = true;
    tableau[i % COLUMN_COUNT].push(card);
  }

  const rest = deck.slice(DEALT);
  const first = rest.pop()!;
  first.faceUp = true;
  for (const card of rest) card.faceUp = false;

  return { tableau, stock: rest, waste: [first], moves: 0 };
}

export function cloneState(state: GolfState): GolfState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    tableau: state.tableau.map(copy),
    stock: copy(state.stock),
    waste: copy(state.waste),
  };
}

export function cardsLeft(state: GolfState): number {
  return state.tableau.reduce((total, pile) => total + pile.length, 0);
}

// --- what is allowed ------------------------------------------------------

/**
 * Whether two ranks are neighbours - and in this game only neighbours, with
 * no wrapping round from king to ace.
 *
 * The one rule that separates Golf from Tri Peaks, and the reason a king on
 * the wall is a problem rather than a card. Some houses play it wrapping;
 * this one does not, because with the wrap the two games would differ only in
 * their outline.
 */
export function isNeighbour(a: Card, b: Card): boolean {
  return Math.abs(rankValue(a.rank) - rankValue(b.rank)) === 1;
}

export function liftable(state: GolfState, from: PileRef, count: number): Card[] | undefined {
  if (count !== 1 || from.kind !== 'tableau') return undefined;
  const pile = state.tableau[from.index];
  if (!pile?.length) return undefined;
  // Only the foot of a column - the card nothing else is lying on.
  return pile.slice(-1);
}

export function canDrop(state: GolfState, cards: readonly Card[], to: PileRef): boolean {
  if (cards.length !== 1 || to.kind !== 'waste') return false;
  const top = topOf(state.waste);
  if (!top) return false;
  // A king stops the game dead: nothing at all may be played onto one, not
  // even the queen the rank rule would allow. It is the other half of the
  // no-wrapping rule and the reason a hand of Golf ends when it does - turn
  // up a king and the only move left is another card off the deck.
  if (top.rank === 'K') return false;
  return isNeighbour(cards[0], top);
}

// --- making moves ---------------------------------------------------------

export function apply(state: GolfState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') return applyDraw(state);

  const cards = liftable(state, move.from, move.count);
  if (!cards) return undefined;
  if (!canDrop(state, cards, move.to)) return undefined;

  const next = cloneState(state);
  const taken = next.tableau[move.from.index].pop()!;
  next.waste.push(taken);
  next.moves = state.moves + 1;
  return { state: next, move, moved: [taken] };
}

function applyDraw(state: GolfState): MoveResult | undefined {
  if (!state.stock.length) return undefined;
  const next = cloneState(state);
  const card = next.stock.pop()!;
  card.faceUp = true;
  next.waste.push(card);
  next.moves = state.moves + 1;
  return { state: next, move: { kind: 'draw' }, drawn: [card] };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: GolfState): boolean {
  return cardsLeft(state) === 0;
}

export function legalMoves(state: GolfState): Move[] {
  const moves: Move[] = [];
  const waste: PileRef = { kind: 'waste', index: 0 };
  for (let i = 0; i < COLUMN_COUNT; i++) {
    const from: PileRef = { kind: 'tableau', index: i };
    const cards = liftable(state, from, 1);
    if (cards && canDrop(state, cards, waste)) {
      moves.push({ kind: 'play', from, to: waste, count: 1 });
    }
  }
  return moves;
}

/**
 * Whether the game is over: nothing on the wall fits and there is nothing
 * left to turn.
 *
 * There is no second pass through the deck, so this is as simple as it looks.
 * A hand of Golf ends far more often than it is won - somewhere around one in
 * ten deals goes out - and saying so promptly is the kindness.
 */
export function isDeadEnd(state: GolfState): boolean {
  if (hasWon(state)) return false;
  return !state.stock.length && legalMoves(state).length === 0;
}

export function autoTarget(state: GolfState, from: PileRef, count = 1): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards) return undefined;
  const waste: PileRef = { kind: 'waste', index: 0 };
  return canDrop(state, cards, waste) ? waste : undefined;
}

// Nothing to play out. The cards come off one at a time by hand, and a
// position that is winnable still has to be seen.
export function canAutoFinish(): boolean {
  return false;
}

export function autoFinishMove(): Move | undefined {
  return undefined;
}
