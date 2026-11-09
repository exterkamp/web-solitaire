import { RANKS, SUITS } from './config';
import { Card, shuffle } from './deck';
import { Move, PileRef } from './piles';

// Blackjack, as rules rather than as a screen.
//
// You against the dealer, for chips, through a two-deck shoe. The rules are
// the common casino ones and nothing more: the dealer stands on all
// seventeens, soft ones included, and peeks for blackjack under an ace or a
// ten; a blackjack pays three to two; you may double on any first two cards
// - one more card, and the bet is doubled - and split a pair once. No
// insurance and no surrender.
//
// A hand of this game, as the rest of the table counts hands, is a shoe: it
// starts from whatever you finished the last one with, ends at the cut card
// or when you cannot cover the smallest bet, and is won by leaving with more
// than you sat down with.

export const DECKS = 2;
/** Cards left in the shoe at which it is over: about a quarter of it. */
export const CUT = 26;
export const BETS = [10, 20, 50] as const;
/** What a shoe starts with when there is nothing to carry over. */
export const STARTING_BANK = 100;

export type Phase = 'bet' | 'play' | 'over';

export interface Hand {
  cards: Card[];
  bet: number;
  // Stood, bust, doubled, or a split ace with its one card: no more cards.
  done: boolean;
  // Split hands never count as a blackjack, and split aces get one card.
  split: boolean;
}

export interface BlackjackState {
  stock: Card[];
  // Cards played and gathered up, face down.
  waste: Card[];
  dealer: Card[];
  hands: Hand[];
  // The hand being played.
  active: number;
  phase: Phase;
  // Chips in front of you, not counting what is bet on the table.
  bank: number;
  // What the shoe started with, which is what a win is measured against.
  start: number;
  // How the last hand went, to show until the next one is dealt.
  last?: string;
  moves: number;
}

export interface MoveResult {
  state: BlackjackState;
  move: Move;
}

// --- the count ------------------------------------------------------------

const cardValue = (card: Card) => {
  const index = RANKS.indexOf(card.rank);
  if (index === 0) return 1;
  return Math.min(10, index + 1);
};

/** A hand's best total, and whether an ace in it is still counting eleven. */
export function total(cards: readonly Card[]): { value: number; soft: boolean } {
  let value = 0;
  let aces = 0;
  for (const card of cards) {
    if (!card.faceUp) continue;
    value += cardValue(card);
    if (card.rank === 'A') aces++;
  }
  const soft = aces > 0 && value + 10 <= 21;
  return { value: soft ? value + 10 : value, soft };
}

export const isBlackjack = (hand: Hand): boolean =>
  !hand.split && hand.cards.length === 2 && total(hand.cards).value === 21;

const dealerBlackjack = (cards: readonly Card[]) =>
  cards.length === 2 && total(cards.map((card) => ({ ...card, faceUp: true }))).value === 21;

export const isBust = (cards: readonly Card[]): boolean => total(cards).value > 21;

// --- dealing --------------------------------------------------------------

/** Two decks, each card told apart from its twin by which deck it is from. */
export function shoe(random: () => number = Math.random): Card[] {
  const cards: Card[] = [];
  for (let deck = 0; deck < DECKS; deck++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ id: `${suit}-${rank}-${deck}`, suit, rank, faceUp: false });
    }
  }
  return shuffle(cards, random);
}

export function deal(bank: number, random: () => number = Math.random): BlackjackState {
  const start = bank >= BETS[0] ? bank : STARTING_BANK;
  return {
    stock: shoe(random),
    waste: [],
    dealer: [],
    hands: [],
    active: 0,
    phase: 'bet',
    bank: start,
    start,
    moves: 0,
  };
}

export function cloneState(state: BlackjackState): BlackjackState {
  const copy = (pile: readonly Card[]) => pile.map((card) => ({ ...card }));
  return {
    ...state,
    stock: copy(state.stock),
    waste: copy(state.waste),
    dealer: copy(state.dealer),
    hands: state.hands.map((hand) => ({ ...hand, cards: copy(hand.cards) })),
  };
}

function draw(state: BlackjackState, faceUp = true): Card {
  const card = state.stock.pop()!;
  card.faceUp = faceUp;
  return card;
}

// --- what can be done -----------------------------------------------------

const activeHand = (state: BlackjackState): Hand | undefined =>
  state.phase === 'play' ? state.hands[state.active] : undefined;

export function canBet(state: BlackjackState, amount: number): boolean {
  return state.phase === 'bet' && state.bank >= amount;
}

export function canDouble(state: BlackjackState): boolean {
  const hand = activeHand(state);
  return !!hand && hand.cards.length === 2 && !hand.done && state.bank >= hand.bet;
}

export function canSplit(state: BlackjackState): boolean {
  const hand = activeHand(state);
  return (
    !!hand && state.hands.length === 1 && hand.cards.length === 2 &&
    hand.cards[0].rank === hand.cards[1].rank && state.bank >= hand.bet
  );
}

export type Action = 'hit' | 'stand' | 'double' | 'split' | `bet-${number}`;

export function actions(state: BlackjackState): { id: Action; label: string; enabled: boolean }[] {
  if (state.phase === 'bet') {
    return BETS.map((amount) => ({ id: `bet-${amount}` as Action, label: `Bet ${amount}`, enabled: canBet(state, amount) }));
  }
  if (state.phase === 'play') {
    return [
      { id: 'hit', label: 'Hit', enabled: true },
      { id: 'stand', label: 'Stand', enabled: true },
      { id: 'double', label: 'Double', enabled: canDouble(state) },
      { id: 'split', label: 'Split', enabled: canSplit(state) },
    ];
  }
  return [];
}

// --- playing --------------------------------------------------------------

export function act(state: BlackjackState, action: string): MoveResult | undefined {
  const move: Move = { kind: 'draw' };
  const next = cloneState(state);
  if (action.startsWith('bet-')) {
    const amount = Number(action.slice(4));
    if (!(BETS as readonly number[]).includes(amount) || !canBet(state, amount)) return undefined;
    placeBet(next, amount);
  } else if (state.phase === 'play') {
    const hand = next.hands[next.active];
    switch (action) {
      case 'hit':
        hand.cards.push(draw(next));
        if (total(hand.cards).value >= 21) hand.done = true;
        break;
      case 'stand':
        hand.done = true;
        break;
      case 'double':
        if (!canDouble(state)) return undefined;
        next.bank -= hand.bet;
        hand.bet *= 2;
        hand.cards.push(draw(next));
        hand.done = true;
        break;
      case 'split':
        if (!canSplit(state)) return undefined;
        splitHand(next);
        break;
      default:
        return undefined;
    }
    advance(next);
  } else {
    return undefined;
  }
  next.moves = state.moves + 1;
  return { state: next, move };
}

function placeBet(state: BlackjackState, amount: number): void {
  // Last hand's cards go into the discard, face down.
  for (const card of [...state.dealer, ...state.hands.flatMap((hand) => hand.cards)]) {
    card.faceUp = false;
    state.waste.push(card);
  }
  state.bank -= amount;
  state.last = undefined;
  const hand: Hand = { cards: [], bet: amount, done: false, split: false };
  state.hands = [hand];
  state.active = 0;
  // Player, dealer, player, dealer - the second of the dealer's face down.
  hand.cards.push(draw(state));
  state.dealer = [draw(state)];
  hand.cards.push(draw(state));
  state.dealer.push(draw(state, false));
  state.phase = 'play';

  // The dealer peeks under an ace or a ten, and a blackjack either side
  // settles the hand before anybody plays it.
  const peeks = cardValue(state.dealer[0]) === 1 || cardValue(state.dealer[0]) === 10;
  if ((peeks && dealerBlackjack(state.dealer)) || isBlackjack(hand)) {
    hand.done = true;
    settle(state);
  }
}

function splitHand(state: BlackjackState): void {
  const hand = state.hands[0];
  const second = hand.cards.pop()!;
  state.bank -= hand.bet;
  hand.split = true;
  const other: Hand = { cards: [second], bet: hand.bet, done: false, split: true };
  state.hands.push(other);
  hand.cards.push(draw(state));
  other.cards.push(draw(state));
  // Split aces get one card each and no more.
  if (hand.cards[0].rank === 'A') {
    hand.done = true;
    other.done = true;
  }
  for (const h of state.hands) if (total(h.cards).value === 21) h.done = true;
}

/** On to the next hand still to play, or to the dealer once there is none. */
function advance(state: BlackjackState): void {
  const next = state.hands.findIndex((hand) => !hand.done);
  if (next >= 0) {
    state.active = next;
    return;
  }
  settle(state);
}

// How a single hand's result reads in the line under the table.
const SAID: Record<string, string> = {
  bust: 'you bust', win: 'you win', lose: 'you lose', push: 'push',
  blackjack: 'blackjack!', 'dealer blackjack': 'dealer blackjack',
};

/** The dealer turns the hole card, draws to seventeen, and the bets are paid. */
function settle(state: BlackjackState): void {
  state.dealer[1].faceUp = true;
  const live = state.hands.some((hand) => !isBust(hand.cards) && !isBlackjack(hand));
  // Nothing to draw to when every hand is bust or already paid.
  if (live && !dealerBlackjack(state.dealer)) {
    while (total(state.dealer).value < 17 && state.stock.length) state.dealer.push(draw(state));
  }
  const dealer = total(state.dealer).value;
  const dealerBJ = dealerBlackjack(state.dealer);
  const results: string[] = [];
  let net = 0;
  for (const hand of state.hands) {
    const mine = total(hand.cards).value;
    let paid: number;
    let word: string;
    if (isBust(hand.cards)) [paid, word] = [0, 'bust'];
    else if (isBlackjack(hand) && !dealerBJ) [paid, word] = [hand.bet + (hand.bet * 3) / 2, 'blackjack'];
    else if (dealerBJ && !isBlackjack(hand)) [paid, word] = [0, 'dealer blackjack'];
    else if (isBlackjack(hand) && dealerBJ) [paid, word] = [hand.bet, 'push'];
    else if (dealer > 21 || mine > dealer) [paid, word] = [hand.bet * 2, 'win'];
    else if (mine === dealer) [paid, word] = [hand.bet, 'push'];
    else [paid, word] = [0, 'lose'];
    state.bank += paid;
    net += paid - hand.bet;
    results.push(state.hands.length > 1 ? `${mine} ${word}` : SAID[word] ?? word);
  }
  const sign = net > 0 ? `+${net}` : net < 0 ? `${net}` : 'even';
  state.last = `Dealer ${dealer > 21 ? `${dealer} bust` : dealer} · ${results.join(', ')} · ${sign}`;
  state.phase = shoeIsOver(state) ? 'over' : 'bet';
}

const shoeIsOver = (state: BlackjackState) => state.stock.length < CUT || state.bank < BETS[0];

// --- reading the table ----------------------------------------------------

export const hasWon = (state: BlackjackState): boolean => state.phase === 'over' && state.bank > state.start;
export const isDeadEnd = (state: BlackjackState): boolean => state.phase === 'over' && state.bank <= state.start;

/** The line under the table: totals while a hand is played, its result after. */
export function status(state: BlackjackState): string {
  if (state.phase !== 'play') return state.last ?? 'Place a bet';
  const up = total([state.dealer[0]]).value;
  const yours = state.hands.map((hand, i) => {
    const { value, soft } = total(hand.cards);
    const shown = soft && value < 21 ? `soft ${value}` : `${value}`;
    return state.hands.length > 1 ? `${i === state.active ? '▸ ' : ''}hand ${i + 1}: ${shown}` : `You ${shown}`;
  });
  return `Dealer shows ${up === 11 ? 'an ace' : up} · ${yours.join(' · ')}`;
}

/** What a shoe that did not come out ahead says, in the hand-over panel. */
export function note(state: BlackjackState): string | undefined {
  if (state.phase !== 'over') return undefined;
  const change = state.bank - state.start;
  const why = state.bank < BETS[0] ? 'Not enough left for a bet.' : 'The shoe is down to the cut card.';
  return `${why} ${change === 0 ? 'Even' : `Down ${-change}`} on the ${state.start} you sat down with.`;
}

export const pileRefs = {
  stock: { kind: 'stock', index: 0 } as PileRef,
  waste: { kind: 'waste', index: 0 } as PileRef,
  dealer: { kind: 'tableau', index: 0 } as PileRef,
  hand: (i: number) => ({ kind: 'tableau', index: i + 1 }) as PileRef,
};
