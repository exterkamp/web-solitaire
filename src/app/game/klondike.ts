import { FOUNDATION_COUNT, TABLEAU_COUNT, rankValue, sameColor } from './config';
import { Card, buildDeck, shuffle } from './deck';
import { PileRef } from './piles';
import {
  buildsDown,
  canPlaceOnFoundation,
  foundationIndexOf,
  isRun,
  topOf,
} from './card-rules';

// The rules Klondike shares with FreeCell live in card-rules.ts. They are
// re-exported here because this module was where they used to be, and
// because a caller reasoning about Klondike should not have to know which of
// its rules it shares with the game next door.
export { canPlaceOnFoundation, foundationIndexOf, topOf };
export type { PileKind, PileRef } from './piles';

// Klondike, as rules rather than as a screen.
//
// Nothing in this file knows about Phaser, Angular or the DOM. That is the
// point of it: the half of a card game worth testing automatically is what
// the cards are allowed to do, and that half can be checked in milliseconds
// if it never has to be drawn. The board in solitaire-scene.ts reads this
// state and renders it; it does not decide anything.
//
// Every operation returns a new state rather than editing the one it was
// given. That is what makes undo a stack of old states instead of a second
// implementation of every move running backwards - which is where undo bugs
// come from, since the inverse of "move a card and turn over the one under
// it" is only obvious until you try to write it down.

export type DrawCount = 1 | 3;

export interface GameState {
  // Face down, and the *last* element is the top of the pile - the next card
  // to be turned. Every pile in here is stored bottom-first, so `at(-1)` is
  // always the card you can reach. It is worth being consistent about even
  // where it reads oddly, as it does for the stock.
  stock: Card[];
  waste: Card[];
  // One per suit, in SUITS order, which is also the order they are drawn in.
  foundations: Card[][];
  tableau: Card[][];
  score: number;
  // Every move that changed the board, including draws. What the player is
  // told, and what "moves" means in the record book.
  moves: number;
  // How many times the waste has been turned back into a stock. Drives the
  // recycle penalty, and is the reason an empty stock still has to know how
  // many times it has been emptied.
  passes: number;
  drawCount: DrawCount;
}

// Windows Solitaire's standard scoring, which is the scoring people mean
// when they say a solitaire game has a score. Kept as named constants
// because the numbers themselves are arbitrary - they are a convention, not
// a derivation, and a bare -15 in the middle of a move looks like a bug.
export const SCORE_WASTE_TO_TABLEAU = 5;
export const SCORE_TO_FOUNDATION = 10;
export const SCORE_TURN_OVER = 5;
export const SCORE_FOUNDATION_TO_TABLEAU = -15;
// Going back through the deck. Draw-one is punished hard and from the first
// recycle, because with one card at a time the whole deck is reachable on
// every pass and cycling it is a search rather than a risk. Draw-three gets
// two free passes: it takes three to see every card at all.
export const SCORE_RECYCLE_DRAW_ONE = -100;
export const SCORE_RECYCLE_DRAW_THREE = -20;
export const FREE_PASSES_DRAW_THREE = 2;

// No time penalty, deliberately - Windows took two points every ten seconds
// and this does not. On a phone the game is put down mid-hand constantly,
// and a score that drains while the screen is off punishes the interruption
// rather than the play. The time bonus below is the other half of that
// bargain: finishing quickly is still worth something, it is just that
// thinking slowly costs nothing.
//
// The classic formula, and it is steeper than it looks: two minutes is worth
// about 5,800 points and ten minutes about 1,100.
export function timeBonus(seconds: number): number {
  if (seconds < 30) return 0;
  return Math.floor(700000 / seconds);
}

// --- dealing --------------------------------------------------------------

/**
 * A fresh deal: seven piles of one to seven cards, each with its top card
 * turned up, and the remaining twenty-four left as the stock.
 */
export function deal(drawCount: DrawCount, random: () => number = Math.random): GameState {
  const deck = shuffle(buildDeck(), random);
  const tableau: Card[][] = [];
  let next = 0;
  for (let pile = 0; pile < TABLEAU_COUNT; pile++) {
    const cards: Card[] = [];
    for (let i = 0; i <= pile; i++) {
      const card = deck[next++];
      // Only the last one of each pile is turned over, which is what makes
      // the deal a puzzle rather than a layout.
      card.faceUp = i === pile;
      cards.push(card);
    }
    tableau.push(cards);
  }
  return {
    stock: deck.slice(next),
    waste: [],
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau,
    score: 0,
    moves: 0,
    passes: 0,
    drawCount,
  };
}

// A copy that can be edited without touching the original, cards included.
//
// The cards are copied rather than shared because `faceUp` lives on the card:
// turning one over in a new state would otherwise reach back and turn it over
// in the state undo is holding onto.
export function cloneState(state: GameState): GameState {
  const copyPile = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    stock: copyPile(state.stock),
    waste: copyPile(state.waste),
    foundations: state.foundations.map(copyPile),
    tableau: state.tableau.map(copyPile),
  };
}

// --- what is allowed ------------------------------------------------------

/** Kings start an empty pile; after that it is the other colour, one lower. */
export function canPlaceOnTableau(card: Card, pile: readonly Card[]): boolean {
  const top = topOf(pile);
  // The one place Klondike is stricter than FreeCell, and the reason an
  // empty column here is worth so much more than a free cell there.
  if (!top) return card.rank === 'K';
  return buildsDown(card, top);
}

/**
 * Whether the cards from `index` to the top of a tableau pile can be picked
 * up together.
 *
 * In a game played only through this module the face-up part of a pile is
 * always a legal run already, so this looks like a check that cannot fail.
 * It is here because the board lets you grab a pile anywhere - including at a
 * face-down card - and because a rigged state in a test is not bound by the
 * moves that would have had to make it.
 */
export function isMovableRun(pile: readonly Card[], index: number): boolean {
  return isRun(pile, index);
}

function pileOf(state: GameState, ref: PileRef): Card[] | undefined {
  switch (ref.kind) {
    case 'stock':
      return state.stock;
    case 'waste':
      return state.waste;
    case 'foundation':
      return state.foundations[ref.index];
    case 'tableau':
      return state.tableau[ref.index];
    default:
      // A free cell, which this game does not have. Shared pile names mean
      // each game can be handed a pile that belongs to the other, and the
      // answer is the same as for any pile it does not know: nothing.
      return undefined;
  }
}

/**
 * The cards a move would lift, or undefined if nothing can be lifted there.
 *
 * `count` is how many, counted down from the top. Only a tableau can give up
 * more than one: the waste and the foundations hand over their top card and
 * nothing else, and the stock hands over nothing at all - it is turned, not
 * played from.
 */
export function liftable(state: GameState, from: PileRef, count: number): Card[] | undefined {
  if (count < 1) return undefined;
  const pile = pileOf(state, from);
  if (!pile || pile.length < count) return undefined;

  if (from.kind === 'stock') return undefined;
  if (from.kind === 'waste' || from.kind === 'foundation') {
    if (count !== 1) return undefined;
    return pile.slice(-1);
  }
  const index = pile.length - count;
  if (!isMovableRun(pile, index)) return undefined;
  return pile.slice(index);
}

/** Whether a lifted run may be dropped on `to`. */
export function canDrop(state: GameState, cards: readonly Card[], to: PileRef): boolean {
  if (!cards.length) return false;
  if (to.kind === 'stock' || to.kind === 'waste') return false;

  if (to.kind === 'foundation') {
    // Foundations take one card at a time, and only into their own suit's
    // column - which is what stops a spade being dropped on the pile that
    // would look right for it but is reserved for hearts.
    if (cards.length !== 1) return false;
    if (to.index !== foundationIndexOf(cards[0].suit)) return false;
    return canPlaceOnFoundation(cards[0], state.foundations[to.index]);
  }
  return canPlaceOnTableau(cards[0], state.tableau[to.index]);
}

// --- making moves ---------------------------------------------------------

export type Move =
  // Turn the stock, or - when it is empty - turn the waste back into one.
  // Both are one gesture on the same pile, so they are one move here, and
  // the result says which of the two happened.
  | { kind: 'draw' }
  | { kind: 'play'; from: PileRef; to: PileRef; count: number };

export interface MoveResult {
  state: GameState;
  move: Move;
  // What the board has to animate. Not derivable afterwards from the two
  // states without diffing them, which is a lot of work to recover something
  // the move already knew.
  drawn?: Card[];
  recycled?: boolean;
  moved?: Card[];
  // The tableau card this move turned over, if it uncovered one.
  flipped?: Card;
  points: number;
}

function recyclePenalty(state: GameState): number {
  if (state.drawCount === 1) return SCORE_RECYCLE_DRAW_ONE;
  return state.passes < FREE_PASSES_DRAW_THREE ? 0 : SCORE_RECYCLE_DRAW_THREE;
}

// Score never goes below zero, which is the convention and also the kinder
// reading: a long game of shuffling the stock should stall your score, not
// bury it so deep that playing well again is invisible.
function addScore(state: GameState, points: number): number {
  return Math.max(0, state.score + points);
}

/**
 * Applies a move, or answers undefined if it is not legal.
 *
 * Illegal is an ordinary answer rather than an error: the board asks this
 * about every drop the player attempts, most of which are questions rather
 * than mistakes - a card dragged over a pile that will not take it.
 */
export function apply(state: GameState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') return applyDraw(state);
  return applyPlay(state, move);
}

function applyDraw(state: GameState): MoveResult | undefined {
  const next = cloneState(state);

  if (!next.stock.length) {
    if (!next.waste.length) return undefined;
    // The waste goes back under the stock in the order it was laid down, so
    // the deck comes round again the same way rather than reversed twice.
    // Reversed once: the waste's top card was the last one turned, and it
    // has to end up as the last one turned again.
    next.stock = next.waste.reverse().map((card) => ({ ...card, faceUp: false }));
    next.waste = [];
    const points = recyclePenalty(state);
    next.score = addScore(state, points);
    next.passes = state.passes + 1;
    next.moves = state.moves + 1;
    return { state: next, move: { kind: 'draw' }, recycled: true, points };
  }

  const drawn: Card[] = [];
  for (let i = 0; i < state.drawCount && next.stock.length; i++) {
    const card = next.stock.pop()!;
    card.faceUp = true;
    next.waste.push(card);
    drawn.push(card);
  }
  next.moves = state.moves + 1;
  return { state: next, move: { kind: 'draw' }, drawn, points: 0 };
}

function applyPlay(
  state: GameState,
  move: { kind: 'play'; from: PileRef; to: PileRef; count: number },
): MoveResult | undefined {
  const { from, to, count } = move;
  // A pile cannot be its own destination. Worth ruling out explicitly: the
  // board can produce it by dropping a card back where it came from, and
  // without this the card would be removed and re-added at an index that no
  // longer means what it meant.
  if (from.kind === to.kind && from.index === to.index) return undefined;

  const cards = liftable(state, from, count);
  if (!cards) return undefined;
  if (!canDrop(state, cards, to)) return undefined;

  const next = cloneState(state);
  const source = pileOf(next, from)!;
  const target = pileOf(next, to)!;
  const lifted = source.splice(source.length - count, count);
  target.push(...lifted);

  let points = 0;
  if (to.kind === 'foundation') points += SCORE_TO_FOUNDATION;
  else if (from.kind === 'waste') points += SCORE_WASTE_TO_TABLEAU;
  if (from.kind === 'foundation' && to.kind === 'tableau') points += SCORE_FOUNDATION_TO_TABLEAU;

  // Whatever the move uncovered, turned over. This is the only place a
  // tableau card is turned up, which is why the score for doing it lives
  // here rather than beside the other scoring above.
  let flipped: Card | undefined;
  if (from.kind === 'tableau') {
    const uncovered = topOf(source);
    if (uncovered && !uncovered.faceUp) {
      uncovered.faceUp = true;
      flipped = uncovered;
      points += SCORE_TURN_OVER;
    }
  }

  next.score = addScore(state, points);
  next.moves = state.moves + 1;
  return { state: next, move, moved: lifted, flipped, points };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: GameState): boolean {
  return state.foundations.every((pile) => pile.length === 13);
}

/**
 * Where a card should go when it is tapped rather than dragged.
 *
 * Foundation first, then a tableau pile. That order is the whole of the
 * gesture's usefulness: tapping is for the obvious move, and the obvious
 * move is almost always "this ace/deuce goes home". Where only a tableau
 * will take it, an occupied pile is preferred over an empty one, because
 * moving a king onto an empty column and moving it back is the most common
 * way to waste the one thing an empty column is for.
 */
export function autoTarget(state: GameState, from: PileRef, count = 1): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards) return undefined;

  if (cards.length === 1) {
    const foundation: PileRef = { kind: 'foundation', index: foundationIndexOf(cards[0].suit) };
    // Not from a foundation to a foundation, which canDrop would refuse
    // anyway, but this says why: a card already home has nowhere better.
    if (from.kind !== 'foundation' && canDrop(state, cards, foundation)) return foundation;
  }

  const empties: PileRef[] = [];
  for (let i = 0; i < state.tableau.length; i++) {
    const to: PileRef = { kind: 'tableau', index: i };
    if (from.kind === 'tableau' && from.index === i) continue;
    if (!canDrop(state, cards, to)) continue;
    if (state.tableau[i].length) return to;
    empties.push(to);
  }
  // Moving the whole of a pile onto an empty column achieves nothing but a
  // change of address, and the tap gesture should not be able to do it by
  // accident.
  if (from.kind === 'tableau' && count === state.tableau[from.index].length) return undefined;
  return empties[0];
}

/**
 * Every move available right now, which is asked for one reason: noticing
 * when there are none, so the board can say so.
 *
 * Deliberately does not include foundation-to-tableau moves. They are legal,
 * and there are positions that need them, but a card can almost always be
 * pulled back off a foundation - so counting those would mean a game was
 * never quite stuck and the board could never tell you that you are out of
 * moves. The cost is worth stating: "nothing left that can be played" means
 * nothing on the table, and does not count fetching back a card you have
 * already sent home.
 */
export function legalMoves(state: GameState): Move[] {
  const moves: Move[] = [];

  if (state.stock.length || state.waste.length) moves.push({ kind: 'draw' });

  const sources: { ref: PileRef; count: number }[] = [];
  if (state.waste.length) sources.push({ ref: { kind: 'waste', index: 0 }, count: 1 });
  for (let i = 0; i < state.tableau.length; i++) {
    const pile = state.tableau[i];
    for (let index = 0; index < pile.length; index++) {
      if (!pile[index].faceUp) continue;
      // Every face-up card is the head of a run somebody might move, but a
      // run's head is the only card in it worth asking about - grabbing it
      // lower down carries the same cards plus more.
      if (isMovableRun(pile, index)) {
        sources.push({ ref: { kind: 'tableau', index: i }, count: pile.length - index });
      }
    }
  }

  for (const source of sources) {
    const cards = liftable(state, source.ref, source.count);
    if (!cards) continue;
    for (let i = 0; i < state.foundations.length; i++) {
      const to: PileRef = { kind: 'foundation', index: i };
      if (canDrop(state, cards, to)) moves.push({ kind: 'play', from: source.ref, to, count: source.count });
    }
    for (let i = 0; i < state.tableau.length; i++) {
      const to: PileRef = { kind: 'tableau', index: i };
      if (source.ref.kind === 'tableau' && source.ref.index === i) continue;
      // Shuffling a whole pile between empty columns is legal and is not a
      // move; leaving it out is what lets "no moves left" mean something.
      if (
        !state.tableau[i].length &&
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

/**
 * Whether this game is over: nothing can be played now, and nothing can be
 * played after any amount of turning the deck over either.
 *
 * "No legal move right now" is not the same question and is nearly useless as
 * an answer, because turning the stock is almost always legal - so a player
 * can be finished and still be offered a deck to shuffle through for ever.
 * This walks the deck instead: it looks for a play, turns the stock, looks
 * again, and keeps going until the stock and waste come back to an
 * arrangement it has already seen. That terminates because nothing is being
 * played, so a pass through the deck returns it exactly as it was, and the
 * number of distinct arrangements is the number of draws in a pass.
 *
 * Which also makes the answer exact rather than a guess, including the
 * draw-three case that catches people out: a card sitting in the middle of a
 * triple never reaches the top of the waste, and if nothing is played the
 * grouping never shifts, so it never will.
 *
 * Fetching a card back off a foundation is not counted, for the reason
 * legalMoves gives - it is almost always available, and counting it would
 * mean no game was ever over. It stays legal, so a player who disagrees with
 * this verdict can carry on and try exactly that.
 */
export function isDeadEnd(state: GameState): boolean {
  if (hasWon(state)) return false;

  const key = (s: GameState) =>
    `${s.stock.map((c) => c.id).join()}|${s.waste.map((c) => c.id).join()}`;
  const seen = new Set<string>();
  let cursor = state;

  for (;;) {
    if (legalMoves(cursor).some((move) => move.kind === 'play')) return false;
    const here = key(cursor);
    if (seen.has(here)) return true;
    seen.add(here);
    const turned = apply(cursor, { kind: 'draw' });
    // Nothing to play and nothing left to turn.
    if (!turned) return true;
    cursor = turned.state;
  }
}

/**
 * Whether the rest of the game is a formality - every card face up, so
 * nothing is hidden and the only thing left is to send them home in order.
 *
 * The stock and the waste may still hold cards: with unlimited passes they
 * are all reachable, so the finish can play them too. What must be true is
 * that no tableau card is face down, because turning one over could put a
 * card in play that changes what should happen next.
 */
export function canAutoFinish(state: GameState): boolean {
  if (hasWon(state)) return false;
  return state.tableau.every((pile) => pile.every((card) => card.faceUp));
}

/**
 * The next move of an auto-finish, or undefined when there is nothing left
 * to do. Called in a loop by the board, one move per animation, so that
 * finishing is something to watch rather than an instant jump to a full
 * layout.
 */
export function autoFinishMove(state: GameState): Move | undefined {
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
  const fromWaste = fromPile({ kind: 'waste', index: 0 }, state.waste);
  if (fromWaste) return fromWaste;
  // Nothing on the table or in hand will go, so turn the deck over and look
  // again. Only worth doing while there is a card left to turn - otherwise
  // this is an infinite loop wearing a move's clothes.
  if (state.stock.length || state.waste.length) return { kind: 'draw' };
  return undefined;
}
