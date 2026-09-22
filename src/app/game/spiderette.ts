import { FOUNDATION_COUNT, TABLEAU_COUNT, rankValue } from './config';
import { Card, buildDeck, shuffle } from './deck';
import { Move, PileRef } from './piles';
import { completedSuit, foundationIndexOf, isSuitRun, topOf } from './card-rules';

// Spiderette, as rules rather than as a screen.
//
// Spider's game on one deck and seven columns, which is the only reason it is
// here rather than Spider: ten columns of a hundred and four cards would come
// out at about thirty-six pixels a card on a phone, and the cards are the
// game. Everything that makes Spider what it is survives the shrinking.
//
// What makes it what it is: you build down by rank and ignore suit entirely,
// but you may only pick up a run that is all one suit. So every convenient
// placement is a card buried on purpose, and the whole game is the argument
// between getting a card out of the way now and being able to move it later.
// There is no sending cards home one at a time - a suit leaves the table only
// as a finished king-to-ace run, all thirteen at once.

export const COLUMN_COUNT = TABLEAU_COUNT;

// Twenty-eight on the table in the usual staircase, and twenty-four left to
// deal: three full rows of seven and a last row of three.
const DEALT = (COLUMN_COUNT * (COLUMN_COUNT + 1)) / 2;

export interface SpideretteState {
  // Finished suits, parked where the board already knows to draw them. Cards
  // arrive here thirteen at a time and never leave.
  foundations: Card[][];
  tableau: Card[][];
  stock: Card[];
  moves: number;
}

export interface MoveResult {
  state: SpideretteState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
  flipped?: Card;
}

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): SpideretteState {
  const deck = shuffle(buildDeck(), random);
  const tableau: Card[][] = Array.from({ length: COLUMN_COUNT }, () => []);
  let next = 0;
  for (let column = 0; column < COLUMN_COUNT; column++) {
    for (let i = 0; i <= column; i++) {
      const card = deck[next++];
      // Only the last card of each column, which is the staircase you see in
      // every picture of Spider and the reason the first move is a real
      // decision rather than a search.
      card.faceUp = i === column;
      tableau[column].push(card);
    }
  }
  const stock = deck.slice(DEALT);
  for (const card of stock) card.faceUp = false;

  return {
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau,
    stock,
    moves: 0,
  };
}

export function cloneState(state: SpideretteState): SpideretteState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    foundations: state.foundations.map(copy),
    tableau: state.tableau.map(copy),
    stock: copy(state.stock),
  };
}

export function hiddenCards(state: SpideretteState): number {
  return state.tableau.reduce(
    (total, pile) => total + pile.filter((card) => !card.faceUp).length,
    0,
  );
}

// --- what is allowed ------------------------------------------------------

/**
 * The cards a move would lift: one suit, descending, all face up.
 *
 * This is the rule the game turns on. A nine of hearts on a ten of spades is
 * a legal place to put it and not a run - the nine comes away alone, and the
 * ten is under it until something moves.
 */
export function liftable(
  state: SpideretteState, from: PileRef, count: number,
): Card[] | undefined {
  if (count < 1 || from.kind !== 'tableau') return undefined;
  const pile = state.tableau[from.index];
  if (!pile || pile.length < count) return undefined;
  const index = pile.length - count;
  return isSuitRun(pile, index) ? pile.slice(index) : undefined;
}

/** Anything at all into an empty column; otherwise one rank lower, any suit. */
export function canPlaceOnTableau(card: Card, pile: readonly Card[]): boolean {
  const top = topOf(pile);
  if (!top) return true;
  return top.faceUp && rankValue(card.rank) === rankValue(top.rank) - 1;
}

export function canDrop(
  state: SpideretteState, cards: readonly Card[], to: PileRef,
): boolean {
  // Nothing is ever placed on a foundation by hand here. A suit goes home
  // when it is finished and not before, so a foundation is a display rather
  // than a destination.
  if (!cards.length || to.kind !== 'tableau') return false;
  const pile = state.tableau[to.index];
  return !!pile && canPlaceOnTableau(cards[0], pile);
}

// --- making moves ---------------------------------------------------------

export function apply(state: SpideretteState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') return applyDeal(state);

  const { from, to, count } = move;
  if (from.kind === to.kind && from.index === to.index) return undefined;
  const cards = liftable(state, from, count);
  if (!cards) return undefined;
  if (!canDrop(state, cards, to)) return undefined;

  const next = cloneState(state);
  const source = next.tableau[from.index];
  const lifted = source.splice(source.length - count, count);
  next.tableau[to.index].push(...lifted);

  const flipped = turnUp(next, from.index);
  collect(next);
  next.moves = state.moves + 1;
  return { state: next, move, moved: lifted, flipped };
}

/**
 * A row off the deck: one card, face up, onto every column.
 *
 * Spider proper refuses this while any column is empty, and that rule is left
 * out here on purpose. With seven columns and twenty-four cards in the deck,
 * enforcing it mostly produces a player who has earned an empty column and is
 * punished by being unable to deal - which is a rule doing the opposite of
 * what it was written for. The last row is three cards, because twenty-four
 * does not divide by seven, and they go to the leftmost columns.
 */
function applyDeal(state: SpideretteState): MoveResult | undefined {
  if (!state.stock.length) return undefined;
  const next = cloneState(state);
  const drawn: Card[] = [];
  for (let column = 0; column < COLUMN_COUNT && next.stock.length; column++) {
    const card = next.stock.pop()!;
    card.faceUp = true;
    next.tableau[column].push(card);
    drawn.push(card);
  }
  collect(next);
  next.moves = state.moves + 1;
  return { state: next, move: { kind: 'draw' }, drawn };
}

function turnUp(state: SpideretteState, column: number): Card | undefined {
  const uncovered = topOf(state.tableau[column]);
  if (!uncovered || uncovered.faceUp) return undefined;
  uncovered.faceUp = true;
  return uncovered;
}

/**
 * Sends any finished suit home, and turns over whatever it was sitting on.
 *
 * Automatic rather than asked for, which is the usual way this family is
 * played: a king-to-ace run in one suit can never be wanted again, so leaving
 * it on the table would only be leaving thirteen cards in the way.
 */
function collect(state: SpideretteState): void {
  for (let column = 0; column < COLUMN_COUNT; column++) {
    const pile = state.tableau[column];
    const run = completedSuit(pile);
    if (!run) continue;
    pile.splice(pile.length - run.length, run.length);
    state.foundations[foundationIndexOf(run[0].suit)] = run.map((card) => ({ ...card }));
    turnUp(state, column);
  }
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: SpideretteState): boolean {
  return state.foundations.every((pile) => pile.length === 13);
}

export function legalMoves(state: SpideretteState): Move[] {
  const moves: Move[] = [];
  state.tableau.forEach((pile, column) => {
    pile.forEach((_, index) => {
      const count = pile.length - index;
      const from: PileRef = { kind: 'tableau', index: column };
      const cards = liftable(state, from, count);
      if (!cards) return;
      for (let target = 0; target < COLUMN_COUNT; target++) {
        if (target === column) continue;
        // A whole column moved into an empty one changes nothing and would
        // mean no game was ever over.
        if (!state.tableau[target].length && count === pile.length) continue;
        const to: PileRef = { kind: 'tableau', index: target };
        if (canDrop(state, cards, to)) moves.push({ kind: 'play', from, to, count });
      }
    });
  });
  return moves;
}

export function isDeadEnd(state: SpideretteState): boolean {
  if (hasWon(state)) return false;
  return !state.stock.length && legalMoves(state).length === 0;
}

/**
 * Where a tapped handful goes.
 *
 * A same-suit continuation first, because that is the move that builds
 * something you can carry later and is almost always the one meant. Then any
 * column that will take it, preferring one with cards on it: an empty column
 * in this game is the only place a buried run can be unpacked, and spending
 * it by accident is how a hand is lost.
 */
export function autoTarget(
  state: SpideretteState, from: PileRef, count = 1,
): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards) return undefined;

  const legal: PileRef[] = [];
  for (let column = 0; column < COLUMN_COUNT; column++) {
    if (from.kind === 'tableau' && from.index === column) continue;
    const to: PileRef = { kind: 'tableau', index: column };
    if (canDrop(state, cards, to)) legal.push(to);
  }

  const suited = legal.find((to) => {
    const top = topOf(state.tableau[to.index]);
    return !!top && top.suit === cards[0].suit;
  });
  if (suited) return suited;

  const occupied = legal.find((to) => state.tableau[to.index].length);
  if (occupied) return occupied;
  // A whole column into an empty one is a change of address, not a move.
  if (from.kind === 'tableau' && count === state.tableau[from.index].length) return undefined;
  return legal[0];
}

// There is nothing to play out at the end of this one. A suit leaves the
// table the moment it is finished, so the position that would be a formality
// in Klondike - everything face up, every card one move from home - is a
// position this game has already cleared by itself. What is left is always a
// real move.
export function canAutoFinish(): boolean {
  return false;
}

export function autoFinishMove(): Move | undefined {
  return undefined;
}
