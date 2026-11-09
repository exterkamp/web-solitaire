import { Rank, rankValue } from './config';
import { Card, shuffledDeck } from './deck';
import { Move, PileRef } from './piles';
import { topOf } from './card-rules';

// Calculation, as rules rather than as a screen.
//
// Also called Broken Intervals, and the one game here that is arithmetic
// rather than sorting. Four foundations, each started from a different card -
// an ace, a two, a three and a four - and each counting up in its own steps:
// the first by ones, the second by twos, the third by threes and the fourth
// by fours, round the corner past the king, until all four arrive at a king
// at the same thirteenth card. Suit never matters.
//
// The deck comes one card at a time and the card turned has to go somewhere
// before the next: onto a foundation if one wants it, or onto one of four
// discard piles if none does. Only the top of a discard pile can be played,
// only to a foundation, and nothing ever moves from one discard pile to
// another. The deck is gone through once.
//
// Which is the whole game: every card is visible the moment it is turned and
// there is no luck after the shuffle beyond the order of the deck, so where
// each card is buried - under what, waiting for what - is a decision you
// make, forty-eight times.

export const FOUNDATION_COUNT = 4;
export const PILE_COUNT = 4;
const RANKS_PER_PILE = 13;

export interface CalculationState {
  // Foundation i counts in steps of i + 1, from a base of rank i + 1.
  foundations: Card[][];
  // The four discard piles.
  tableau: Card[][];
  stock: Card[];
  // The card turned and not yet placed: none, or one.
  waste: Card[];
  moves: number;
}

export interface MoveResult {
  state: CalculationState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
}

// --- the arithmetic -------------------------------------------------------

/** The step foundation `index` counts in: one, two, three or four. */
export const stepOf = (index: number): number => index + 1;

/**
 * The rank foundation `index` wants next, or nothing once it has reached its
 * king. Counted round the corner: after the queen, the twos foundation wants
 * an ace, then a three.
 */
export function wantedValue(state: CalculationState, index: number): number | undefined {
  const pile = state.foundations[index];
  if (!pile) return undefined;
  if (!pile.length) return stepOf(index);
  if (pile.length >= RANKS_PER_PILE) return undefined;
  const top = rankValue(pile[pile.length - 1].rank);
  return ((top - 1 + stepOf(index)) % RANKS_PER_PILE) + 1;
}

/** The thirteen ranks a foundation goes through, base first. For the guide and the tests. */
export function sequenceOf(index: number): number[] {
  return Array.from({ length: RANKS_PER_PILE }, (_, i) => ((stepOf(index) * (i + 1) - 1) % RANKS_PER_PILE) + 1);
}

function fits(state: CalculationState, card: Card, index: number): boolean {
  return wantedValue(state, index) === rankValue(card.rank);
}

// --- dealing --------------------------------------------------------------

const BASES: Rank[] = ['A', '2', '3', '4'];

export function deal(random: () => number = Math.random): CalculationState {
  const deck = shuffledDeck(random);
  // Whichever ace, two, three and four the shuffle reaches first - suit is
  // nothing to this game, so any of them will do.
  const foundations = BASES.map((rank) => {
    const at = deck.findIndex((card) => card.rank === rank);
    const [card] = deck.splice(at, 1);
    card.faceUp = true;
    return [card];
  });
  for (const card of deck) card.faceUp = false;
  return {
    foundations,
    tableau: Array.from({ length: PILE_COUNT }, () => []),
    stock: deck,
    waste: [],
    moves: 0,
  };
}

export function cloneState(state: CalculationState): CalculationState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    foundations: state.foundations.map(copy),
    tableau: state.tableau.map(copy),
    stock: copy(state.stock),
    waste: copy(state.waste),
    moves: state.moves,
  };
}

function pileOf(state: CalculationState, ref: PileRef): Card[] | undefined {
  switch (ref.kind) {
    case 'foundation':
      return state.foundations[ref.index];
    case 'tableau':
      return state.tableau[ref.index];
    case 'waste':
      return ref.index === 0 ? state.waste : undefined;
    case 'stock':
      return ref.index === 0 ? state.stock : undefined;
    default:
      return undefined;
  }
}

// --- what is allowed ------------------------------------------------------

/** One card at a time: the turned card, or the top of a discard pile. */
export function liftable(state: CalculationState, from: PileRef, count: number): Card[] | undefined {
  if (count !== 1 || (from.kind !== 'waste' && from.kind !== 'tableau')) return undefined;
  const top = topOf(pileOf(state, from) ?? []);
  return top ? [top] : undefined;
}

/**
 * A foundation takes the rank it is counting to. A discard pile takes the
 * turned card and nothing else - a card that has been discarded stays
 * discarded until a foundation wants it.
 */
export function canDrop(state: CalculationState, cards: readonly Card[], to: PileRef): boolean {
  if (cards.length !== 1) return false;
  const card = cards[0];
  if (to.kind === 'foundation') return to.index < FOUNDATION_COUNT && fits(state, card, to.index);
  if (to.kind === 'tableau') {
    return to.index >= 0 && to.index < PILE_COUNT && topOf(state.waste)?.id === card.id;
  }
  return false;
}

/** The deck turns only once the last card it turned has gone somewhere. */
export function canDraw(state: CalculationState): boolean {
  return state.stock.length > 0 && state.waste.length === 0;
}

// --- making moves ---------------------------------------------------------

export function apply(state: CalculationState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') {
    if (!canDraw(state)) return undefined;
    const next = cloneState(state);
    const card = next.stock.pop()!;
    card.faceUp = true;
    next.waste.push(card);
    next.moves = state.moves + 1;
    return { state: next, move, drawn: [card] };
  }

  const { from, to, count } = move;
  const cards = liftable(state, from, count);
  if (!cards || !canDrop(state, cards, to)) return undefined;

  const next = cloneState(state);
  const source = pileOf(next, from)!;
  const lifted = source.splice(source.length - 1, 1);
  pileOf(next, to)!.push(...lifted);
  next.moves = state.moves + 1;
  return { state: next, move, moved: lifted };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: CalculationState): boolean {
  return state.foundations.every((pile) => pile.length === RANKS_PER_PILE);
}

/** The first foundation that will take this card, if any does. */
export function foundationFor(state: CalculationState, card: Card): PileRef | undefined {
  for (let i = 0; i < FOUNDATION_COUNT; i++) {
    if (fits(state, card, i)) return { kind: 'foundation', index: i };
  }
  return undefined;
}

/** Every card that can go up to a foundation right now, from where it is. */
function plays(state: CalculationState): Move[] {
  const moves: Move[] = [];
  const sources: PileRef[] = [
    { kind: 'waste', index: 0 },
    ...Array.from({ length: PILE_COUNT }, (_, i) => ({ kind: 'tableau', index: i }) as PileRef),
  ];
  for (const from of sources) {
    const cards = liftable(state, from, 1);
    if (!cards) continue;
    const to = foundationFor(state, cards[0]);
    if (to) moves.push({ kind: 'play', from, to, count: 1 });
  }
  return moves;
}

/**
 * Stuck: the deck is used up, nothing is waiting to be placed, and no
 * discard pile has a card a foundation wants. A turned card is never stuck -
 * there is always a discard pile for it.
 */
export function isDeadEnd(state: CalculationState): boolean {
  if (hasWon(state)) return false;
  if (state.waste.length || state.stock.length) return false;
  return plays(state).length === 0;
}

/**
 * Where a tapped card goes: up, if anything wants it. A card nothing wants
 * has to be put on a discard pile, and which one is the decision this whole
 * game is made of - so the board does not make it. It is dragged.
 */
export function autoTarget(state: CalculationState, from: PileRef, count = 1): PileRef | undefined {
  const cards = liftable(state, from, count);
  return cards ? foundationFor(state, cards[0]) : undefined;
}

/**
 * Whether what is left is only a formality.
 *
 * Once the deck is gone there is almost nothing left to decide: a discard
 * pile's top card can only ever go up. The one choice remaining is which
 * foundation, when two want the same rank at once - so this plays the rest
 * out the way the Finish button would, first foundation first, and offers
 * the button only if that way gets every card home. A hand that needs the
 * other choice is still a hand to play by hand.
 */
export function canAutoFinish(state: CalculationState): boolean {
  if (hasWon(state) || state.stock.length || state.waste.length) return false;
  let current = state;
  for (let guard = 0; guard < 52; guard++) {
    const move = plays(current)[0];
    if (!move) break;
    current = apply(current, move)!.state;
  }
  return hasWon(current);
}

export function autoFinishMove(state: CalculationState): Move | undefined {
  return plays(state)[0];
}

/** Cards still to be placed on the foundations. */
export function cardsLeft(state: CalculationState): number {
  return 52 - state.foundations.reduce((total, pile) => total + pile.length, 0);
}
