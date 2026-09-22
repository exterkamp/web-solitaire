import { FOUNDATION_COUNT, TABLEAU_COUNT } from './config';
import { Card, buildDeck, shuffle } from './deck';
import { Move, PileRef } from './piles';
import { buildsDownInSuit, completedSuit, foundationIndexOf, topOf } from './card-rules';

// Scorpion, as rules rather than as a screen.
//
// Yukon's grip on the cards with Spider's idea of an order: any face-up card
// comes away with every card piled on it, in whatever state those are in -
// and it may only be put down on a card of its own suit, one rank higher.
//
// That combination is what makes it what it is. In Yukon a handful will
// usually fit somewhere, because half the deck is the other colour. Here a
// nine of hearts has exactly one home in the whole game, the ten of hearts,
// and it is very probably buried under four cards you also cannot move yet.
// So the game is a sequence of small excavations, each one paid for by
// burying something else, and the three cards held back are the last favour
// anybody does you.

export const COLUMN_COUNT = TABLEAU_COUNT;

// Four columns dealt three face down under four face up, three dealt face up
// all the way, and three cards kept back: 4x7 + 3x7 + 3 is fifty-two.
const BURIED_COLUMNS = 4;
const BURIED_PER_COLUMN = 3;
const COLUMN_SIZE = 7;
export const RESERVE = 3;

export interface ScorpionState {
  foundations: Card[][];
  tableau: Card[][];
  // The three cards held back, dealt in one go when they are asked for.
  stock: Card[];
  moves: number;
}

export interface MoveResult {
  state: ScorpionState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
  flipped?: Card;
}

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): ScorpionState {
  const deck = shuffle(buildDeck(), random);
  const tableau: Card[][] = Array.from({ length: COLUMN_COUNT }, () => []);
  let next = 0;
  for (let column = 0; column < COLUMN_COUNT; column++) {
    for (let i = 0; i < COLUMN_SIZE; i++) {
      const card = deck[next++];
      card.faceUp = !(column < BURIED_COLUMNS && i < BURIED_PER_COLUMN);
      tableau[column].push(card);
    }
  }
  const stock = deck.slice(next);
  for (const card of stock) card.faceUp = false;

  return {
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau,
    stock,
    moves: 0,
  };
}

export function cloneState(state: ScorpionState): ScorpionState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    foundations: state.foundations.map(copy),
    tableau: state.tableau.map(copy),
    stock: copy(state.stock),
  };
}

export function hiddenCards(state: ScorpionState): number {
  return state.tableau.reduce(
    (total, pile) => total + pile.filter((card) => !card.faceUp).length,
    0,
  );
}

// --- what is allowed ------------------------------------------------------

/**
 * Yukon's rule, word for word: a face-up card comes away with whatever is on
 * top of it, in whatever order that happens to be.
 *
 * Which is not the generosity it sounds like, because of where it may then be
 * put down.
 */
export function liftable(
  state: ScorpionState, from: PileRef, count: number,
): Card[] | undefined {
  if (count < 1 || from.kind !== 'tableau') return undefined;
  const pile = state.tableau[from.index];
  if (!pile || pile.length < count) return undefined;
  const index = pile.length - count;
  return pile[index].faceUp ? pile.slice(index) : undefined;
}

/** Kings into an empty column; otherwise the same suit, one rank higher. */
export function canPlaceOnTableau(card: Card, pile: readonly Card[]): boolean {
  const top = topOf(pile);
  if (!top) return card.rank === 'K';
  return buildsDownInSuit(card, top);
}

export function canDrop(
  state: ScorpionState, cards: readonly Card[], to: PileRef,
): boolean {
  if (!cards.length || to.kind !== 'tableau') return false;
  const pile = state.tableau[to.index];
  return !!pile && canPlaceOnTableau(cards[0], pile);
}

// --- making moves ---------------------------------------------------------

export function apply(state: ScorpionState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') return applyReserve(state);

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
 * The three cards held back, onto the first three columns.
 *
 * All at once and only once, which is the whole of this game's deck. Worth
 * saving: three face-up cards in the right place can open a column, and there
 * is no second chance to place them better.
 */
function applyReserve(state: ScorpionState): MoveResult | undefined {
  if (!state.stock.length) return undefined;
  const next = cloneState(state);
  const drawn: Card[] = [];
  for (let column = 0; column < RESERVE && next.stock.length; column++) {
    const card = next.stock.pop()!;
    card.faceUp = true;
    next.tableau[column].push(card);
    drawn.push(card);
  }
  collect(next);
  next.moves = state.moves + 1;
  return { state: next, move: { kind: 'draw' }, drawn };
}

function turnUp(state: ScorpionState, column: number): Card | undefined {
  const uncovered = topOf(state.tableau[column]);
  if (!uncovered || uncovered.faceUp) return undefined;
  uncovered.faceUp = true;
  return uncovered;
}

// A finished suit leaves the table, as in Spiderette. Traditionally Scorpion
// is won with the four runs still lying in four columns and nothing is ever
// picked up - but a completed king-to-ace run cannot be wanted again by
// either game, and sending it away says so plainly, keeps the board's own
// idea of a win in one shape across every game on it, and gives the cards
// somewhere to fall from at the end.
function collect(state: ScorpionState): void {
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

export function hasWon(state: ScorpionState): boolean {
  return state.foundations.every((pile) => pile.length === 13);
}

export function legalMoves(state: ScorpionState): Move[] {
  const moves: Move[] = [];
  state.tableau.forEach((pile, column) => {
    pile.forEach((card, index) => {
      if (!card.faceUp) return;
      const count = pile.length - index;
      const from: PileRef = { kind: 'tableau', index: column };
      const cards = liftable(state, from, count);
      if (!cards) return;
      for (let target = 0; target < COLUMN_COUNT; target++) {
        if (target === column) continue;
        if (!state.tableau[target].length && count === pile.length) continue;
        const to: PileRef = { kind: 'tableau', index: target };
        if (canDrop(state, cards, to)) moves.push({ kind: 'play', from, to, count });
      }
    });
  });
  return moves;
}

export function isDeadEnd(state: ScorpionState): boolean {
  if (hasWon(state)) return false;
  return !state.stock.length && legalMoves(state).length === 0;
}

/**
 * Where a tapped handful goes.
 *
 * There is rarely a choice - a card of a given rank and suit has exactly one
 * card in the deck it can sit on - so this is mostly a shortcut for a move
 * you have already found. An empty column is offered last, because it is the
 * scarcest thing in the game.
 */
export function autoTarget(
  state: ScorpionState, from: PileRef, count = 1,
): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards) return undefined;

  const empties: PileRef[] = [];
  for (let column = 0; column < COLUMN_COUNT; column++) {
    if (from.kind === 'tableau' && from.index === column) continue;
    const to: PileRef = { kind: 'tableau', index: column };
    if (!canDrop(state, cards, to)) continue;
    if (state.tableau[column].length) return to;
    empties.push(to);
  }
  if (from.kind === 'tableau' && count === state.tableau[from.index].length) return undefined;
  return empties[0];
}

// Nothing to play out, for Spiderette's reason: a suit goes home the moment
// it is finished, so there is never a heap of ordered cards waiting to be
// sent one at a time.
export function canAutoFinish(): boolean {
  return false;
}

export function autoFinishMove(): Move | undefined {
  return undefined;
}
