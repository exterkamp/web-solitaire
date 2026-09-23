import { Rank, rankValue } from './config';
import { Card, buildDeck, shuffle } from './deck';
import { Move, PileRef } from './piles';
import { topOf } from './card-rules';

// Pyramid, as rules rather than as a screen.
//
// Twenty-eight cards in a pyramid, and one rule: any two cards you can see
// that add up to thirteen come off together. An ace is one, a jack eleven, a
// queen twelve, and a king is thirteen on his own - kings leave alone, which
// is the only mercy in the game.
//
// The other game here with no building and no sorting, and it is nothing like
// Tri Peaks all the same. Tri Peaks is a game of speed: one card is in play,
// you either see a neighbour or you do not, and a hand is over in two
// minutes. Pyramid is a game of arithmetic and regret - every pair you take
// uncovers something, and taking the wrong six of clubs early is how a hand
// that was winnable stops being winnable, quietly, twenty moves before you
// find out.

// How the pyramid is stacked: row r holds r+1 cards, each sitting on two in
// the row below.
export const ROW_COUNT = 7;

/** Where each position sits: which row, and how far along that row. */
export const POSITIONS: { row: number; slot: number }[] = Array.from(
  { length: ROW_COUNT },
  (_, row) => Array.from({ length: row + 1 }, (_, slot) => ({ row, slot })),
).flat();

export const BOARD_SIZE = POSITIONS.length;

/** The index of the position at (row, slot). */
function indexOf(row: number, slot: number): number {
  return (row * (row + 1)) / 2 + slot;
}

/**
 * Which two positions cover each position - the two directly beneath it.
 *
 * Worked out from the geometry rather than written down, for the reason Tri
 * Peaks' table is: fifty-six hand-typed numbers is fifty-six chances to
 * strand a card that can then never be taken.
 */
export const COVERED_BY: number[][] = POSITIONS.map(({ row, slot }) =>
  row === ROW_COUNT - 1 ? [] : [indexOf(row + 1, slot), indexOf(row + 1, slot + 1)],
);

// One pass through the deck, which is the strict rule and is what the odds
// quoted for this game are quoted against: about one hand in fifty goes out.
// The deck is turned a card at a time and does not come round again, so a
// card passed over is a card gone.
const PAIR = 13;

export interface PyramidState {
  // Twenty-eight positions, each holding its card until it is taken. Piles of
  // nought or one, so every pile on this table is the same shape.
  pyramid: Card[][];
  stock: Card[];
  waste: Card[];
  discard: Card[];
  moves: number;
}

export interface MoveResult {
  state: PyramidState;
  move: Move;
  moved?: Card[];
  drawn?: Card[];
}

export const DISCARD: PileRef = { kind: 'foundation', index: 0 };

/** What a card is worth: ace one, jack eleven, queen twelve, king thirteen. */
export function value(rank: Rank): number {
  return rankValue(rank);
}

// --- dealing --------------------------------------------------------------

export function deal(random: () => number = Math.random): PyramidState {
  const deck = shuffle(buildDeck(), random);
  const pyramid: Card[][] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const card = deck[i];
    // The whole pyramid face up. There is nothing hidden in this game - what
    // stops you is what is lying on top of what you want, and you can see it
    // from the first move.
    card.faceUp = true;
    pyramid.push([card]);
  }
  const stock = deck.slice(BOARD_SIZE);
  for (const card of stock) card.faceUp = false;

  return { pyramid, stock, waste: [], discard: [], moves: 0 };
}

export function cloneState(state: PyramidState): PyramidState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    pyramid: state.pyramid.map(copy),
    stock: copy(state.stock),
    waste: copy(state.waste),
    discard: copy(state.discard),
  };
}

export function cardsLeft(state: PyramidState): number {
  return state.pyramid.reduce((total, pile) => total + pile.length, 0);
}

// --- what is allowed ------------------------------------------------------

/** Whether a position has been cleared of the two cards lying on it. */
export function isUncovered(state: PyramidState, index: number): boolean {
  return COVERED_BY[index].every((covering) => state.pyramid[covering].length === 0);
}

/** Whether two cards add up to thirteen. */
export function pairs(a: Card, b: Card): boolean {
  return value(a.rank) + value(b.rank) === PAIR;
}

/** Whether a card is a king, and so leaves on its own. */
export function isKing(card: Card): boolean {
  return value(card.rank) === PAIR;
}

export function liftable(
  state: PyramidState, from: PileRef, count: number,
): Card[] | undefined {
  if (count !== 1) return undefined;
  if (from.kind === 'waste') {
    const top = topOf(state.waste);
    return top ? [top] : undefined;
  }
  if (from.kind !== 'tableau') return undefined;
  const pile = state.pyramid[from.index];
  if (!pile?.length || !isUncovered(state, from.index)) return undefined;
  return pile.slice();
}

export function canDrop(
  state: PyramidState, cards: readonly Card[], to: PileRef,
): boolean {
  if (cards.length !== 1) return false;
  const card = cards[0];

  // The heap, which only a king may be sent to alone.
  if (to.kind === 'foundation') return isKing(card);

  if (to.kind === 'waste') {
    // The card beside the deck, paired with something from the pyramid - or
    // with the card underneath it, which is the standard rule and is why this
    // looks past the top when the top is the card being played. Two cards
    // turned one after the other that happen to make thirteen come off
    // together; without that a winnable deal can be unwinnable.
    const top = topOf(state.waste);
    if (!top) return false;
    if (top.id !== card.id) return pairs(card, top);
    const under = state.waste[state.waste.length - 2];
    return !!under && pairs(card, under);
  }
  if (to.kind !== 'tableau') return false;

  const pile = state.pyramid[to.index];
  if (!pile?.length || !isUncovered(state, to.index)) return false;
  return pile[0].id !== card.id && pairs(card, pile[0]);
}

// --- making moves ---------------------------------------------------------

export function apply(state: PyramidState, move: Move): MoveResult | undefined {
  if (move.kind === 'draw') return applyDraw(state);

  const cards = liftable(state, move.from, move.count);
  if (!cards) return undefined;
  if (!canDrop(state, cards, move.to)) return undefined;

  const next = cloneState(state);
  const taken = take(next, move.from);
  if (!taken) return undefined;
  next.discard.push(taken);

  // A pair leaves together. The move names one card and the pile the other
  // one is in, which is the only shape a move has on this table - and it
  // happens to be exactly what the gesture is: this card, onto that one.
  const moved = [taken];
  if (move.to.kind !== 'foundation') {
    const partner = take(next, move.to);
    if (!partner) return undefined;
    next.discard.push(partner);
    moved.push(partner);
  }

  next.moves = state.moves + 1;
  return { state: next, move, moved };
}

function take(state: PyramidState, ref: PileRef): Card | undefined {
  // Popping twice from the waste is how a pair of waste cards leaves: the
  // move names the waste as both where the card came from and what it is
  // being paired with, and each call takes whatever is on top now.
  if (ref.kind === 'waste') return state.waste.pop();
  if (ref.kind === 'tableau') return state.pyramid[ref.index].pop();
  return undefined;
}

/**
 * Turns the next card of the deck, once each.
 *
 * There is no second pass. When the deck is out the hand is over, whatever is
 * still standing - which is the strict rule and is most of why this game is
 * as hard as it is.
 */
function applyDraw(state: PyramidState): MoveResult | undefined {
  if (!state.stock.length) return undefined;
  const next = cloneState(state);
  const card = next.stock.pop()!;
  card.faceUp = true;
  next.waste.push(card);
  next.moves = state.moves + 1;
  return { state: next, move: { kind: 'draw' }, drawn: [card] };
}

// --- reading the board ----------------------------------------------------

export function hasWon(state: PyramidState): boolean {
  return cardsLeft(state) === 0;
}

/** Whether there is a card left to turn. */
export function canDraw(state: PyramidState): boolean {
  return state.stock.length > 0;
}

export function legalMoves(state: PyramidState): Move[] {
  const moves: Move[] = [];
  const sources: PileRef[] = [
    ...state.pyramid.map((_, i) => ({ kind: 'tableau', index: i }) as PileRef),
    { kind: 'waste', index: 0 },
  ];

  for (const from of sources) {
    const cards = liftable(state, from, 1);
    if (!cards) continue;
    if (isKing(cards[0])) {
      moves.push({ kind: 'play', from, to: DISCARD, count: 1 });
      continue;
    }
    for (const to of sources) {
      // The waste paired with itself is a real move - the top two cards - and
      // the only place on this table where the same pile is both ends of one.
      const samePile = to.kind === from.kind && to.index === from.index;
      if (samePile && from.kind !== 'waste') continue;
      if (canDrop(state, cards, to)) moves.push({ kind: 'play', from, to, count: 1 });
    }
  }
  return moves;
}

/**
 * Whether the hand is over: nothing pairs, and the deck cannot be turned
 * again.
 *
 * Worth saying promptly in this game, because a blocked pyramid does not look
 * blocked - there can be a dozen cards showing and no two of them adding to
 * thirteen, and a player will keep turning a deck that has nothing left to
 * give them.
 */
export function isDeadEnd(state: PyramidState): boolean {
  if (hasWon(state)) return false;
  return !canDraw(state) && legalMoves(state).length === 0;
}

/**
 * Where a tapped card goes.
 *
 * A king to the heap, and anything else onto the card beside the deck if the
 * two of them make thirteen. Deliberately no further than that: finding the
 * *other* card in the pyramid is the game, and a tap that searched the whole
 * board for a partner would be playing it for you. Two cards in the pyramid
 * are paired by dragging one onto the other, which is also the honest way to
 * say which two you mean.
 */
export function autoTarget(state: PyramidState, from: PileRef, count = 1): PileRef | undefined {
  const cards = liftable(state, from, count);
  if (!cards) return undefined;
  if (isKing(cards[0])) return DISCARD;
  const waste: PileRef = { kind: 'waste', index: 0 };
  // From the pyramid, onto the card beside the deck. And from the waste onto
  // itself, which is the pair of turned cards: tapping the top one is the
  // only gesture that can mean it, since there is nowhere to drag it to.
  return canDrop(state, cards, waste) ? waste : undefined;
}

// No finish to play out: every pair has to be spotted, and the last one is as
// much work as the first.
export function canAutoFinish(): boolean {
  return false;
}

export function autoFinishMove(): Move | undefined {
  return undefined;
}
