// What a pile is called, across every game on this table.
//
// One list rather than one per game, because the board does not care which
// game it is drawing: it moves cards between piles, and a pile is a kind and
// a number. Klondike uses four of these and FreeCell uses three, and neither
// has to know about the other's.
export type PileKind = 'stock' | 'waste' | 'foundation' | 'tableau' | 'cell';

/**
 * Which pile. `index` is the column or slot number, and is ignored - by
 * convention 0 - for the piles there is only one of, like Klondike's stock.
 */
export interface PileRef {
  kind: PileKind;
  index: number;
}

export function samePile(a: PileRef, b: PileRef): boolean {
  return a.kind === b.kind && a.index === b.index;
}

/** A pile as a string, for the maps and lookups that need one. */
export function pileKey(ref: PileRef): string {
  return `${ref.kind}-${ref.index}`;
}

/**
 * A move, in the only two shapes a game on this table has: turn the deck, or
 * carry some cards from one pile to another.
 *
 * Shared so the board can hold a move without knowing whose it is. FreeCell
 * has no deck and simply never makes the first kind - and refuses it if
 * handed one, rather than pretending it means something.
 */
export type Move =
  | { kind: 'draw' }
  | { kind: 'play'; from: PileRef; to: PileRef; count: number };
