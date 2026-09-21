import { RANKS, Rank, SUITS, Suit } from './config';

// One card. `faceUp` is part of the card rather than of the pile holding it
// because in Klondike it is genuinely per-card: a tableau pile is some
// number of face-down cards with some number of face-up ones on top, and the
// boundary between them moves as the pile is played off.
export interface Card {
  // Stable for the life of a deal, which the board leans on: sprites are
  // kept in a map keyed by id and reused across renders rather than being
  // destroyed and rebuilt every time a pile changes.
  id: string;
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
}

export function cardName(card: Card): string {
  return `${card.rank} of ${card.suit}`;
}

// A fresh 52-card deck, in order, all face down.
//
// The id is the suit and rank rather than a counter, which is only safe
// because a solitaire deck holds exactly one of each card - and is worth it
// for what it does to a failing test, where `spades-K` says which card went
// wrong and `card-37` does not.
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: `${suit}-${rank}`, suit, rank, faceUp: false });
    }
  }
  return cards;
}

// Fisher-Yates, against a supplied source of randomness so a deal can be
// repeated. The game passes Math.random; a test passes a seeded one.
export function shuffle(cards: readonly Card[], random: () => number = Math.random): Card[] {
  const deck = cards.map((card) => ({ ...card }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
