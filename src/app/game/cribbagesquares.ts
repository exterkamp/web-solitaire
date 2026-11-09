import { rankValue } from './config';
import { Card, shuffledDeck } from './deck';
import { Move, PileRef } from './piles';

// Cribbage Squares, as rules rather than as a screen.
//
// Poker Squares' small cousin, scored at the cribbage board. Sixteen cards,
// turned one at a time, go into a four-by-four grid - each one touching a card
// already there, across, down or corner to corner - and stay where they are
// put. When the grid is full a seventeenth card is turned: the starter, which
// belongs to every hand at once. The four rows and four columns are eight
// cribbage hands, each counted with the starter, and sixty-one wins: once
// round the board, the target The Complete Book of Solitaire and Patience
// Games sets for it.

export const SIZE = 4;
export const CELL_COUNT = SIZE * SIZE;
export const TARGET = 61;

export interface CribbageSquaresState {
  // The grid, row by row: cell r * 4 + c is row r, column c.
  tableau: Card[][];
  stock: Card[];
  // The card in hand - and, once the grid is full, the starter, which sits
  // where the card in hand did and never moves.
  waste: Card[];
  moves: number;
}

export interface MoveResult {
  state: CribbageSquaresState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
}

// --- the count ------------------------------------------------------------

// What a card counts for fifteen: court cards ten, an ace one.
const pips = (card: Card) => Math.min(10, rankValue(card.rank));

function fifteens(cards: readonly Card[]): number {
  let count = 0;
  // Every combination of the cards, by bitmask: at most five of them.
  for (let mask = 1; mask < 1 << cards.length; mask++) {
    let sum = 0;
    for (let i = 0; i < cards.length; i++) if (mask & (1 << i)) sum += pips(cards[i]);
    if (sum === 15) count++;
  }
  return count * 2;
}

function pairs(cards: readonly Card[]): number {
  let count = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) if (cards[i].rank === cards[j].rank) count++;
  }
  return count * 2;
}

/**
 * The longest run of three or more, ace low, counted once for every way it
 * can be made: a double run of three - 3, 3, 4, 5 - is two runs, six points.
 */
function runs(cards: readonly Card[]): number {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(rankValue(card.rank), (counts.get(rankValue(card.rank)) ?? 0) + 1);
  let best = 0;
  for (let start = 1; start <= 13; start++) {
    if (!counts.has(start) || counts.has(start - 1)) continue;
    let length = 0;
    let ways = 1;
    while (counts.has(start + length)) {
      ways *= counts.get(start + length)!;
      length++;
    }
    if (length >= 3) best = Math.max(best, length * ways);
  }
  return best;
}

/**
 * One row or column, with the starter if it has been turned.
 *
 * Counted as it fills, the way Poker Squares is: a pair is two the moment its
 * second card lands, and a fifteen is two as soon as the cards that make it
 * are down. A flush needs all four of the hand's own cards, and his nobs
 * needs a starter to be the jack of.
 */
export function handScore(cards: readonly Card[], starter?: Card): number {
  const all = starter ? [...cards, starter] : [...cards];
  let total = fifteens(all) + pairs(all) + runs(all);
  if (cards.length === SIZE && cards.every((card) => card.suit === cards[0].suit)) {
    total += starter?.suit === cards[0].suit ? 5 : 4;
  }
  if (starter && cards.some((card) => card.rank === 'J' && card.suit === starter.suit)) total += 1;
  return total;
}

export function rowOf(state: CribbageSquaresState, row: number): Card[] {
  return Array.from({ length: SIZE }, (_, c) => state.tableau[row * SIZE + c][0]).filter(Boolean);
}

export function columnOf(state: CribbageSquaresState, column: number): Card[] {
  return Array.from({ length: SIZE }, (_, r) => state.tableau[r * SIZE + column][0]).filter(Boolean);
}

/** The starter, once the grid is full and it has been turned. */
export function starterOf(state: CribbageSquaresState): Card | undefined {
  return isFull(state) ? state.waste[0] : undefined;
}

export function score(state: CribbageSquaresState): number {
  const starter = starterOf(state);
  let total = 0;
  for (let i = 0; i < SIZE; i++) {
    total += handScore(rowOf(state, i), starter) + handScore(columnOf(state, i), starter);
  }
  // His heels: a jack turned as the starter, two points once for the deal
  // rather than once for each of the eight hands it is part of.
  if (starter?.rank === 'J') total += 2;
  return total;
}

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): CribbageSquaresState {
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

export function cloneState(state: CribbageSquaresState): CribbageSquaresState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    tableau: state.tableau.map(copy),
    stock: copy(state.stock),
    waste: copy(state.waste),
    moves: state.moves,
  };
}

// --- what is allowed ------------------------------------------------------

export const emptyCells = (state: CribbageSquaresState): number =>
  state.tableau.filter((cell) => !cell.length).length;

export const isFull = (state: CribbageSquaresState): boolean => emptyCells(state) === 0;

/**
 * Whether a cell touches a card already down - across, down or corner to
 * corner. The first card may go anywhere.
 */
export function touches(state: CribbageSquaresState, index: number): boolean {
  if (emptyCells(state) === CELL_COUNT) return true;
  const row = Math.floor(index / SIZE);
  const column = index % SIZE;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = column + dc;
      if ((dr || dc) && r >= 0 && r < SIZE && c >= 0 && c < SIZE && state.tableau[r * SIZE + c].length) return true;
    }
  }
  return false;
}

/** Only the card in hand moves, and only until the grid is full. */
export function liftable(state: CribbageSquaresState, from: PileRef, count: number): Card[] | undefined {
  if (count !== 1 || from.kind !== 'waste' || !state.waste.length || isFull(state)) return undefined;
  return [state.waste[state.waste.length - 1]];
}

/** The card in hand, into an empty cell next to one that is not. */
export function canDrop(state: CribbageSquaresState, cards: readonly Card[], to: PileRef): boolean {
  if (cards.length !== 1 || to.kind !== 'tableau' || isFull(state)) return false;
  const cell = state.tableau[to.index];
  return !!cell && !cell.length && touches(state, to.index) && state.waste[0]?.id === cards[0].id;
}

// --- making moves ---------------------------------------------------------

/** Puts the card in hand down and turns the next - the last of them the starter. */
export function apply(state: CribbageSquaresState, move: Move): MoveResult | undefined {
  if (move.kind !== 'play' || move.from.kind !== 'waste') return undefined;
  const cards = liftable(state, move.from, move.count);
  if (!cards || !canDrop(state, cards, move.to)) return undefined;

  const next = cloneState(state);
  const placed = next.waste.splice(0, 1);
  next.tableau[move.to.index].push(...placed);
  next.moves = state.moves + 1;
  const card = next.stock.pop()!;
  card.faceUp = true;
  next.waste.push(card);
  return { state: next, move, moved: placed, drawn: [card] };
}

/** A press on an empty cell puts the card in hand there, if it may go there. */
export function placeAt(state: CribbageSquaresState, at: PileRef): Move | undefined {
  const cards = liftable(state, { kind: 'waste', index: 0 }, 1);
  if (!cards || !canDrop(state, cards, at)) return undefined;
  return { kind: 'play', from: { kind: 'waste', index: 0 }, to: at, count: 1 };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: CribbageSquaresState): boolean {
  return isFull(state) && score(state) >= TARGET;
}

export function isDeadEnd(state: CribbageSquaresState): boolean {
  return isFull(state) && score(state) < TARGET;
}
