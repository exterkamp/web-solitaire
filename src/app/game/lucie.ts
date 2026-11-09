import { Card, shuffle, shuffledDeck } from './deck';
import { Move, PileRef } from './piles';
import { seeded } from './random';
import { buildsDownInSuit, canPlaceOnFoundation, foundationIndexOf, topOf } from './card-rules';

// La Belle Lucie, as rules rather than as a screen.
//
// Seventeen fans of three and one of a single card, every card face up. Only
// the top card of a fan moves: onto a foundation, built up in suit from the
// ace, or onto the top of another fan, one lower in the same suit. A fan that
// empties stays empty - not even a king may start one.
//
// When nothing will move, the fans are gathered up, shuffled, and dealt out
// again in threes, with whatever is left over as a short fan of its own. Twice.
// And then, on the last deal, the merci: once, any one card buried in a fan
// may be pulled out from under the cards on it and played. Three shuffles and
// a draw, which is the version Morehead and Mott-Smith give and the one most
// people mean by the name.

export const FAN_COUNT = 18;
export const FOUNDATION_COUNT = 4;
const FAN_SIZE = 3;
/** Redeals in a hand, after the first deal. */
export const REDEALS = 2;

export interface LucieState {
  foundations: Card[][];
  // Eighteen places for fans. After a redeal fewer are dealt, and the rest
  // stay empty for the rest of the hand.
  tableau: Card[][];
  // Redeals still to come: two, one, none.
  redeals: number;
  // Whether the merci is still to be had. Only on the last deal.
  merci: boolean;
  // Where the next redeal's shuffle starts. Carried in the state rather than
  // drawn from Math.random, so a move is a function of the position it is
  // made from - which is what makes undo and a saved game come back the same.
  seed: number;
  moves: number;
}

export interface MoveResult {
  state: LucieState;
  move: Move;
  moved?: Card[];
  recycled?: boolean;
}

// --- dealing --------------------------------------------------------------

/** Cards into fans of three, the remainder its own fan, the rest left empty. */
function intoFans(cards: readonly Card[]): Card[][] {
  return Array.from({ length: FAN_COUNT }, (_, i) =>
    cards.slice(i * FAN_SIZE, i * FAN_SIZE + FAN_SIZE).map((card) => ({ ...card, faceUp: true })),
  );
}

const nextSeed = (random: () => number) => Math.floor(random() * 2 ** 32);

export function deal(random: () => number = Math.random): LucieState {
  const deck = shuffledDeck(random);
  return {
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau: intoFans(deck),
    redeals: REDEALS,
    merci: false,
    seed: nextSeed(random),
    moves: 0,
  };
}

export function cloneState(state: LucieState): LucieState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    foundations: state.foundations.map(copy),
    tableau: state.tableau.map(copy),
    redeals: state.redeals,
    merci: state.merci,
    seed: state.seed,
    moves: state.moves,
  };
}

function pileOf(state: LucieState, ref: PileRef): Card[] | undefined {
  if (ref.kind === 'foundation') return state.foundations[ref.index];
  if (ref.kind === 'tableau') return state.tableau[ref.index];
  return undefined;
}

// --- what is allowed ------------------------------------------------------

/**
 * Whether lifting `count` cards off this fan is the merci: a card that is
 * not on top, taken with what lies on it, on the last deal and only once.
 */
function isMerci(state: LucieState, from: PileRef, count: number): boolean {
  if (!state.merci || from.kind !== 'tableau') return false;
  const fan = state.tableau[from.index];
  return !!fan && count > 1 && count <= fan.length;
}

/**
 * The top card of a fan - or, for the merci, a buried card and everything
 * over it, which is what a press on it picks up. The merci only ever plays
 * the one card out from under; the rest go straight back.
 */
export function liftable(state: LucieState, from: PileRef, count: number): Card[] | undefined {
  if (from.kind !== 'tableau') return undefined;
  const fan = state.tableau[from.index];
  if (!fan?.length) return undefined;
  if (count === 1) return [fan[fan.length - 1]];
  return isMerci(state, from, count) ? fan.slice(fan.length - count) : undefined;
}

/** Whether these cards are the top of this very fan, as a merci lifts them. */
function liftedFrom(state: LucieState, cards: readonly Card[], to: PileRef): boolean {
  if (to.kind !== 'tableau') return false;
  const fan = state.tableau[to.index] ?? [];
  const top = fan.slice(fan.length - cards.length);
  return top.length === cards.length && top.every((card, i) => card.id === cards[i].id);
}

export function canDrop(state: LucieState, cards: readonly Card[], to: PileRef): boolean {
  // The merci, dropped back on its own fan: the buried card comes to the top.
  if (cards.length > 1) return state.merci && liftedFrom(state, cards, to);
  if (cards.length !== 1) return false;
  const card = cards[0];
  if (to.kind === 'foundation') {
    const pile = state.foundations[to.index];
    return !!pile && foundationIndexOf(card.suit) === to.index && canPlaceOnFoundation(card, pile);
  }
  if (to.kind === 'tableau') {
    // Never onto an empty fan.
    const onto = topOf(state.tableau[to.index] ?? []);
    return !!onto && buildsDownInSuit(card, onto);
  }
  return false;
}

export const canRedeal = (state: LucieState): boolean => state.redeals > 0;

// --- making moves ---------------------------------------------------------

export function apply(state: LucieState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') return redeal(state, move);

  const { from, to, count } = move;
  const cards = liftable(state, from, count);
  if (!cards || !canDrop(state, cards, to)) return undefined;

  const next = cloneState(state);
  const source = pileOf(next, from)!;
  if (count > 1) {
    // The merci: the buried card is pulled out and put on top of its own
    // fan, where it can be played like any other.
    const [pulled] = source.splice(source.length - count, 1);
    source.push(pulled);
    next.merci = false;
    next.moves = state.moves + 1;
    return { state: next, move, moved: [pulled] };
  }
  const lifted = source.splice(source.length - 1, 1);
  pileOf(next, to)!.push(...lifted);
  next.moves = state.moves + 1;
  return { state: next, move, moved: lifted };
}

/**
 * Gathers the fans, shuffles them and deals them out again in threes. The
 * last redeal brings the merci with it.
 */
function redeal(state: LucieState, move: Move): MoveResult | undefined {
  if (!canRedeal(state)) return undefined;
  const random = seeded(state.seed);
  const gathered = shuffle(state.tableau.flat(), random);
  const next = cloneState(state);
  next.tableau = intoFans(gathered);
  next.redeals = state.redeals - 1;
  next.merci = next.redeals === 0;
  next.seed = nextSeed(random);
  next.moves = state.moves + 1;
  return { state: next, move, recycled: true };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: LucieState): boolean {
  return state.foundations.every((pile) => pile.length === 13);
}

const fanRef = (index: number): PileRef => ({ kind: 'tableau', index });
const homeRef = (card: Card): PileRef => ({ kind: 'foundation', index: foundationIndexOf(card.suit) });

/** Every top card that can go home right now. */
function homeMoves(state: LucieState): Move[] {
  const moves: Move[] = [];
  state.tableau.forEach((fan, i) => {
    const top = topOf(fan);
    if (top && canDrop(state, [top], homeRef(top))) {
      moves.push({ kind: 'play', from: fanRef(i), to: homeRef(top), count: 1 });
    }
  });
  return moves;
}

/** Every top card that can go onto another fan. */
function fanMoves(state: LucieState): Move[] {
  const moves: Move[] = [];
  state.tableau.forEach((fan, i) => {
    const top = topOf(fan);
    if (!top) return;
    state.tableau.forEach((_, j) => {
      if (i !== j && canDrop(state, [top], fanRef(j))) {
        moves.push({ kind: 'play', from: fanRef(i), to: fanRef(j), count: 1 });
      }
    });
  });
  return moves;
}

/**
 * Stuck: nothing will move, there are no redeals left, and no merci - or a
 * merci with nothing buried for it to pull.
 */
export function isDeadEnd(state: LucieState): boolean {
  if (hasWon(state) || canRedeal(state)) return false;
  if (homeMoves(state).length || fanMoves(state).length) return false;
  return !(state.merci && state.tableau.some((fan) => fan.length > 1));
}

/**
 * Where a tapped card goes: home if it can, onto a fan if not. A tap on a
 * buried card, on the last deal with the merci still to be had, is the
 * merci - the card comes up to the top of its fan.
 */
export function autoTarget(state: LucieState, from: PileRef, count = 1): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards) return undefined;
  if (count > 1) return from;
  const card = cards[0];
  if (canDrop(state, cards, homeRef(card))) return homeRef(card);
  for (let j = 0; j < state.tableau.length; j++) {
    if (!(from.kind === 'tableau' && from.index === j) && canDrop(state, cards, fanRef(j))) return fanRef(j);
  }
  return undefined;
}

/**
 * Whether what is left goes home on its own. A card sent home never blocks
 * anything, so sending every card that can go home, for as long as any can,
 * either clears the table or shows it cannot be done that way.
 */
export function canAutoFinish(state: LucieState): boolean {
  if (hasWon(state)) return false;
  let current = state;
  for (let guard = 0; guard < 52; guard++) {
    const move = homeMoves(current)[0];
    if (!move) break;
    current = apply(current, move)!.state;
  }
  return hasWon(current);
}

export function autoFinishMove(state: LucieState): Move | undefined {
  return homeMoves(state)[0];
}

/** Cards not yet home. */
export function cardsLeft(state: LucieState): number {
  return 52 - state.foundations.reduce((total, pile) => total + pile.length, 0);
}
