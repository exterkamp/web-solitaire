import { FOUNDATION_COUNT } from './config';
import { Card, buildDeck, shuffle } from './deck';
import { Move, PileRef } from './piles';
import {
  buildsDownInSuit,
  canPlaceOnFoundation,
  foundationIndexOf,
  isSuitRun,
  topOf,
} from './card-rules';

// Seahaven Towers, as rules rather than as a screen.
//
// FreeCell's furniture - ten columns, four cells, four foundations, nothing
// hidden - and two rule changes that turn it into a much tighter game:
// tableau piles build down in **suit** rather than in alternating colours,
// and an empty column will take a **king** and nothing else.
//
// Those two together are the whole of it. In FreeCell an empty column is the
// most valuable thing on the board, because anything can go there and it
// doubles what a run can carry. Here it is worth nothing at all unless you
// have a king for it, and a run can never be shuffled through it - so the
// only room you ever have is the cells, and the game is played almost
// entirely out of those four squares.

export const COLUMN_COUNT = 10;
export const CELL_COUNT = 4;
const COLUMN_DEPTH = 5;

export interface SeahavenState {
  // Four cells, each holding one card or none. Piles rather than
  // `Card | undefined`, as in FreeCell and for the same reason: every pile in
  // every game on this table is the same shape.
  cells: Card[][];
  foundations: Card[][];
  tableau: Card[][];
  moves: number;
}

export interface MoveResult {
  state: SeahavenState;
  move: Move;
  moved: Card[];
}

// --- dealing --------------------------------------------------------------

/**
 * Ten columns of five, and the two cards left over into the first two cells.
 *
 * Fifty into ten piles is where the deal's shape comes from; the odd two have
 * to go somewhere, and starting with two cells already occupied is the
 * handicap this game opens with.
 */
export function deal(random: () => number = Math.random): SeahavenState {
  const deck = shuffle(buildDeck(), random);
  for (const card of deck) card.faceUp = true;

  const tableau: Card[][] = Array.from({ length: COLUMN_COUNT }, (_, column) =>
    deck.slice(column * COLUMN_DEPTH, (column + 1) * COLUMN_DEPTH),
  );
  const spare = deck.slice(COLUMN_COUNT * COLUMN_DEPTH);
  const cells: Card[][] = Array.from({ length: CELL_COUNT }, (_, i) =>
    spare[i] ? [spare[i]] : [],
  );

  return {
    cells,
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau,
    moves: 0,
  };
}

export function cloneState(state: SeahavenState): SeahavenState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    cells: state.cells.map(copy),
    foundations: state.foundations.map(copy),
    tableau: state.tableau.map(copy),
  };
}

function pileOf(state: SeahavenState, ref: PileRef): Card[] | undefined {
  if (ref.kind === 'cell') return state.cells[ref.index];
  if (ref.kind === 'foundation') return state.foundations[ref.index];
  if (ref.kind === 'tableau') return state.tableau[ref.index];
  return undefined;
}

export function freeCells(state: SeahavenState): number {
  return state.cells.filter((cell) => !cell.length).length;
}

export function emptyColumns(state: SeahavenState): number {
  return state.tableau.filter((pile) => !pile.length).length;
}

/**
 * How many cards can move at once: one, plus one for every free cell.
 *
 * And **not** doubled for every empty column, which is where this parts
 * company with FreeCell. That doubling exists because a run is really moved
 * one card at a time through whatever spare room there is, and an empty
 * column in FreeCell is spare room. Here it is not: an empty column accepts
 * a king and nothing else, so it can never hold the seven of clubs you were
 * trying to shuffle out of the way. Counting it would offer moves the game
 * cannot actually make.
 */
export function maxRun(state: SeahavenState): number {
  return freeCells(state) + 1;
}

// --- what is allowed ------------------------------------------------------

/** A king starts an empty column; otherwise it is the same suit, one lower. */
export function canPlaceOnTableau(card: Card, pile: readonly Card[]): boolean {
  const top = topOf(pile);
  if (!top) return card.rank === 'K';
  return buildsDownInSuit(card, top);
}

export function liftable(
  state: SeahavenState, from: PileRef, count: number,
): Card[] | undefined {
  if (count < 1) return undefined;
  const pile = pileOf(state, from);
  if (!pile || pile.length < count) return undefined;

  // A cell or a foundation gives up its one card. How far a tableau run may
  // travel is canDrop's question rather than this one.
  if (from.kind === 'cell' || from.kind === 'foundation') {
    return count === 1 ? pile.slice(-1) : undefined;
  }
  if (from.kind !== 'tableau') return undefined;

  const index = pile.length - count;
  return isSuitRun(pile, index) ? pile.slice(index) : undefined;
}

export function canDrop(
  state: SeahavenState, cards: readonly Card[], to: PileRef,
): boolean {
  if (!cards.length) return false;

  if (to.kind === 'foundation') {
    if (cards.length !== 1) return false;
    if (to.index !== foundationIndexOf(cards[0].suit)) return false;
    return canPlaceOnFoundation(cards[0], state.foundations[to.index]);
  }
  if (to.kind === 'cell') {
    return cards.length === 1 && state.cells[to.index]?.length === 0;
  }
  if (to.kind !== 'tableau') return false;

  const pile = state.tableau[to.index];
  if (!pile) return false;
  if (!canPlaceOnTableau(cards[0], pile)) return false;
  return cards.length <= maxRun(state);
}

// --- making moves ---------------------------------------------------------

export function apply(state: SeahavenState, move: Move): MoveResult | undefined {
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
  next.moves = state.moves + 1;
  return { state: next, move, moved: lifted };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: SeahavenState): boolean {
  return state.foundations.every((pile) => pile.length === 13);
}

/**
 * Every move worth counting, for noticing when there are none.
 *
 * Moves off a foundation are left out, as everywhere else here: a card can
 * almost always be fetched back, so counting those would mean no game was
 * ever over.
 */
export function legalMoves(state: SeahavenState): Move[] {
  const moves: Move[] = [];
  const targets: PileRef[] = [
    ...state.foundations.map((_, i) => ({ kind: 'foundation', index: i }) as PileRef),
    ...state.tableau.map((_, i) => ({ kind: 'tableau', index: i }) as PileRef),
    ...state.cells.map((_, i) => ({ kind: 'cell', index: i }) as PileRef),
  ];

  const consider = (from: PileRef, count: number) => {
    const cards = liftable(state, from, count);
    if (!cards) return;
    for (const to of targets) {
      if (to.kind === from.kind && to.index === from.index) continue;
      // Moving a whole column into an empty one is a change of address.
      if (
        to.kind === 'tableau' && from.kind === 'tableau' &&
        !state.tableau[to.index].length && count === state.tableau[from.index].length
      ) continue;
      if (canDrop(state, cards, to)) moves.push({ kind: 'play', from, to, count });
    }
  };

  state.tableau.forEach((pile, column) => {
    for (let count = 1; count <= pile.length; count++) {
      consider({ kind: 'tableau', index: column }, count);
    }
  });
  state.cells.forEach((_, i) => consider({ kind: 'cell', index: i }, 1));
  return moves;
}

export function isDeadEnd(state: SeahavenState): boolean {
  return !hasWon(state) && legalMoves(state).length === 0;
}

/**
 * Where a tapped card goes: home if it can, then a column that will take it,
 * and only then a cell.
 *
 * A cell last, and that ordering matters more here than in FreeCell. The
 * cells are the only room this game has, so filling one is a real cost - but
 * it is also the move you make constantly, because a suit-built column
 * refuses almost everything.
 */
export function autoTarget(
  state: SeahavenState, from: PileRef, count = 1,
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
export function autoFinishMove(state: SeahavenState): Move | undefined {
  const fromPile = (ref: PileRef, pile: readonly Card[]): Move | undefined => {
    const top = topOf(pile);
    if (!top) return undefined;
    const to: PileRef = { kind: 'foundation', index: foundationIndexOf(top.suit) };
    return canDrop(state, [top], to) ? { kind: 'play', from: ref, to, count: 1 } : undefined;
  };

  for (let i = 0; i < state.tableau.length; i++) {
    const move = fromPile({ kind: 'tableau', index: i }, state.tableau[i]);
    if (move) return move;
  }
  for (let i = 0; i < state.cells.length; i++) {
    const move = fromPile({ kind: 'cell', index: i }, state.cells[i]);
    if (move) return move;
  }
  return undefined;
}

/**
 * Whether the rest of the game is a formality: everything left can be sent
 * home in order without anything being moved out of the way first.
 *
 * Played out rather than reasoned about, as in FreeCell. Nothing is hidden in
 * this game, so the answer is always knowable.
 */
export function canAutoFinish(state: SeahavenState): boolean {
  if (hasWon(state)) return false;
  let cursor = state;
  for (;;) {
    const move = autoFinishMove(cursor);
    if (!move) return hasWon(cursor);
    cursor = apply(cursor, move)!.state;
  }
}
