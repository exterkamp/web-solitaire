import { SUITS, Suit, rankValue, sameColour } from './config';
import { Card } from './deck';

// The rules both games agree on.
//
// Klondike and FreeCell are different games that happen to share most of a
// rulebook: a foundation is built up in suit from the ace, and a tableau run
// is built down in alternating colours. What they disagree about is narrow
// and is left to each of them - what an empty column will take, how many
// cards may move at once, whether there is a deck at all.
//
// Kept here rather than in either game so that neither imports the other.
// Two games reaching into each other's rules is how the second one ends up
// quietly constrained by the first.

export function topOf(pile: readonly Card[]): Card | undefined {
  return pile[pile.length - 1];
}

/** Which foundation a suit goes home to. */
export function foundationIndexOf(suit: Suit): number {
  return SUITS.indexOf(suit);
}

/** Aces start a foundation; after that it is the same suit, one higher. */
export function canPlaceOnFoundation(card: Card, foundation: readonly Card[]): boolean {
  const top = topOf(foundation);
  if (!top) return card.rank === 'A';
  return card.suit === top.suit && rankValue(card.rank) === rankValue(top.rank) + 1;
}

/**
 * Whether `card` builds down on `onto`: the other colour, one lower.
 *
 * Only the occupied case. An empty column is where the two games part - a
 * king only in Klondike, anything at all in FreeCell - so each answers that
 * for itself.
 */
export function buildsDown(card: Card, onto: Card): boolean {
  if (!onto.faceUp) return false;
  return !sameColour(card.suit, onto.suit) && rankValue(card.rank) === rankValue(onto.rank) - 1;
}

/**
 * Whether the cards from `index` to the top of a pile form a run that can be
 * picked up together: all face up, descending, alternating colour.
 *
 * How many of them may actually move is a separate question, and one the two
 * games answer differently - Klondike moves a run of any length, FreeCell
 * only as many as it has room to shuffle through.
 */
export function isRun(pile: readonly Card[], index: number): boolean {
  if (index < 0 || index >= pile.length) return false;
  for (let i = index; i < pile.length; i++) {
    if (!pile[i].faceUp) return false;
    if (i > index && !buildsDown(pile[i], pile[i - 1])) return false;
  }
  return true;
}
