import { Card, shuffledDeck } from './deck';
import { isRed, rankValue } from './config';

// Nertz for two, on one phone: the rules and nothing else.
//
// No Phaser, no Angular, no DOM, and every move returns a new state - the same
// contract every other rules module here keeps. What is different is that
// nobody takes turns. Both players move at once, so a move names whose it is
// and the one thing the two of them share - the foundations - is where a race
// is settled: whoever's move is applied first lands, and the second finds the
// card it wanted to play no longer fits.
//
// The rules follow web-nertz's: a foundation is built up by suit from the
// ace, a work pile is built down in alternating colours, the stock turns three
// at a time, and a card on a foundation stays there. A point for every card
// put up, two off for every card left in the Nertz pile.

export type Seat = 0 | 1;
export const SEATS: readonly Seat[] = [0, 1];

export const NERTZ_PILE_SIZE = 13;
export const DEFAULT_WORK_PILES = 4;
/** How many work piles a match may be played with. */
export const WORK_PILE_CHOICES: readonly number[] = [4, 5, 6];
// Two decks' worth of aces, so two decks' worth of places to start a suit.
export const FOUNDATIONS = 8;
export const DRAW_COUNT = 3;
export const PENALTY_PER_CARD = 2;
export const DEFAULT_TARGET = 100;

/** One player's side of the table. Every pile's last card is its top. */
export interface Hand {
  nertz: Card[];
  work: Card[][];
  stock: Card[];
  waste: Card[];
}

export interface NertzState {
  hands: [Hand, Hand];
  foundations: Card[][];
  // Cards each player has put up this round. Counted rather than worked out
  // from the foundations, because a foundation does not remember whose card
  // it is holding unless asked, and the score is about whose.
  up: [number, number];
}

/** Where a card can come from or go to. */
export type NertzPile =
  | { kind: 'nertz' }
  | { kind: 'waste' }
  | { kind: 'stock' }
  | { kind: 'work'; index: number }
  | { kind: 'foundation'; index: number };

export function sameNertzPile(a: NertzPile, b: NertzPile): boolean {
  if (a.kind !== b.kind) return false;
  return (a.kind === 'work' || a.kind === 'foundation')
    ? a.index === (b as { index: number }).index
    : true;
}

export type NertzMove =
  | { kind: 'draw'; seat: Seat }
  | { kind: 'play'; seat: Seat; from: NertzPile; to: NertzPile; count: number };

// --- the deal ---------------------------------------------------------------

/**
 * A fresh round. Each player gets a deck of their own, which is why a card's
 * id carries the seat: two of them are the seven of hearts, and a sprite is
 * kept per id.
 */
export function deal(workPiles: number = DEFAULT_WORK_PILES, random: () => number = Math.random): NertzState {
  const hands = SEATS.map((seat) => dealHand(seat, workPiles, random)) as [Hand, Hand];
  return { hands, foundations: Array.from({ length: FOUNDATIONS }, () => []), up: [0, 0] };
}

function dealHand(seat: Seat, workPiles: number, random: () => number): Hand {
  const deck = shuffledDeck(random).map((card) => ({ ...card, id: `p${seat}-${card.id}`, faceUp: false }));
  const nertz = deck.splice(0, NERTZ_PILE_SIZE);
  // Only the one you can play is turned over.
  nertz[nertz.length - 1].faceUp = true;
  const work = deck.splice(0, workPiles).map((card) => [{ ...card, faceUp: true }]);
  return { nertz, work, stock: deck, waste: [] };
}

// --- what is legal ----------------------------------------------------------

/** Whether `card` can be laid on a work pile as it stands. An empty one takes anything. */
export function canPlayOnWork(card: Card, pile: readonly Card[]): boolean {
  if (pile.length === 0) return true;
  const top = pile[pile.length - 1];
  return isRed(card.suit) !== isRed(top.suit) && rankValue(top.rank) - rankValue(card.rank) === 1;
}

/** Whether `card` can go on a foundation: an ace on an empty one, else the next of its suit. */
export function canPlayOnFoundation(card: Card, pile: readonly Card[]): boolean {
  if (pile.length === 0) return card.rank === 'A';
  const top = pile[pile.length - 1];
  return top.suit === card.suit && rankValue(card.rank) === rankValue(top.rank) + 1;
}

/** The cards a player could pick up from here, or undefined if they may not. */
export function liftable(
  state: NertzState, seat: Seat, from: NertzPile, count: number,
): readonly Card[] | undefined {
  const hand = state.hands[seat];
  switch (from.kind) {
    case 'nertz':
    case 'waste': {
      const pile = hand[from.kind];
      return count === 1 && pile.length > 0 ? pile.slice(-1) : undefined;
    }
    case 'work': {
      const pile = hand.work[from.index];
      if (!pile || count < 1 || count > pile.length) return undefined;
      return pile.slice(pile.length - count);
    }
    // A card on a foundation is there for good, and nobody's stock is picked up.
    default:
      return undefined;
  }
}

export function canDrop(
  state: NertzState, seat: Seat, cards: readonly Card[], to: NertzPile,
): boolean {
  if (cards.length === 0) return false;
  if (to.kind === 'foundation') {
    const pile = state.foundations[to.index];
    return !!pile && cards.length === 1 && canPlayOnFoundation(cards[0], pile);
  }
  if (to.kind === 'work') {
    const pile = state.hands[seat].work[to.index];
    return !!pile && canPlayOnWork(cards[0], pile);
  }
  return false;
}

// --- moves ------------------------------------------------------------------

/** What happened, for a scene that wants to animate it. */
export interface NertzResult {
  state: NertzState;
  move: NertzMove;
  recycled?: boolean;
}

export function apply(state: NertzState, move: NertzMove): NertzResult | undefined {
  return move.kind === 'draw' ? draw(state, move) : play(state, move);
}

function draw(state: NertzState, move: NertzMove & { kind: 'draw' }): NertzResult | undefined {
  const hand = state.hands[move.seat];
  if (hand.stock.length === 0) {
    if (hand.waste.length === 0) return undefined;
    // Turn the waste over: the card that was drawn first comes out first again.
    const turned = [...hand.waste].reverse().map((card) => ({ ...card, faceUp: false }));
    return { state: withHand(state, move.seat, { ...hand, stock: turned, waste: [] }), move, recycled: true };
  }
  const stock = hand.stock.slice();
  const drawn = stock.splice(-DRAW_COUNT).reverse().map((card) => ({ ...card, faceUp: true }));
  return { state: withHand(state, move.seat, { ...hand, stock, waste: [...hand.waste, ...drawn] }), move };
}

function play(state: NertzState, move: NertzMove & { kind: 'play' }): NertzResult | undefined {
  const { seat, from, to, count } = move;
  const cards = liftable(state, seat, from, count);
  if (!cards || !canDrop(state, seat, cards, to)) return undefined;
  // Moving a pile onto itself is not a move.
  if (sameNertzPile(from, to)) return undefined;

  const hand = state.hands[seat];
  let nextHand: Hand = {
    ...hand, work: hand.work.map((pile) => pile.slice()),
    nertz: hand.nertz.slice(), waste: hand.waste.slice(),
  };
  const source = from.kind === 'work' ? nextHand.work[from.index] : nextHand[from.kind as 'nertz' | 'waste'];
  source.splice(source.length - count, count);
  // The next card of the Nertz pile turns over as the one on top leaves.
  if (from.kind === 'nertz' && source.length > 0) {
    source[source.length - 1] = { ...source[source.length - 1], faceUp: true };
  }

  let foundations = state.foundations;
  let up = state.up;
  if (to.kind === 'work') {
    nextHand.work[to.index].push(...cards);
  } else if (to.kind === 'foundation') {
    foundations = foundations.map((pile, i) => (i === to.index ? [...pile, ...cards] : pile));
    up = [...up] as [number, number];
    up[seat] += 1;
  }
  const hands = [...state.hands] as [Hand, Hand];
  hands[seat] = nextHand;
  return { state: { hands, foundations, up }, move };
}

function withHand(state: NertzState, seat: Seat, hand: Hand): NertzState {
  const hands = [...state.hands] as [Hand, Hand];
  hands[seat] = hand;
  return { ...state, hands };
}

/**
 * The foundation a card would go to, preferring a started one: an ace opens
 * the first empty place and anything else follows its own suit.
 */
export function foundationFor(state: NertzState, card: Card): number | undefined {
  const started = state.foundations.findIndex((pile) => pile.length > 0 && canPlayOnFoundation(card, pile));
  if (started >= 0) return started;
  if (card.rank !== 'A') return undefined;
  const empty = state.foundations.findIndex((pile) => pile.length === 0);
  return empty >= 0 ? empty : undefined;
}

/**
 * Where a tap on this card should send it: a foundation if there is one, and
 * otherwise a work pile that already has something on it. Never an empty work
 * pile - which one of them, and whether it is worth emptying a pile to
 * use it, is not a decision to make for somebody.
 */
export function autoTarget(
  state: NertzState, seat: Seat, from: NertzPile, count: number,
): NertzPile | undefined {
  const cards = liftable(state, seat, from, count);
  if (!cards) return undefined;
  if (count === 1) {
    const home = foundationFor(state, cards[0]);
    if (home !== undefined) return { kind: 'foundation', index: home };
  }
  const work = state.hands[seat].work;
  for (let index = 0; index < work.length; index++) {
    if (from.kind === 'work' && from.index === index) continue;
    if (work[index].length > 0 && canPlayOnWork(cards[0], work[index])) return { kind: 'work', index };
  }
  return undefined;
}

// --- both players stuck ------------------------------------------------------

/**
 * Whose Stuck chip is in the middle of the table.
 *
 * Nothing here tries to work out whether the players are stuck. It used to,
 * and a guess at "no move left" that is wrong either way is worse than no
 * guess: the players can see the table, so they say so themselves. Each has
 * a chip; throwing it into the middle says "I am stuck", and once both are
 * in, every hand is moved on a card (see unstick) and the chips come home.
 */
export type Chips = [boolean, boolean];

export function noChips(): Chips {
  return [false, false];
}

export function throwChip(chips: Chips, seat: Seat): Chips {
  const next: Chips = [...chips];
  next[seat] = true;
  return next;
}

/** Taken back by hand, or by playing a card - which is not being stuck. */
export function takeBackChip(chips: Chips, seat: Seat): Chips {
  const next: Chips = [...chips];
  next[seat] = false;
  return next;
}

export function bothStuck(chips: Chips): boolean {
  return chips[0] && chips[1];
}

/**
 * One hand, moved on a card.
 *
 * The three cards showing on the waste - the last turn, say 2, 5, 7 with the
 * 7 on top - go back onto the stock as they came off it, and then the first
 * of them, the 2, goes to the very bottom of the stock. So the next turn
 * comes up 5, 7 and a card that was never in that three, and every turn
 * after it falls one card later than it did. The rest of the waste stays
 * where it is. With nothing on the waste, the top card of the stock - the
 * first one the next turn would take - goes to the bottom.
 *
 * In array terms a pile's last card is its top: draw() takes the stock's
 * last three and lays them on the waste in reverse, so putting them back is
 * the same three reversed onto the end of the stock.
 */
export function cycleHand(hand: Hand): Hand {
  const showing = hand.waste.slice(-DRAW_COUNT);
  const waste = hand.waste.slice(0, hand.waste.length - showing.length);
  const stock = [...hand.stock, ...[...showing].reverse().map((card) => ({ ...card, faceUp: false }))];
  if (stock.length < 2) return { ...hand, stock, waste };
  const top = stock.pop()!;
  return { ...hand, stock: [top, ...stock], waste };
}

/** Both players threw their chip in: every hand moves on a card. */
export function unstick(state: NertzState): NertzState {
  return { ...state, hands: [cycleHand(state.hands[0]), cycleHand(state.hands[1])] };
}

// --- ending a round, and a match --------------------------------------------

export function canCallNertz(state: NertzState, seat: Seat): boolean {
  return state.hands[seat].nertz.length === 0;
}

/** What each player made of one round: a point a card up, two off a card left. */
export function roundScores(state: NertzState): [number, number] {
  return [0, 1].map(
    (seat) => state.up[seat] - PENALTY_PER_CARD * state.hands[seat].nertz.length,
  ) as [number, number];
}

export interface RoundResult {
  scores: [number, number];
  up: [number, number];
  left: [number, number];
  // The seat that called Nertz, if anybody did. Calling it does not win the
  // round by itself - it only ends it.
  nertz?: Seat;
}

export function finishRound(state: NertzState, nertz?: Seat): RoundResult {
  return {
    scores: roundScores(state),
    up: [...state.up] as [number, number],
    left: [state.hands[0].nertz.length, state.hands[1].nertz.length],
    nertz,
  };
}

export interface Match {
  target: number;
  totals: [number, number];
  rounds: RoundResult[];
}

export function newMatch(target: number = DEFAULT_TARGET): Match {
  return { target, totals: [0, 0], rounds: [] };
}

export function addRound(match: Match, round: RoundResult): Match {
  return {
    ...match,
    totals: [match.totals[0] + round.scores[0], match.totals[1] + round.scores[1]],
    rounds: [...match.rounds, round],
  };
}

/**
 * Who has won the match, if anybody has. The first to reach the target; if
 * both cross it in the same round the higher total takes it, and a dead heat
 * settles nothing, so the match goes on another round.
 */
export function matchWinner(match: Match): Seat | undefined {
  const [a, b] = match.totals;
  if (a < match.target && b < match.target) return undefined;
  if (a === b) return undefined;
  return a > b ? 0 : 1;
}
