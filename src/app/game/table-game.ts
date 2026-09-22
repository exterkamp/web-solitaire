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

export type GameId =
  // Build down, sort up, dig for what is buried.
  | 'klondike'
  | 'freecell'
  | 'yukon'
  | 'spiderette'
  | 'scorpion'
  // Match what you can see and clear it away.
  | 'tripeaks'
  | 'pyramid'
  | 'golf'
  | 'acesup';

const GAME_IDS: readonly GameId[] = [
  'klondike', 'freecell', 'yukon', 'spiderette', 'scorpion',
  'tripeaks', 'pyramid', 'golf', 'acesup',
];

/** One pile, and what is in it. The board draws piles in the order given. */
export interface PileCards {
  ref: PileRef;
  cards: readonly Card[];
}

/**
 * A pile as it is printed on the felt, before any cards are dealt onto it.
 *
 * Most games lay their piles out in columns and two rows, and say so with
 * `column` and `row`. A game whose board is not a grid - three overlapping
 * peaks, say - gives `x` and `y` in board units instead, and those win.
 */
export interface PileSlot {
  ref: PileRef;
  // Which column of the board, counted from the left at this game's width.
  column: number;
  // Top row or tableau row.
  row: 'top' | 'tableau';
  // Or an exact place, for a layout that is not a grid.
  x?: number;
  y?: number;
  // The faint suit printed in an empty foundation, and the arrow printed on
  // an empty stock. Both say what a slot is for while nothing is on it.
  ghost?: Card['suit'];
  recycle?: boolean;
  // Whether the felt is marked where this pile goes. True unless said
  // otherwise: an empty foundation is a place a card belongs, but a cleared
  // position on a peak is just table again.
  printed?: boolean;
  // Whether a card can be dropped here. Defaults to "anything but the stock
  // and the waste", which is right for the games that build on their piles
  // and wrong for the one whose piles are only ever emptied.
  target?: boolean;
}

/** What the heads-up display shows beyond the clock and the move count. */
export interface GameView {
  score?: number;
  stock?: number;
  // Cards still in the deck, when that is a number the player is playing
  // against rather than plumbing. Klondike keeps `stock` for the finish
  // heuristic and does not show it; Spiderette's four remaining rows are the
  // clock the whole hand is run against.
  deck?: number;
  waste?: number;
  free?: number;
  // Cards still face down. Yukon's only measure of progress, and the one
  // number in that game worth watching.
  hidden?: number;
  // How many cards have come off the peaks without turning the deck, and how
  // many are left on them. TriPeaks' two numbers: the first is what you are
  // playing for and the second is how far there is to go.
  run?: number;
  left?: number;
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
  /**
   * The foundation a card belongs to, for a throw that names no pile.
   *
   * Absent in a game with no foundations. The board then has no answer for a
   * flick and gives none - which is better than inventing one, because the
   * only pile TriPeaks could send a card to is the discard, and a flick that
   * meant the same as a tap would fire on every card somebody lifted to look
   * at.
   */
  homeFor?(card: Card): PileRef;
  view(state: S): GameView;

  // --- how a hand arrives --------------------------------------------------

  /**
   * Whether the whole layout slides down the board to sit under a thumb.
   *
   * True for the games laid out in columns, where the room a long pile might
   * need is reserved whether it is used or not - see MAX_BOARD_DROP. False
   * for a game that places every pile itself and has already decided where
   * the bottom of its board is.
   */
  readonly drops: boolean;

  /**
   * Whether the move count is worth showing.
   *
   * True where a move is a decision - fewest moves is a real measure of a
   * game of Klondike or FreeCell. False in TriPeaks, where a move is a tap on
   * whatever you spotted, the count only ever goes up, and it is the fifth
   * number competing for four hundred pixels of bar.
   */
  readonly showsMoves: boolean;

  /**
   * Where the cards fly in from when a game is dealt, in board units.
   *
   * Klondike's is the stock, which is where they would come from at a real
   * table. A game with no stock has them arrive from the middle of the top
   * row - out of the dealer's hand rather than off a pile.
   *
   * Only the tableau is dealt card by card. Everything else is simply there
   * when the dealing stops, which is what it looks like when somebody deals a
   * hand in front of you.
   */
  dealOrigin(handedness: Handedness): { x: number; y: number };

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

/**
 * A game named in an address, guarded.
 *
 * Routes are user-writable in the same way localStorage is - typed, shared,
 * bookmarked from a version that had different games - so an unknown name
 * deals the one everybody means by "solitaire" rather than a blank board.
 */
export function asGameId(value: unknown): GameId {
  return GAME_IDS.includes(value as GameId) ? (value as GameId) : 'klondike';
}
