import { Rank, rankValue } from './config';
import { Card, buildDeck, shuffle } from './deck';
import { Move, PileRef } from './piles';
import { topOf } from './card-rules';

// Aces Up, as rules rather than as a screen.
//
// Four columns, four cards at a time off the deck, and one rule: if two cards
// showing are the same suit, the lower one is thrown away. Play until the
// deck is gone, and win if the only four cards left are the four aces - which
// happens about one hand in twenty, and is the shortest, meanest game here.
//
// The only choice in it is what to do with an empty column, because a card
// moved into one uncovers whatever was underneath. That is the entire game,
// and it is worth stating how small it is: most hands you will lose while
// playing perfectly. It is on the menu as the one you can finish at a bus
// stop.

export const COLUMN_COUNT = 4;

// An ace beats a king here rather than starting the count, which is where the
// game gets its name and its difficulty: the aces cannot be thrown away, so
// every one that turns up early is a column half blocked for the rest of the
// hand.
function highValue(rank: Rank): number {
  return rank === 'A' ? 14 : rankValue(rank);
}

export interface AcesUpState {
  // Everything thrown away, in one heap. Kept rather than deleted so the
  // board has somewhere to fly the cards to, and so undo has something to
  // fly them back from.
  discard: Card[];
  tableau: Card[][];
  stock: Card[];
  moves: number;
}

export interface MoveResult {
  state: AcesUpState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
}

export const DISCARD: PileRef = { kind: 'foundation', index: 0 };

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): AcesUpState {
  const deck = shuffle(buildDeck(), random);
  const tableau: Card[][] = Array.from({ length: COLUMN_COUNT }, () => []);
  for (let i = 0; i < COLUMN_COUNT; i++) {
    const card = deck[i];
    card.faceUp = true;
    tableau[i].push(card);
  }
  const stock = deck.slice(COLUMN_COUNT);
  for (const card of stock) card.faceUp = false;
  return { discard: [], tableau, stock, moves: 0 };
}

export function cloneState(state: AcesUpState): AcesUpState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    discard: copy(state.discard),
    tableau: state.tableau.map(copy),
    stock: copy(state.stock),
  };
}

export function cardsLeft(state: AcesUpState): number {
  return state.tableau.reduce((total, pile) => total + pile.length, 0);
}

// --- what is allowed ------------------------------------------------------

export function liftable(state: AcesUpState, from: PileRef, count: number): Card[] | undefined {
  if (count !== 1 || from.kind !== 'tableau') return undefined;
  const pile = state.tableau[from.index];
  return pile?.length ? pile.slice(-1) : undefined;
}

/** Whether some other column is showing a higher card of the same suit. */
export function beaten(state: AcesUpState, card: Card, column: number): boolean {
  return state.tableau.some((pile, i) => {
    if (i === column) return false;
    const top = topOf(pile);
    return !!top && top.suit === card.suit && highValue(top.rank) > highValue(card.rank);
  });
}

export function canDrop(
  state: AcesUpState, cards: readonly Card[], to: PileRef, from?: PileRef,
): boolean {
  if (cards.length !== 1) return false;

  if (to.kind === 'foundation') {
    // Thrown away, if something of its suit beats it. Which column it came
    // from matters: a card cannot beat itself, and without knowing where it
    // started this would say a card showing alone in its suit can be
    // discarded.
    const column = from?.kind === 'tableau' ? from.index : columnOf(state, cards[0]);
    return column !== undefined && beaten(state, cards[0], column);
  }
  if (to.kind !== 'tableau') return false;
  // Into an empty column, and nowhere else. There is no building in this
  // game and nothing is ever placed on anything.
  return state.tableau[to.index]?.length === 0;
}

function columnOf(state: AcesUpState, card: Card): number | undefined {
  const found = state.tableau.findIndex((pile) => topOf(pile)?.id === card.id);
  return found < 0 ? undefined : found;
}

// --- making moves ---------------------------------------------------------

export function apply(state: AcesUpState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') return applyDraw(state);

  const { from, to, count } = move;
  if (from.kind === to.kind && from.index === to.index) return undefined;
  const cards = liftable(state, from, count);
  if (!cards) return undefined;
  if (!canDrop(state, cards, to, from)) return undefined;

  const next = cloneState(state);
  const card = next.tableau[from.index].pop()!;
  if (to.kind === 'foundation') next.discard.push(card);
  else next.tableau[to.index].push(card);

  next.moves = state.moves + 1;
  return { state: next, move, moved: [card] };
}

/**
 * Four cards off the deck, one onto each column - including a column that is
 * empty.
 *
 * That last part is the rule people misremember, and it is what makes an
 * empty column worth something only for as long as you leave the deck alone.
 */
function applyDraw(state: AcesUpState): MoveResult | undefined {
  if (!state.stock.length) return undefined;
  const next = cloneState(state);
  const drawn: Card[] = [];
  for (let column = 0; column < COLUMN_COUNT && next.stock.length; column++) {
    const card = next.stock.pop()!;
    card.faceUp = true;
    next.tableau[column].push(card);
    drawn.push(card);
  }
  next.moves = state.moves + 1;
  return { state: next, move: { kind: 'draw' }, drawn };
}

// --- reading the board ----------------------------------------------------

/** Won when the deck is gone and the only four cards left are the aces. */
export function hasWon(state: AcesUpState): boolean {
  if (state.stock.length) return false;
  const left = state.tableau.flat();
  return left.length === COLUMN_COUNT && left.every((card) => card.rank === 'A');
}

export function legalMoves(state: AcesUpState): Move[] {
  const moves: Move[] = [];
  state.tableau.forEach((pile, column) => {
    const top = topOf(pile);
    if (!top) return;
    const from: PileRef = { kind: 'tableau', index: column };
    if (beaten(state, top, column)) moves.push({ kind: 'play', from, to: DISCARD, count: 1 });
    // Moving the only card in a column to another empty one uncovers
    // nothing, so it is not a move in any sense that matters here.
    if (pile.length < 2) return;
    state.tableau.forEach((other, target) => {
      if (target !== column && !other.length) {
        moves.push({ kind: 'play', from, to: { kind: 'tableau', index: target }, count: 1 });
      }
    });
  });
  return moves;
}

export function isDeadEnd(state: AcesUpState): boolean {
  if (hasWon(state)) return false;
  return !state.stock.length && legalMoves(state).length === 0;
}

/**
 * Where a tapped card goes: thrown away if something beats it, and otherwise
 * into an empty column if there is one and there is anything underneath it.
 */
export function autoTarget(state: AcesUpState, from: PileRef, count = 1): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards || from.kind !== 'tableau') return undefined;
  if (beaten(state, cards[0], from.index)) return DISCARD;
  if (state.tableau[from.index].length < 2) return undefined;
  const empty = state.tableau.findIndex((pile, i) => i !== from.index && !pile.length);
  return empty < 0 ? undefined : { kind: 'tableau', index: empty };
}

/** The next card that can be thrown away. */
export function autoFinishMove(state: AcesUpState): Move | undefined {
  for (let column = 0; column < COLUMN_COUNT; column++) {
    const top = topOf(state.tableau[column]);
    if (top && beaten(state, top, column)) {
      return { kind: 'play', from: { kind: 'tableau', index: column }, to: DISCARD, count: 1 };
    }
  }
  return undefined;
}

/**
 * Whether the rest of the hand is a formality.
 *
 * Only ever true at the very end: the deck empty, and everything left
 * discardable down to the four aces. Played out rather than reasoned about,
 * as in FreeCell, which is cheap here because there are only four piles.
 */
export function canAutoFinish(state: AcesUpState): boolean {
  if (state.stock.length || hasWon(state)) return false;
  let cursor = state;
  for (;;) {
    const move = autoFinishMove(cursor);
    if (!move) return hasWon(cursor);
    cursor = apply(cursor, move)!.state;
  }
}
