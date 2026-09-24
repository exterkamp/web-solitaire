import { FOUNDATION_COUNT, TABLEAU_COUNT } from './config';
import { Card, shuffledDeck } from './deck';
import { Move, PileRef } from './piles';
import { buildsDown, canPlaceOnFoundation, foundationIndexOf, topOf } from './card-rules';

// Yukon, as rules rather than as a screen. Same arrangement as the other two:
// pure functions over a state, every move answering with a new one.
//
// It looks like Klondike from across the room - seven columns, cards face
// down under cards face up, kings into empty columns - and plays nothing like
// it, because of one rule: any face-up card may be moved along with every
// card sitting on top of it, in whatever order those happen to be. There is
// no deck to turn and no waste to cycle. Everything you will ever be given is
// already on the table, and the game is about digging.
//
// That one rule is also the whole of the difference in this file. Klondike's
// liftable asks whether the cards form a run; this one asks only whether the
// bottom card of the handful is face up.

export const COLUMN_COUNT = TABLEAU_COUNT;

// The deal: one card in the first column, and then a column at a time, each
// with one more face-down card than the last under five face up.
const FACE_UP_PER_COLUMN = 5;

export interface YukonState {
  foundations: Card[][];
  tableau: Card[][];
  moves: number;
}

export interface MoveResult {
  state: YukonState;
  move: Move;
  moved: Card[];
  // The card this move uncovered, if it uncovered one. Turning it over is the
  // only progress this game makes that is not a card going home.
  flipped?: Card;
}

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): YukonState {
  const deck = shuffledDeck(random);
  const tableau: Card[][] = Array.from({ length: COLUMN_COUNT }, () => []);
  let next = 0;
  const take = (faceUp: boolean): Card => {
    const card = deck[next++];
    card.faceUp = faceUp;
    return card;
  };

  // One card, face up, and then six columns of a face-down foundation with
  // five face-up cards laid over it. 1 + (1..6) + 6x5 is fifty-two exactly.
  tableau[0].push(take(true));
  for (let column = 1; column < COLUMN_COUNT; column++) {
    for (let i = 0; i < column; i++) tableau[column].push(take(false));
    for (let i = 0; i < FACE_UP_PER_COLUMN; i++) tableau[column].push(take(true));
  }

  return {
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau,
    moves: 0,
  };
}

export function cloneState(state: YukonState): YukonState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    foundations: state.foundations.map(copy),
    tableau: state.tableau.map(copy),
  };
}

function pileOf(state: YukonState, ref: PileRef): Card[] | undefined {
  if (ref.kind === 'foundation') return state.foundations[ref.index];
  if (ref.kind === 'tableau') return state.tableau[ref.index];
  // A stock, a waste, a free cell: piles this game does not have.
  return undefined;
}

export function hiddenCards(state: YukonState): number {
  return state.tableau.reduce(
    (total, pile) => total + pile.filter((card) => !card.faceUp).length,
    0,
  );
}

// --- what is allowed ------------------------------------------------------

/** Kings start an empty column; after that it is the other colour, one lower. */
export function canPlaceOnTableau(card: Card, pile: readonly Card[]): boolean {
  const top = topOf(pile);
  if (!top) return card.rank === 'K';
  return buildsDown(card, top);
}

/**
 * The cards a move would lift.
 *
 * This is the game. Any face-up card comes away with everything piled on it,
 * and those cards do not have to be in any order at all - a king with a three
 * and a seven on his head moves as a king with a three and a seven on his
 * head. Only the card at the bottom of the handful has to fit where it is
 * going.
 *
 * Which means the only question here is whether that bottom card is face up.
 * A face-down card is not yours to move; it is the thing you are digging for.
 */
export function liftable(state: YukonState, from: PileRef, count: number): Card[] | undefined {
  if (count < 1) return undefined;
  const pile = pileOf(state, from);
  if (!pile || pile.length < count) return undefined;

  if (from.kind === 'foundation') return count === 1 ? pile.slice(-1) : undefined;
  if (from.kind !== 'tableau') return undefined;

  const index = pile.length - count;
  return pile[index].faceUp ? pile.slice(index) : undefined;
}

export function canDrop(state: YukonState, cards: readonly Card[], to: PileRef): boolean {
  if (!cards.length) return false;

  if (to.kind === 'foundation') {
    // A foundation takes one card at a time, into its own suit's column.
    if (cards.length !== 1) return false;
    if (to.index !== foundationIndexOf(cards[0].suit)) return false;
    return canPlaceOnFoundation(cards[0], state.foundations[to.index]);
  }
  if (to.kind !== 'tableau') return false;
  const pile = state.tableau[to.index];
  return !!pile && canPlaceOnTableau(cards[0], pile);
}

// --- making moves ---------------------------------------------------------

export function apply(state: YukonState, move: Move): MoveResult | undefined {
  // No deck, so no turning one.
  if (move.kind !== 'play') return undefined;
  const { from, to, count } = move;
  if (from.kind === to.kind && from.index === to.index) return undefined;

  const cards = liftable(state, from, count);
  if (!cards) return undefined;
  if (!canDrop(state, cards, to)) return undefined;

  const next = cloneState(state);
  const source = pileOf(next, from)!;
  const target = pileOf(next, to)!;
  const lifted = source.splice(source.length - count, count);
  target.push(...lifted);

  // Whatever the move uncovered, turned over. In a game with nothing to draw,
  // this is the only new information there is.
  let flipped: Card | undefined;
  if (from.kind === 'tableau') {
    const uncovered = topOf(source);
    if (uncovered && !uncovered.faceUp) {
      uncovered.faceUp = true;
      flipped = uncovered;
    }
  }

  next.moves = state.moves + 1;
  return { state: next, move, moved: lifted, flipped };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: YukonState): boolean {
  return state.foundations.every((pile) => pile.length === 13);
}

/**
 * Every move available, for noticing when there are none.
 *
 * Moves off a foundation are left out for the reason Klondike's are: a card
 * can almost always be fetched back, so counting those would mean no game was
 * ever over and the board could never say so.
 */
export function legalMoves(state: YukonState): Move[] {
  const moves: Move[] = [];
  const targets: PileRef[] = [
    ...state.foundations.map((_, i) => ({ kind: 'foundation', index: i }) as PileRef),
    ...state.tableau.map((_, i) => ({ kind: 'tableau', index: i }) as PileRef),
  ];

  state.tableau.forEach((pile, column) => {
    pile.forEach((card, index) => {
      if (!card.faceUp) return;
      const from: PileRef = { kind: 'tableau', index: column };
      const count = pile.length - index;
      const cards = liftable(state, from, count);
      if (!cards) return;
      for (const to of targets) {
        if (to.kind === 'tableau' && to.index === column) continue;
        // Moving a whole column into an empty one is legal and is not
        // progress; counting it would mean a game was never quite over.
        if (to.kind === 'tableau' && !state.tableau[to.index].length && count === pile.length) {
          continue;
        }
        if (canDrop(state, cards, to)) moves.push({ kind: 'play', from, to, count });
      }
    });
  });
  return moves;
}

export function isDeadEnd(state: YukonState): boolean {
  return !hasWon(state) && legalMoves(state).length === 0;
}

/**
 * Where a card goes when it is tapped rather than dragged.
 *
 * Home first, then a column that will take it, preferring one with cards on
 * it - an empty column in this game is a king's berth and the only way to
 * unstick a buried one, so a tap should not spend it on something else.
 */
export function autoTarget(state: YukonState, from: PileRef, count = 1): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards) return undefined;

  if (cards.length === 1 && from.kind !== 'foundation') {
    const home: PileRef = { kind: 'foundation', index: foundationIndexOf(cards[0].suit) };
    if (canDrop(state, cards, home)) return home;
  }

  const empties: PileRef[] = [];
  for (let i = 0; i < state.tableau.length; i++) {
    const to: PileRef = { kind: 'tableau', index: i };
    if (from.kind === 'tableau' && from.index === i) continue;
    if (!canDrop(state, cards, to)) continue;
    if (state.tableau[i].length) return to;
    empties.push(to);
  }
  // A whole column into an empty one is a change of address, not a move.
  if (from.kind === 'tableau' && count === state.tableau[from.index].length) return undefined;
  return empties[0];
}

/** The next card that can go home, off the top of a column. */
export function autoFinishMove(state: YukonState): Move | undefined {
  for (let i = 0; i < state.tableau.length; i++) {
    const top = topOf(state.tableau[i]);
    if (!top) continue;
    const to: PileRef = { kind: 'foundation', index: foundationIndexOf(top.suit) };
    if (canDrop(state, [top], to)) {
      return { kind: 'play', from: { kind: 'tableau', index: i }, to, count: 1 };
    }
  }
  return undefined;
}

/**
 * Whether the rest of the game is a formality: everything left can be sent
 * home in order without anything being moved out of the way first.
 *
 * Played out rather than reasoned about, as in FreeCell. A face-down card
 * stops it, which is the right answer - it is exactly the thing that could
 * still change the game.
 */
export function canAutoFinish(state: YukonState): boolean {
  if (hasWon(state)) return false;
  let cursor = state;
  for (;;) {
    const move = autoFinishMove(cursor);
    if (!move) return hasWon(cursor);
    cursor = apply(cursor, move)!.state;
  }
}
