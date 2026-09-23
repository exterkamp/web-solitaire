import { RANKS, SUITS, Suit, rankValue, sameColour } from './config';
import { Card } from './deck';

const RANK_COUNT = RANKS.length;

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

/**
 * Whether `card` builds down on `onto` in the same suit: the Spider family's
 * rule rather than Klondike's.
 *
 * The difference is the whole of what makes those games hard. Klondike lets
 * you park a red seven on a black eight and get on with it; Spiderette and
 * Scorpion only let you build a run you could actually move later, so every
 * convenient placement is a card buried on purpose.
 */
export function buildsDownInSuit(card: Card, onto: Card): boolean {
  if (!onto.faceUp) return false;
  return card.suit === onto.suit && rankValue(card.rank) === rankValue(onto.rank) - 1;
}

/**
 * Whether the cards from `index` to the top of a pile are one suit,
 * descending, and all face up - the handful the Spider family lets you carry.
 */
export function isSuitRun(pile: readonly Card[], index: number): boolean {
  if (index < 0 || index >= pile.length) return false;
  for (let i = index; i < pile.length; i++) {
    if (!pile[i].faceUp) return false;
    if (i > index && !buildsDownInSuit(pile[i], pile[i - 1])) return false;
  }
  return true;
}

/**
 * Whether two cards are neighbours by rank, going round the corner.
 *
 * An ace follows a king and a king follows an ace: the sequence is a ring,
 * not a line. Tri Peaks and Black Hole both turn on it - and Golf turns on
 * its absence, which is why that one keeps its own straight-line version
 * rather than passing a flag to this.
 */
export function isNeighbourWrapping(a: Card, b: Card): boolean {
  const gap = Math.abs(rankValue(a.rank) - rankValue(b.rank));
  return gap === 1 || gap === RANK_COUNT - 1;
}

/**
 * Whether a pile ends in a complete king-to-ace run of one suit - the thing
 * Spiderette and Scorpion are played to produce, and which leaves the table
 * the moment it exists.
 */
export function completedSuit(pile: readonly Card[]): readonly Card[] | undefined {
  if (pile.length < RANK_COUNT) return undefined;
  const run = pile.slice(-RANK_COUNT);
  if (run[0].rank !== 'K' || !isSuitRun(run, 0)) return undefined;
  return run;
}
