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
export const WORK_PILES = 4;
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
export function deal(random: () => number = Math.random): NertzState {
  const hands = SEATS.map((seat) => dealHand(seat, random)) as [Hand, Hand];
  return { hands, foundations: Array.from({ length: FOUNDATIONS }, () => []), up: [0, 0] };
}

function dealHand(seat: Seat, random: () => number): Hand {
  const deck = shuffledDeck(random).map((card) => ({ ...card, id: `p${seat}-${card.id}`, faceUp: false }));
  const nertz = deck.splice(0, NERTZ_PILE_SIZE);
  // Only the one you can play is turned over.
  nertz[nertz.length - 1].faceUp = true;
  const work = deck.splice(0, WORK_PILES).map((card) => [{ ...card, faceUp: true }]);
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
 * pile - which one of the four, and whether it is worth emptying a pile to
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

// --- running out of moves ---------------------------------------------------

// Whether one card, wherever it is, has somewhere worth putting it. A move
// that only shuffles a pile onto an empty pile is not worth anything, so a
// work pile's run counts only if it can land on something that is not empty.
function cardHasMove(state: NertzState, seat: Seat, card: Card, fromWork?: number): boolean {
  if (foundationFor(state, card) !== undefined) return true;
  return state.hands[seat].work.some((pile, i) => i !== fromWork && pile.length > 0 && canPlayOnWork(card, pile));
}

/** Whether a player has a move among the cards they can see, ignoring their stock. */
export function hasVisibleMove(state: NertzState, seat: Seat): boolean {
  const hand = state.hands[seat];
  const nertzTop = hand.nertz[hand.nertz.length - 1];
  const wasteTop = hand.waste[hand.waste.length - 1];
  // Anything may go on an empty work pile, so a card from the Nertz pile or
  // the waste always has somewhere to go while one is empty.
  const emptySpot = hand.work.some((pile) => pile.length === 0);
  if (nertzTop && (emptySpot || cardHasMove(state, seat, nertzTop))) return true;
  if (wasteTop && (emptySpot || cardHasMove(state, seat, wasteTop))) return true;
  return hand.work.some((pile, i) =>
    pile.some((card, start) => {
      // The top card may go up. Anything else moves as a run, and a run that
      // is already sitting on a card it can sit on gains nothing by moving
      // sideways - unless it is the whole pile, which empties a place, or it
      // uncovers a card that can go up.
      const top = start === pile.length - 1;
      if (top && foundationFor(state, card) !== undefined) return true;
      const worthMoving = start === 0 || (start > 0 && foundationFor(state, pile[start - 1]) !== undefined);
      return worthMoving && cardHasMove(state, seat, card, i);
    }),
  );
}

// --- both players stuck ------------------------------------------------------

/**
 * Where the "nobody can move" conversation has got to. The table is stuck
 * when neither player has a move among the cards they can see. They then
 * turn their hands over to be sure, and once each has been through theirs
 * the players are asked whether to carry on or end the round by agreement.
 */
export interface StuckTalk {
  /** Each player has been through their hand since the table last changed. */
  cycled: [boolean, boolean];
  /** "Carry on" was chosen; the prompt stays away until someone turns their hand again. */
  dismissed: boolean;
  /** Each player's half of agreeing to end the round. */
  agreed: [boolean, boolean];
}

export function newTalk(): StuckTalk {
  return { cycled: [false, false], dismissed: false, agreed: [false, false] };
}

export function tableStuck(state: NertzState): boolean {
  return !hasVisibleMove(state, 0) && !hasVisibleMove(state, 1);
}

/** The talk after a move. `after` is the state the move produced. */
export function talkAfter(talk: StuckTalk, after: NertzState, move: NertzMove, recycled: boolean): StuckTalk {
  // Anything that changes the table starts the conversation over.
  if (move.kind === 'play') return newTalk();
  const cycled: [boolean, boolean] = [...talk.cycled];
  if (recycled || after.hands[move.seat].stock.length === 0) cycled[move.seat] = true;
  // Turning a hand over is the table moving on, so a dismissed prompt may return.
  return { cycled, dismissed: false, agreed: talk.agreed };
}

export function promptShowing(state: NertzState, talk: StuckTalk): boolean {
  const seen = (seat: Seat) => talk.cycled[seat] || state.hands[seat].stock.length === 0;
  return tableStuck(state) && seen(0) && seen(1) && !talk.dismissed;
}

/** "Carry on": the prompt goes away until each hand has been turned through again. */
export function carryOn(): StuckTalk {
  return { cycled: [false, false], dismissed: true, agreed: [false, false] };
}

/**
 * A player reached for their hand and there was nothing to turn. With both
 * hands empty no draw ever succeeds, so this is what brings a dismissed
 * prompt back.
 */
export function drawRefused(talk: StuckTalk): StuckTalk {
  return { ...talk, dismissed: false };
}

export function agreeToEnd(talk: StuckTalk, seat: Seat): StuckTalk {
  const agreed: [boolean, boolean] = [...talk.agreed];
  agreed[seat] = true;
  return { ...talk, agreed };
}

export function bothAgreed(talk: StuckTalk): boolean {
  return talk.agreed[0] && talk.agreed[1];
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
