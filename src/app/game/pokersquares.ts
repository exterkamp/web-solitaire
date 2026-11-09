import { rankValue } from './config';
import { Card, shuffledDeck } from './deck';
import { Move, PileRef } from './piles';

// Poker Squares, as rules rather than as a screen.
//
// The one game here played for points rather than to clear the table. The
// deck is turned a card at a time and every card goes into a five-by-five
// grid, anywhere it is empty, where it stays: nothing in this game ever moves
// twice. After twenty-five cards the grid is full, and its five rows and five
// columns are ten poker hands, each scored on the American table below.
//
// A hand is won at two hundred, the mark Morehead and Mott-Smith set for it.
// Every card is seen before it is placed and none is seen before that, so
// the whole game is deciding where the card in your hand does the least
// harm to the hands it might still make, twenty-five times - and the last
// few are the ones that hurt.

export const SIZE = 5;
export const CELL_COUNT = SIZE * SIZE;
/** The score a hand is won at, on the American table. */
export const TARGET = 200;

export interface PokerSquaresState {
  // The grid, row by row: cell r * 5 + c is row r, column c. Each is empty
  // or holds one card.
  tableau: Card[][];
  // The rest of the deck, face down. Twenty-seven of it are never turned.
  stock: Card[];
  // The card in hand, waiting for a cell: one, until the grid is full.
  waste: Card[];
  moves: number;
}

export interface MoveResult {
  state: PokerSquaresState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
}

// --- the hands ------------------------------------------------------------

export type HandName =
  | 'royal flush' | 'straight flush' | 'four of a kind' | 'full house' | 'flush'
  | 'straight' | 'three of a kind' | 'two pair' | 'pair' | 'nothing';

/** The American table, which is the one the two-hundred mark is set against. */
export const HAND_POINTS: Record<HandName, number> = {
  'royal flush': 100,
  'straight flush': 75,
  'four of a kind': 50,
  'full house': 25,
  flush: 20,
  straight: 15,
  'three of a kind': 10,
  'two pair': 5,
  pair: 2,
  nothing: 0,
};

/** Whether five distinct values run in sequence, the ace either end. */
function isStraight(values: number[]): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  if (new Set(sorted).size !== SIZE) return false;
  // Ten, jack, queen, king, ace: the ace counted high.
  if (sorted.join() === '1,10,11,12,13') return true;
  return sorted[SIZE - 1] - sorted[0] === SIZE - 1;
}

/**
 * What a row or column is worth, as far as it has got.
 *
 * Scored as it fills rather than only once it is full: a pair is a pair the
 * moment its second card lands, and a running total that only moved on the
 * fifth card of each line would say nothing about how the hand is going.
 * Straights and flushes need all five cards, so they arrive on the fifth.
 */
export function handOf(cards: readonly Card[]): HandName {
  const values = cards.map((card) => rankValue(card.rank));
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sizes = [...counts.values()].sort((a, b) => b - a);

  if (cards.length === SIZE) {
    const flush = cards.every((card) => card.suit === cards[0].suit);
    const straight = isStraight(values);
    if (flush && straight) return values.includes(1) && values.includes(13) ? 'royal flush' : 'straight flush';
    if (sizes[0] === 4) return 'four of a kind';
    if (sizes[0] === 3 && sizes[1] === 2) return 'full house';
    if (flush) return 'flush';
    if (straight) return 'straight';
  } else if (sizes[0] === 4) {
    return 'four of a kind';
  }
  if (sizes[0] === 3) return 'three of a kind';
  if (sizes[0] === 2 && sizes[1] === 2) return 'two pair';
  if (sizes[0] === 2) return 'pair';
  return 'nothing';
}

/** The cards in a row, left to right, leaving out its empty cells. */
export function rowOf(state: PokerSquaresState, row: number): Card[] {
  return Array.from({ length: SIZE }, (_, c) => state.tableau[row * SIZE + c][0]).filter(Boolean);
}

/** The cards in a column, top to bottom, leaving out its empty cells. */
export function columnOf(state: PokerSquaresState, column: number): Card[] {
  return Array.from({ length: SIZE }, (_, r) => state.tableau[r * SIZE + column][0]).filter(Boolean);
}

/** The ten lines, rows first, as the score adds them up. */
export function lines(state: PokerSquaresState): Card[][] {
  return [
    ...Array.from({ length: SIZE }, (_, r) => rowOf(state, r)),
    ...Array.from({ length: SIZE }, (_, c) => columnOf(state, c)),
  ];
}

export function score(state: PokerSquaresState): number {
  return lines(state).reduce((total, line) => total + HAND_POINTS[handOf(line)], 0);
}

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): PokerSquaresState {
  const deck = shuffledDeck(random);
  for (const card of deck) card.faceUp = false;
  const first = deck.pop()!;
  first.faceUp = true;
  return {
    tableau: Array.from({ length: CELL_COUNT }, () => []),
    stock: deck,
    waste: [first],
    moves: 0,
  };
}

export function cloneState(state: PokerSquaresState): PokerSquaresState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    tableau: state.tableau.map(copy),
    stock: copy(state.stock),
    waste: copy(state.waste),
    moves: state.moves,
  };
}

// --- what is allowed ------------------------------------------------------

export const emptyCells = (state: PokerSquaresState): number =>
  state.tableau.filter((cell) => !cell.length).length;

/** Only the card in hand moves. Once it is in the grid it is there for good. */
export function liftable(state: PokerSquaresState, from: PileRef, count: number): Card[] | undefined {
  if (count !== 1 || from.kind !== 'waste' || !state.waste.length) return undefined;
  return [state.waste[state.waste.length - 1]];
}

/** The card in hand, into any empty cell. */
export function canDrop(state: PokerSquaresState, cards: readonly Card[], to: PileRef): boolean {
  if (cards.length !== 1 || to.kind !== 'tableau') return false;
  const cell = state.tableau[to.index];
  return !!cell && !cell.length && state.waste[state.waste.length - 1]?.id === cards[0].id;
}

// --- making moves ---------------------------------------------------------

/**
 * Puts the card in hand into a cell, and turns the next one - unless that
 * was the twenty-fifth, and the grid is full.
 */
export function apply(state: PokerSquaresState, move: Move): MoveResult | undefined {
  if (move.kind !== 'play' || move.from.kind !== 'waste') return undefined;
  const cards = liftable(state, move.from, move.count);
  if (!cards || !canDrop(state, cards, move.to)) return undefined;

  const next = cloneState(state);
  const placed = next.waste.splice(0, 1);
  next.tableau[move.to.index].push(...placed);
  next.moves = state.moves + 1;
  let drawn: Card[] | undefined;
  if (emptyCells(next) && next.stock.length) {
    const card = next.stock.pop()!;
    card.faceUp = true;
    next.waste.push(card);
    drawn = [card];
  }
  return { state: next, move, moved: placed, drawn };
}

/**
 * A press on an empty cell: the card in hand goes there. The quickest way to
 * play this game, and the only one with no choice left for the board to
 * guess at - you pressed where you wanted it.
 */
export function placeAt(state: PokerSquaresState, at: PileRef): Move | undefined {
  const cards = liftable(state, { kind: 'waste', index: 0 }, 1);
  if (!cards || !canDrop(state, cards, at)) return undefined;
  return { kind: 'play', from: { kind: 'waste', index: 0 }, to: at, count: 1 };
}

// --- reading the board ----------------------------------------------------

export const isFull = (state: PokerSquaresState): boolean => emptyCells(state) === 0;

export function hasWon(state: PokerSquaresState): boolean {
  return isFull(state) && score(state) >= TARGET;
}

/** The hand is over short of the mark: the grid is full and nothing moves. */
export function isDeadEnd(state: PokerSquaresState): boolean {
  return isFull(state) && score(state) < TARGET;
}
