import { Handedness } from './settings-types';
import { Card } from './deck';
import { Move, PileRef } from './piles';

// What the board needs to know about a game in order to deal it, draw it and
// let somebody play it - and nothing else.
//
// The board is one scene shared by both games. It owns the parts that are
// about a screen rather than about cards: picking a run up, following a
// thumb, deciding what a release meant, animating a card from one place to
// another, and the fifty-two cards that bounce out of a won game. None of
// that differs between Klondike and FreeCell, and the moment it was written
// twice it would start to differ by accident.
//
// So each game supplies this instead: its rules, and where its piles sit.
// Neither game knows the board exists, and the board has never heard of a
// stock or a free cell.

export type GameId = 'klondike' | 'freecell';

/** One pile, and what is in it. The board draws piles in the order given. */
export interface PileCards {
  ref: PileRef;
  cards: readonly Card[];
}

/** A pile as it is printed on the felt, before any cards are dealt onto it. */
export interface PileSlot {
  ref: PileRef;
  // Which column of the board, counted from the left at this game's width.
  column: number;
  // Top row or tableau row.
  row: 'top' | 'tableau';
  // The faint suit printed in an empty foundation, and the arrow printed on
  // an empty stock. Both say what a slot is for while nothing is on it.
  ghost?: Card['suit'];
  recycle?: boolean;
}

/** What the heads-up display shows beyond the clock and the move count. */
export interface GameView {
  score?: number;
  stock?: number;
  waste?: number;
  free?: number;
}

export interface TableGame<S> {
  readonly id: GameId;
  /** Shown on the board's printed layout, in the lettering of a casino felt. */
  readonly label: string;

  // --- the shape of the table ---------------------------------------------

  /** Board units across. Eight columns need more room than seven. */
  readonly width: number;
  readonly columns: number;
  /** Where every pile is printed, at the given handedness. */
  slots(handedness: Handedness): PileSlot[];
  /**
   * How far down its pile the card at `index` sits, before any squeezing.
   * Zero for a pile that stacks squarely, which is most of them.
   */
  fanStep(ref: PileRef, cards: readonly Card[], index: number): number;
  /** Whether a pile fans upward out of its slot rather than downward. */
  fansUp(ref: PileRef): boolean;

  // --- the rules -----------------------------------------------------------

  deal(random?: () => number): S;
  piles(state: S): PileCards[];
  moveCount(state: S): number;
  liftable(state: S, from: PileRef, count: number): readonly Card[] | undefined;
  canDrop(state: S, cards: readonly Card[], to: PileRef): boolean;
  apply(state: S, move: Move): TableMoveResult<S> | undefined;
  autoTarget(state: S, from: PileRef, count: number): PileRef | undefined;
  autoFinishMove(state: S): Move | undefined;
  canAutoFinish(state: S): boolean;
  hasWon(state: S): boolean;
  isDeadEnd(state: S): boolean;
  /** The foundation a card belongs to, for a throw that names no pile. */
  homeFor(card: Card): PileRef;
  view(state: S): GameView;

  // --- how a hand arrives --------------------------------------------------

  /**
   * Where the cards fly in from when a game is dealt.
   *
   * Klondike's is the stock, which is where they would come from at a real
   * table. FreeCell has no stock, so its cards arrive from the middle of the
   * top row - out of the dealer's hand rather than off a pile.
   *
   * Only the tableau is dealt card by card, in both games. Everything else is
   * simply there when the dealing stops, which is what it looks like when
   * somebody deals a hand in front of you.
   */
  dealOrigin(handedness: Handedness): { column: number; row: 'top' | 'tableau' };

  /**
   * Whether the tableau is dealt face down and turned over as it lands.
   *
   * True of Klondike, where that turning over is the deal: it is what tells
   * you which cards you were given. False of FreeCell, where nothing is ever
   * hidden - fifty-two cards each flipping on arrival would be a lot of
   * ceremony about a fact the game does not have.
   */
  readonly dealsFaceDown: boolean;
}

export interface TableMoveResult<S> {
  state: S;
  move: Move;
  moved?: readonly Card[];
  flipped?: Card;
  drawn?: readonly Card[];
  recycled?: boolean;
  points?: number;
}
