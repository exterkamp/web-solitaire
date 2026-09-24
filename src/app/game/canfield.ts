import { FOUNDATION_COUNT, RANKS, Rank, rankValue, sameColor } from './config';
import { Card, shuffledDeck } from './deck';
import { Move, PileRef } from './piles';
import { foundationIndexOf, topOf } from './card-rules';

// Canfield, as rules rather than as a screen. Demon, in Britain.
//
// The gambling one. Richard Canfield sold a deck for fifty dollars and paid
// five a card for whatever you got home, which works out in his favour by
// some margin: a hand goes out perhaps one time in thirty, and the average
// player gets five or six cards up.
//
// Three things make it what it is, and all three are about the reserve. The
// thirteen cards in it are dealt face down, only the top one is yours, and an
// empty column refills from it without being asked - so the whole game is a
// negotiation with a pile you cannot see, and "clearing" a column is not a
// gain but a way of turning the reserve over one card faster. The foundations
// start on whatever rank turned up first rather than on an ace, and count
// round the corner from there; the columns build down the same way, so a king
// goes on an ace.

export const COLUMN_COUNT = 4;
export const RESERVE_SIZE = 13;
export const DRAW_COUNT = 3;

export interface CanfieldState {
  // The rank the foundations start from - whatever was turned up first. Every
  // foundation uses it, and it is the one number that makes two deals of this
  // game play differently from the first move.
  base: Rank;
  foundations: Card[][];
  tableau: Card[][];
  // Thirteen cards, face down but for the top one. The board draws it as a
  // squared pile, which is what it is.
  reserve: Card[];
  stock: Card[];
  waste: Card[];
  moves: number;
}

export interface MoveResult {
  state: CanfieldState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
  flipped?: Card;
  recycled?: boolean;
}

// --- ranks that go round the corner ---------------------------------------

/**
 * The rank one above another, wrapping past the king back to the ace.
 *
 * Both sequences in this game are rings rather than lines: a foundation
 * started on a seven runs 7, 8, ... K, A, 2 ... 6, and a column headed by an
 * ace will take a king. Forgetting the wrap is a game that stops halfway
 * through with moves still on the table.
 */
export function rankAbove(rank: Rank): Rank {
  return RANKS[rankValue(rank) % RANKS.length];
}

/** The rank one below another, wrapping past the ace back to the king. */
export function rankBelow(rank: Rank): Rank {
  return RANKS[(rankValue(rank) + RANKS.length - 2) % RANKS.length];
}

/** How far up from the base a foundation of this height has reached. */
function foundationWants(base: Rank, height: number): Rank {
  return RANKS[(rankValue(base) - 1 + height) % RANKS.length];
}

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): CanfieldState {
  const deck = shuffledDeck(random);
  let next = 0;

  // Thirteen to the reserve, face down but for the top.
  const reserve = deck.slice(next, (next += RESERVE_SIZE));
  for (const card of reserve) card.faceUp = false;
  if (reserve.length) reserve[reserve.length - 1].faceUp = true;

  // One card to a foundation, and its rank is the game.
  const first = deck[next++];
  first.faceUp = true;
  const foundations: Card[][] = Array.from({ length: FOUNDATION_COUNT }, () => []);
  foundations[foundationIndexOf(first.suit)] = [first];

  // Four columns of one, face up.
  const tableau: Card[][] = Array.from({ length: COLUMN_COUNT }, () => {
    const card = deck[next++];
    card.faceUp = true;
    return [card];
  });

  const stock = deck.slice(next);
  for (const card of stock) card.faceUp = false;

  return { base: first.rank, foundations, tableau, reserve, stock, waste: [], moves: 0 };
}

export function cloneState(state: CanfieldState): CanfieldState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    foundations: state.foundations.map(copy),
    tableau: state.tableau.map(copy),
    reserve: copy(state.reserve),
    stock: copy(state.stock),
    waste: copy(state.waste),
  };
}

function pileOf(state: CanfieldState, ref: PileRef): Card[] | undefined {
  if (ref.kind === 'foundation') return state.foundations[ref.index];
  if (ref.kind === 'tableau') return state.tableau[ref.index];
  // The reserve is held as a cell, which is what it is as far as the board is
  // concerned: a pile off to one side that gives up its top card.
  if (ref.kind === 'cell') return state.reserve;
  if (ref.kind === 'waste') return state.waste;
  return undefined;
}

export const RESERVE_REF: PileRef = { kind: 'cell', index: 0 };

// --- what is allowed ------------------------------------------------------

/** A foundation takes the base rank first, then upward in suit, wrapping. */
export function canPlaceOnFoundation(
  state: CanfieldState, card: Card, foundation: readonly Card[],
): boolean {
  if (!foundation.length) return card.rank === state.base;
  const top = topOf(foundation)!;
  return card.suit === top.suit && card.rank === foundationWants(state.base, foundation.length);
}

/**
 * A column builds down in alternating colours, wrapping - and an empty one
 * takes anything at all, but only once the reserve has run out.
 *
 * While the reserve still holds cards an empty column is never really empty:
 * it refills from the reserve the moment it is vacated, before anybody gets
 * to put anything there. Saying so here rather than only in apply() keeps the
 * board from lighting up a column as a target it will then refuse.
 */
export function canPlaceOnTableau(
  state: CanfieldState, card: Card, pile: readonly Card[],
): boolean {
  const top = topOf(pile);
  if (!top) return state.reserve.length === 0;
  if (!top.faceUp) return false;
  return !sameColor(card.suit, top.suit) && card.rank === rankBelow(top.rank);
}

/**
 * Whether the cards from `index` up are a run: face up, descending,
 * alternating colour, wrapping past the ace.
 *
 * Every column is one of these by construction - a column starts as a single
 * card from the reserve and is only ever built on legally - so this is a
 * check on a rigged position rather than on a real one. It earns its keep in
 * the tests.
 */
function isWrappingRun(pile: readonly Card[], index: number): boolean {
  if (index < 0 || index >= pile.length) return false;
  for (let i = index; i < pile.length; i++) {
    if (!pile[i].faceUp) return false;
    if (i > index) {
      const above = pile[i - 1];
      if (sameColor(pile[i].suit, above.suit)) return false;
      if (pile[i].rank !== rankBelow(above.rank)) return false;
    }
  }
  return true;
}

export function liftable(
  state: CanfieldState, from: PileRef, count: number,
): Card[] | undefined {
  if (count < 1) return undefined;
  const pile = pileOf(state, from);
  if (!pile || pile.length < count) return undefined;

  // The reserve, the waste and a foundation all give up one card: whatever is
  // on top.
  if (from.kind === 'cell' || from.kind === 'waste' || from.kind === 'foundation') {
    if (count !== 1) return undefined;
    const top = topOf(pile);
    return top?.faceUp ? [top] : undefined;
  }
  if (from.kind !== 'tableau') return undefined;

  // A column moves whole or not at all. That is Canfield's rule and it is a
  // sharp one: the six of clubs under two other cards is not available, and
  // getting at it means finding somewhere the three of them will go
  // together. Taking "individually" to mean the top card of a pile - as
  // nearly every software Canfield does - would make a different and much
  // easier game.
  if (count !== pile.length) return undefined;
  return isWrappingRun(pile, 0) ? pile.slice() : undefined;
}

export function canDrop(
  state: CanfieldState, cards: readonly Card[], to: PileRef,
): boolean {
  if (!cards.length) return false;

  if (to.kind === 'foundation') {
    if (cards.length !== 1) return false;
    const pile = state.foundations[to.index];
    if (!pile) return false;
    // A suit goes to its own foundation, and the first card of each sets
    // which suit that is - which is already settled, because the foundations
    // are indexed by suit.
    if (to.index !== foundationIndexOf(cards[0].suit)) return false;
    return canPlaceOnFoundation(state, cards[0], pile);
  }
  if (to.kind !== 'tableau') return false;
  const pile = state.tableau[to.index];
  return !!pile && canPlaceOnTableau(state, cards[0], pile);
}

// --- making moves ---------------------------------------------------------

export function apply(state: CanfieldState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') return applyDraw(state);

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

  // Whatever the reserve now shows, turned over.
  let flipped = turnUpReserve(next);
  // And an empty column refilled from it, which is the rule this game is
  // built around: the reserve empties itself into the tableau whether that
  // suits you or not.
  flipped = refill(next) ?? flipped;

  next.moves = state.moves + 1;
  return { state: next, move, moved: lifted, flipped };
}

function turnUpReserve(state: CanfieldState): Card | undefined {
  const top = topOf(state.reserve);
  if (!top || top.faceUp) return undefined;
  top.faceUp = true;
  return top;
}

/**
 * Fills any empty column from the reserve.
 *
 * Automatic, and not a kindness. An empty column is the only way to put a
 * card somewhere it does not fit, and in this game you almost never get to
 * use one: vacate a column and the reserve fills it before you can, with
 * whatever happened to be next.
 */
function refill(state: CanfieldState): Card | undefined {
  let flipped: Card | undefined;
  for (const pile of state.tableau) {
    if (pile.length || !state.reserve.length) continue;
    const card = state.reserve.pop()!;
    card.faceUp = true;
    pile.push(card);
    flipped = turnUpReserve(state) ?? flipped;
  }
  return flipped;
}

/**
 * Three cards to the waste, or the waste turned back into a deck.
 *
 * Unlimited passes, as the game has always been played - Canfield's house
 * edge came from the reserve rather than from rationing the deck, and there
 * is no penalty here to make a pass cost anything.
 */
function applyDraw(state: CanfieldState): MoveResult | undefined {
  const next = cloneState(state);

  if (!next.stock.length) {
    if (!next.waste.length) return undefined;
    next.stock = next.waste.reverse().map((card) => ({ ...card, faceUp: false }));
    next.waste = [];
    next.moves = state.moves + 1;
    return { state: next, move: { kind: 'draw' }, recycled: true };
  }

  const drawn: Card[] = [];
  for (let i = 0; i < DRAW_COUNT && next.stock.length; i++) {
    const card = next.stock.pop()!;
    card.faceUp = true;
    next.waste.push(card);
    drawn.push(card);
  }
  next.moves = state.moves + 1;
  return { state: next, move: { kind: 'draw' }, drawn };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: CanfieldState): boolean {
  return state.foundations.every((pile) => pile.length === 13);
}

export function reserveLeft(state: CanfieldState): number {
  return state.reserve.length;
}

/**
 * Every move worth counting.
 *
 * Moves off a foundation are left out, as in Klondike and for the same
 * reason. Moves out of an empty column are not a thing here at all - there
 * are no empty columns while the reserve has anything in it.
 */
export function legalMoves(state: CanfieldState): Move[] {
  const moves: Move[] = [];
  const targets: PileRef[] = [
    ...state.foundations.map((_, i) => ({ kind: 'foundation', index: i }) as PileRef),
    ...state.tableau.map((_, i) => ({ kind: 'tableau', index: i }) as PileRef),
  ];

  const consider = (from: PileRef, count: number) => {
    const cards = liftable(state, from, count);
    if (!cards) return;
    for (const to of targets) {
      if (to.kind === from.kind && to.index === from.index) continue;
      if (
        to.kind === 'tableau' && from.kind === 'tableau' &&
        !state.tableau[to.index].length && count === state.tableau[from.index].length
      ) continue;
      if (canDrop(state, cards, to)) moves.push({ kind: 'play', from, to, count });
    }
  };

  // Whole columns only, which is what liftable will give up anyway.
  state.tableau.forEach((pile, column) => {
    if (pile.length) consider({ kind: 'tableau', index: column }, pile.length);
  });
  consider(RESERVE_REF, 1);
  consider({ kind: 'waste', index: 0 }, 1);
  return moves;
}

/**
 * Whether the game is over: nothing to play now, and nothing the deck can
 * turn up that would change it.
 *
 * Walked rather than reasoned about, as in Klondike: the deck comes round
 * again for ever, so the only honest answer is to turn it until the position
 * repeats. Three at a time means most cards are only reachable on some passes
 * and not others, which the walk handles by simply being the game.
 */
export function isDeadEnd(state: CanfieldState): boolean {
  if (hasWon(state)) return false;

  const key = (s: CanfieldState) =>
    `${s.stock.map((c) => c.id).join()}|${s.waste.map((c) => c.id).join()}`;
  const seen = new Set<string>();
  let cursor = state;

  for (;;) {
    if (legalMoves(cursor).length) return false;
    const here = key(cursor);
    if (seen.has(here)) return true;
    seen.add(here);
    const turned = apply(cursor, { kind: 'draw' });
    if (!turned) return true;
    cursor = turned.state;
  }
}

/**
 * Where a tapped card goes: home first, then a column that will take it.
 *
 * Home first is right in most games here and is emphatically right in this
 * one - the reserve is a clock, and every card sent up is a card closer to
 * turning it over.
 */
export function autoTarget(
  state: CanfieldState, from: PileRef, count = 1,
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
  return wholeColumn ? undefined : empties[0];
}

/** The next card that can go home, from the table, the reserve or the hand. */
export function autoFinishMove(state: CanfieldState): Move | undefined {
  const fromPile = (ref: PileRef): Move | undefined => {
    const pile = pileOf(state, ref);
    const top = pile ? topOf(pile) : undefined;
    if (!top) return undefined;
    const to: PileRef = { kind: 'foundation', index: foundationIndexOf(top.suit) };
    return canDrop(state, [top], to) ? { kind: 'play', from: ref, to, count: 1 } : undefined;
  };

  for (let i = 0; i < state.tableau.length; i++) {
    const move = fromPile({ kind: 'tableau', index: i });
    if (move) return move;
  }
  const fromReserve = fromPile(RESERVE_REF);
  if (fromReserve) return fromReserve;
  const fromWaste = fromPile({ kind: 'waste', index: 0 });
  if (fromWaste) return fromWaste;
  // Nothing in view will go, so turn the deck and look again - but only while
  // there is something to turn, or this is a loop wearing a move's clothes.
  if (state.stock.length || state.waste.length) return { kind: 'draw' };
  return undefined;
}

/**
 * Whether the rest of the game is a formality.
 *
 * The reserve has to be empty, because a face-down card in it is exactly the
 * thing that could still change what happens next. After that the stock and
 * the waste are fair game: passes are unlimited, so everything in hand comes
 * round eventually.
 */
export function canAutoFinish(state: CanfieldState): boolean {
  if (hasWon(state)) return false;
  return !state.reserve.length;
}
