import { Card, buildDeck, shuffle } from './deck';
import { Move, PileRef } from './piles';
import { isNeighbourWrapping, topOf } from './card-rules';

// TriPeaks, as rules rather than as a screen.
//
// The odd one out in this collection, and that is why it is here. Klondike,
// FreeCell and Yukon are the same game wearing three hats: build down in
// alternating colours, send cards home in suit, think three moves ahead. This
// one has no foundations, no building and nothing to arrange. Twenty-eight
// cards are stacked in three peaks, one card is face up beside the deck, and
// any card you can see whose rank is one either side of that card can be
// taken - over and over, as fast as you can spot them, until you cannot.
//
// It is a game of noticing rather than planning, it takes two minutes, and it
// is the one to play standing up.

// The peaks, in half-card units across.
//
// Three triangles of six, overlapping a shared base row of ten. The spacing
// is the classic one and it is what makes the shape work: each row is offset
// half a card from the one below, so a card is covered by exactly the two
// beneath it, and the pattern reads as three peaks rather than a wall.
//
//        x:  0 1 2 3 4 5 6 7 8 9 ...
//   row 0:        *         *          *
//   row 1:      *   *     *   *      *   *
//   row 2:    *   *   * *   *   *  *   *   *
//   row 3:  * * * * * * * * * * * * * * * * * * *
const ROW_X: number[][] = [
  [3, 9, 15],
  [2, 4, 8, 10, 14, 16],
  [1, 3, 5, 7, 9, 11, 13, 15, 17],
  [0, 2, 4, 6, 8, 10, 12, 14, 16, 18],
];

/** Where each of the twenty-eight board positions sits, in half-card units. */
export const POSITIONS: { row: number; x: number }[] = ROW_X.flatMap((xs, row) =>
  xs.map((x) => ({ row, x })),
);

export const BOARD_SIZE = POSITIONS.length;

/**
 * Which positions cover each position - the two below it, half a card to
 * either side.
 *
 * Worked out from the geometry rather than written down, because a
 * hand-written table of fifty-six numbers is a table with a mistake in it,
 * and the mistake would be a card that can never be taken.
 */
export const COVERED_BY: number[][] = POSITIONS.map((pos, i) =>
  POSITIONS.map((other, j) => ({ other, j }))
    .filter(({ other }) => other.row === pos.row + 1 && Math.abs(other.x - pos.x) === 1)
    .map(({ j }) => j)
    .filter((j) => j !== i),
);

export interface TriPeaksState {
  // Twenty-eight positions, each holding its card until it is taken.
  //
  // Piles of nought or one rather than `Card | undefined`, so that every pile
  // in every game on this table is the same shape and the board can draw them
  // all the same way.
  board: Card[][];
  stock: Card[];
  waste: Card[];
  score: number;
  // How many cards have come off the peaks since the last time the deck was
  // turned. The whole of the scoring, and the whole of the tension.
  run: number;
  moves: number;
}

export interface MoveResult {
  state: TriPeaksState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
  flipped?: Card;
  points: number;
}

// Each card taken scores the length of the run it is part of: the first is
// worth one, the second two, and a run of ten is worth fifty-five. Turning
// the deck ends the run and is what the game costs you.
//
// No time bonus and no penalty for turning the deck. The run is enough: it
// already makes the difference between playing well and playing at all, and
// a second number pulling the other way would just be noise.
export const PEAK_BONUS = 15;

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): TriPeaksState {
  const deck = shuffle(buildDeck(), random);
  const board: Card[][] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const card = deck[i];
    // Only the base row starts face up. Everything above it is turned over as
    // the cards covering it are taken, which is most of what there is to look
    // forward to.
    card.faceUp = POSITIONS[i].row === ROW_X.length - 1;
    board.push([card]);
  }

  const rest = deck.slice(BOARD_SIZE);
  // One card face up beside the deck to start from.
  const first = rest.pop()!;
  first.faceUp = true;
  for (const card of rest) card.faceUp = false;

  return { board, stock: rest, waste: [first], score: 0, run: 0, moves: 0 };
}

export function cloneState(state: TriPeaksState): TriPeaksState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    board: state.board.map(copy),
    stock: copy(state.stock),
    waste: copy(state.waste),
  };
}

// --- what is allowed ------------------------------------------------------

/** Whether a position has been cleared of the cards that covered it. */
export function isUncovered(state: TriPeaksState, index: number): boolean {
  return COVERED_BY[index].every((covering) => state.board[covering].length === 0);
}

/**
 * Whether two ranks are neighbours, going round the corner.
 *
 * An ace follows a king and a king follows an ace: the sequence is a ring,
 * not a line. Forgetting that is the difference between a game that ends
 * halfway and one that ends. Shared with Black Hole, which turns on the same
 * rule - see card-rules.ts.
 */
export const isNeighbour = isNeighbourWrapping;

export function liftable(
  state: TriPeaksState, from: PileRef, count: number,
): Card[] | undefined {
  if (count !== 1) return undefined;
  // A board position, which is the only place a card can be taken from. The
  // waste is where cards go, and the deck is turned rather than played from.
  if (from.kind !== 'tableau') return undefined;
  const pile = state.board[from.index];
  if (!pile?.length) return undefined;
  if (!pile[0].faceUp || !isUncovered(state, from.index)) return undefined;
  return pile.slice();
}

export function canDrop(
  state: TriPeaksState, cards: readonly Card[], to: PileRef,
): boolean {
  if (cards.length !== 1 || to.kind !== 'waste') return false;
  const top = topOf(state.waste);
  return !!top && isNeighbour(cards[0], top);
}

// --- making moves ---------------------------------------------------------

export function apply(state: TriPeaksState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') return applyDraw(state);

  const cards = liftable(state, move.from, move.count);
  if (!cards) return undefined;
  if (!canDrop(state, cards, move.to)) return undefined;

  const next = cloneState(state);
  const taken = next.board[move.from.index].pop()!;
  next.waste.push(taken);

  // The run, which is the whole of the scoring: the tenth card in a row is
  // worth ten times what the first one was.
  next.run = state.run + 1;
  let points = next.run;

  // Anything this uncovered, turned over.
  let flipped: Card | undefined;
  for (const other of COVERED_BY.flatMap((covered, i) => (covered.includes(move.from.index) ? [i] : []))) {
    const pile = next.board[other];
    if (pile.length && !pile[0].faceUp && isUncovered(next, other)) {
      pile[0].faceUp = true;
      flipped = pile[0];
    }
  }

  // And a peak cleared is worth something on its own - it is the thing the
  // whole board is arranged around.
  if (clearedAPeak(state, next)) points += PEAK_BONUS;

  next.score = state.score + points;
  next.moves = state.moves + 1;
  return { state: next, move, moved: [taken], flipped, points };
}

// Whether this move took the last card of one of the three peaks. The peaks
// are the first three positions - one per triangle - so a peak is cleared
// exactly when one of those becomes empty.
function clearedAPeak(before: TriPeaksState, after: TriPeaksState): boolean {
  return ROW_X[0].some((_, peak) => before.board[peak].length > 0 && after.board[peak].length === 0);
}

function applyDraw(state: TriPeaksState): MoveResult | undefined {
  if (!state.stock.length) return undefined;
  const next = cloneState(state);
  const card = next.stock.pop()!;
  card.faceUp = true;
  next.waste.push(card);
  // The run ends here. Turning the deck is the admission that you cannot see
  // a move, and it is the only thing in this game that costs you anything.
  next.run = 0;
  next.moves = state.moves + 1;
  return { state: next, move: { kind: 'draw' }, drawn: [card], points: 0 };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: TriPeaksState): boolean {
  return state.board.every((pile) => pile.length === 0);
}

export function cardsLeft(state: TriPeaksState): number {
  return state.board.reduce((total, pile) => total + pile.length, 0);
}

/** Every card that can be taken right now. */
export function legalMoves(state: TriPeaksState): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const from: PileRef = { kind: 'tableau', index: i };
    const cards = liftable(state, from, 1);
    if (cards && canDrop(state, cards, { kind: 'waste', index: 0 })) {
      moves.push({ kind: 'play', from, to: { kind: 'waste', index: 0 }, count: 1 });
    }
  }
  return moves;
}

/**
 * Whether the game is over: nothing on the peaks can be taken and there is
 * nothing left to turn.
 *
 * Simpler than Klondike's, which has to walk a deck that comes round again.
 * This deck only goes one way, so when it is empty and nothing fits, that is
 * the end of it.
 */
export function isDeadEnd(state: TriPeaksState): boolean {
  if (hasWon(state)) return false;
  return state.stock.length === 0 && legalMoves(state).length === 0;
}

/** Where a tapped card goes: onto the waste, if it will have it. */
export function autoTarget(state: TriPeaksState, from: PileRef, count = 1): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards) return undefined;
  const waste: PileRef = { kind: 'waste', index: 0 };
  return canDrop(state, cards, waste) ? waste : undefined;
}

// There is no finish to play out here: a game is either still going or it is
// not, and the cards come off one at a time by hand. The board asks every
// game these two questions, and this is the honest answer to both.
export function canAutoFinish(): boolean {
  return false;
}

export function autoFinishMove(): Move | undefined {
  return undefined;
}
