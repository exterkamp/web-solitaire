import { FOUNDATION_COUNT } from './config';
import { Card, shuffledDeck } from './deck';
import { PileRef } from './piles';
import { buildsDown, canPlaceOnFoundation, foundationIndexOf, isRun, topOf } from './card-rules';

// FreeCell, as rules rather than as a screen. Same arrangement as
// klondike.ts, and for the same reasons: pure functions over a state, every
// move answering with a new one, nothing here that knows a screen exists.
//
// It is the other game in the box rather than a variant of the first one.
// Klondike deals two thirds of the deck face down and then asks you to be
// lucky; FreeCell puts all fifty-two on the table and asks you to be right.
// Of the thirty-two thousand deals Microsoft shipped, every one is solvable
// but #11982 - so a lost game here is a game you lost, which is a different
// feeling to a game that was never winnable.

// Eight columns, four cells, four foundations.
export const COLUMN_COUNT = 8;
export const CELL_COUNT = 4;

export interface FreeCellState {
  // Four cells, each holding one card or none.
  //
  // Held as piles rather than as `Card | undefined` so that every pile in
  // this game is the same shape - an array of cards, bottom first - which is
  // what lets the board draw, drag and drop them without a special case for
  // the one kind of pile that can only ever hold one thing. The invariant is
  // that none of these is ever longer than 1, and canDrop is where it is
  // kept.
  cells: Card[][];
  // One per suit, in SUITS order.
  foundations: Card[][];
  tableau: Card[][];
  moves: number;
}

export type Move = { kind: 'play'; from: PileRef; to: PileRef; count: number };

export interface MoveResult {
  state: FreeCellState;
  move: Move;
  moved: Card[];
}

// --- dealing --------------------------------------------------------------

/**
 * A fresh deal: fifty-two cards face up across eight columns, four of seven
 * and four of six, and nothing hidden anywhere.
 */
export function deal(random: () => number = Math.random): FreeCellState {
  const deck = shuffledDeck(random);
  const tableau: Card[][] = Array.from({ length: COLUMN_COUNT }, () => []);
  // Round robin, the way a person deals: one card to each column, then round
  // again. Fifty-two over eight leaves the first four columns a card longer,
  // which is the standard layout and falls out of dealing this way rather
  // than having to be arranged.
  deck.forEach((card, i) => {
    card.faceUp = true;
    tableau[i % COLUMN_COUNT].push(card);
  });
  return {
    cells: Array.from({ length: CELL_COUNT }, () => []),
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau,
    moves: 0,
  };
}

export function cloneState(state: FreeCellState): FreeCellState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    cells: state.cells.map(copy),
    foundations: state.foundations.map(copy),
    tableau: state.tableau.map(copy),
  };
}

function pileOf(state: FreeCellState, ref: PileRef): Card[] | undefined {
  switch (ref.kind) {
    case 'cell':
      return state.cells[ref.index];
    case 'foundation':
      return state.foundations[ref.index];
    case 'tableau':
      return state.tableau[ref.index];
    default:
      // Klondike's stock and waste. There is no deck in this game: every card
      // is on the table from the first move, which is the whole of what makes
      // it a puzzle rather than a gamble.
      return undefined;
  }
}

// --- how much can move at once --------------------------------------------

export function freeCells(state: FreeCellState): number {
  return state.cells.filter((cell) => cell.length === 0).length;
}

export function emptyColumns(state: FreeCellState): number {
  return state.tableau.filter((pile) => pile.length === 0).length;
}

/**
 * How many cards can be moved as one run.
 *
 * FreeCell only ever moves one card at a time; a run of several is shorthand
 * for doing that repeatedly through the cells and empty columns, and this is
 * how many that shorthand can manage: one card, plus one for each free cell,
 * doubled for every empty column it can stage through.
 *
 * `toEmpty` takes a column out of that count, because a run being moved *to*
 * an empty column cannot also be staged through it.
 */
export function maxRun(state: FreeCellState, toEmpty = false): number {
  const columns = Math.max(0, emptyColumns(state) - (toEmpty ? 1 : 0));
  return (freeCells(state) + 1) * 2 ** columns;
}

// --- what is allowed ------------------------------------------------------

/** An empty column takes anything, and an occupied one builds down. */
export function canPlaceOnTableau(card: Card, pile: readonly Card[]): boolean {
  const top = topOf(pile);
  return top ? buildsDown(card, top) : true;
}

/**
 * The cards a move would lift, or undefined if nothing can be lifted there.
 *
 * A cell and a foundation give up one card; a column gives up any run from
 * its top. How far that run may travel is canDrop's question, not this one -
 * it depends on where it is going, and on how much room there is to get it
 * there.
 */
export function liftable(
  state: FreeCellState, from: PileRef, count: number,
): Card[] | undefined {
  if (count < 1) return undefined;
  const pile = pileOf(state, from);
  if (!pile || pile.length < count) return undefined;

  if (from.kind === 'cell' || from.kind === 'foundation') {
    return count === 1 ? pile.slice(-1) : undefined;
  }
  const index = pile.length - count;
  return isRun(pile, index) ? pile.slice(index) : undefined;
}

export function canDrop(
  state: FreeCellState, cards: readonly Card[], to: PileRef,
): boolean {
  if (!cards.length) return false;

  if (to.kind === 'cell') {
    // One card, and only into a cell that is standing empty. This is where
    // the "no cell is ever taller than one card" invariant is kept.
    return cards.length === 1 && state.cells[to.index]?.length === 0;
  }
  if (to.kind === 'foundation') {
    if (cards.length !== 1) return false;
    if (to.index !== foundationIndexOf(cards[0].suit)) return false;
    return canPlaceOnFoundation(cards[0], state.foundations[to.index]);
  }
  if (to.kind !== 'tableau') return false;

  const pile = state.tableau[to.index];
  if (!pile) return false;
  if (!canPlaceOnTableau(cards[0], pile)) return false;
  return cards.length <= maxRun(state, pile.length === 0);
}

// --- making moves ---------------------------------------------------------

export function apply(state: FreeCellState, move: Move): MoveResult | undefined {
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
  next.moves = state.moves + 1;
  return { state: next, move, moved: lifted };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: FreeCellState): boolean {
  return state.foundations.every((pile) => pile.length === 13);
}

/** Every pile a card could be lifted from, with how many it would lift. */
function sources(state: FreeCellState): { ref: PileRef; count: number }[] {
  const found: { ref: PileRef; count: number }[] = [];
  state.cells.forEach((cell, i) => {
    if (cell.length) found.push({ ref: { kind: 'cell', index: i }, count: 1 });
  });
  state.tableau.forEach((pile, i) => {
    for (let index = 0; index < pile.length; index++) {
      if (isRun(pile, index)) found.push({ ref: { kind: 'tableau', index: i }, count: pile.length - index });
    }
  });
  return found;
}

/**
 * Every move available, for noticing when there are none.
 *
 * Unlike Klondike's, this counts moves that only shuffle cards about - a card
 * into a cell, a run onto another column. There is no deck to hide behind
 * here, so if a position has any move at all the player is not stuck; they
 * are just losing.
 *
 * Taking a card back off a foundation is not a move this game has. Windows
 * FreeCell did not allow it and neither does this, which makes "no moves
 * left" mean exactly what it says.
 */
export function legalMoves(state: FreeCellState): Move[] {
  const moves: Move[] = [];
  const targets: PileRef[] = [
    ...state.cells.map((_, i) => ({ kind: 'cell', index: i }) as PileRef),
    ...state.foundations.map((_, i) => ({ kind: 'foundation', index: i }) as PileRef),
    ...state.tableau.map((_, i) => ({ kind: 'tableau', index: i }) as PileRef),
  ];

  for (const source of sources(state)) {
    const cards = liftable(state, source.ref, source.count);
    if (!cards) continue;
    for (const to of targets) {
      if (source.ref.kind === to.kind && source.ref.index === to.index) continue;
      // Moving a whole column to an empty one is legal and is not progress,
      // and counting it would mean a game was never quite over.
      if (
        to.kind === 'tableau' &&
        !state.tableau[to.index].length &&
        source.ref.kind === 'tableau' &&
        source.count === state.tableau[source.ref.index].length
      ) {
        continue;
      }
      if (canDrop(state, cards, to)) moves.push({ kind: 'play', from: source.ref, to, count: source.count });
    }
  }
  return moves;
}

export function isDeadEnd(state: FreeCellState): boolean {
  return !hasWon(state) && legalMoves(state).length === 0;
}

/**
 * Where a card goes when it is tapped rather than dragged.
 *
 * Home first, then a column that will take it, then a free cell. The cell is
 * last on purpose: it is the one move that costs you something, and a tap
 * should not spend a cell while the table will still take the card.
 */
export function autoTarget(
  state: FreeCellState, from: PileRef, count = 1,
): PileRef | undefined {
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
  // Not out of one empty column and into another, which achieves nothing and
  // is the easiest tap to make by accident.
  const wholeColumn = from.kind === 'tableau' && count === state.tableau[from.index].length;
  if (empties.length && !wholeColumn) return empties[0];

  if (cards.length === 1 && from.kind !== 'cell') {
    for (let i = 0; i < state.cells.length; i++) {
      const to: PileRef = { kind: 'cell', index: i };
      if (canDrop(state, cards, to)) return to;
    }
  }
  return undefined;
}

/** The next card that can go home, from a cell or off the top of a column. */
export function autoFinishMove(state: FreeCellState): Move | undefined {
  const tryFrom = (ref: PileRef, pile: readonly Card[]): Move | undefined => {
    const top = topOf(pile);
    if (!top) return undefined;
    const to: PileRef = { kind: 'foundation', index: foundationIndexOf(top.suit) };
    return canDrop(state, [top], to) ? { kind: 'play', from: ref, to, count: 1 } : undefined;
  };

  for (let i = 0; i < state.cells.length; i++) {
    const move = tryFrom({ kind: 'cell', index: i }, state.cells[i]);
    if (move) return move;
  }
  for (let i = 0; i < state.tableau.length; i++) {
    const move = tryFrom({ kind: 'tableau', index: i }, state.tableau[i]);
    if (move) return move;
  }
  return undefined;
}

/**
 * Whether the rest of the game is a formality: every remaining card can be
 * sent home in order, without anything having to be moved out of the way
 * first.
 *
 * Asked by playing it out rather than by reasoning about it. Klondike can
 * answer this by looking - nothing face down means nothing unknown - but
 * FreeCell has nothing face down at any point, so the question is not what
 * is hidden but whether the columns happen to be in a workable order. Fifty
 * two steps of a cheap simulation is a straight answer to that.
 */
export function canAutoFinish(state: FreeCellState): boolean {
  if (hasWon(state)) return false;
  let cursor = state;
  for (;;) {
    const move = autoFinishMove(cursor);
    if (!move) return hasWon(cursor);
    cursor = apply(cursor, move)!.state;
  }
}
