import { CARD_HEIGHT, CARD_WIDTH, cardFaceMetrics } from 'phaser-card-engine';

// Portrait, phone-first base resolution. Phaser's Scale.FIT mode scales this
// uniformly to whatever the device screen is, so these are logical units,
// not real pixels.
export const GAME_WIDTH = 480;
// Shorter than a phone screen on purpose.
//
// How much of a card a fanned pile reveals of the card below it.
//
// Measured off a rendered card rather than picked: the index and its two
// margins, and nothing else. A font box is substantially taller than the
// glyphs inside it - all the leading above the cap and below the baseline is
// empty - and sizing a fan off the box is what leaves a band of blank card
// under every index in a pile.
//
// These live here rather than beside the drawing code because the board's
// layout is arithmetic, and arithmetic should not have to import a renderer
// to know how far apart two cards sit. See card-sprite.ts, which draws the
// corner these describe.
export const CORNER_INK_HALF_HEIGHT = 9.7;
export const CORNER_INK_TOP_MARGIN = 6;
export const CORNER_INK_BOTTOM_MARGIN = 4;

// Which is what the package works out from the same measurements, and the
// two agreeing to the decimal is why the renderer could be swapped for its
// own without a card moving.
export const CARD_PEEK_HEIGHT = cardFaceMetrics(CARD_WIDTH).peek;

// What a face-down card in a pile shows of itself. There is nothing to read
// on the back, so it only has to be visibly a card: enough to see its edge
// and its shadow, and no more, because every unit spent here is a unit the
// face-up cards below it do not get.
export const CARD_BACK_PEEK_HEIGHT = 11;

// Seven columns of cards decide the width, and the width then decides how big
// a card is; the height is what's left to choose, and it used to be chosen
// for the wrong thing - 720 was exactly the tallest fan the rules can
// produce (a king-to-ace run on top of six face-down cards) plus the top row
// above it, and not a unit more. That's a fact about the deepest possible
// hand, not about a phone, and it made the board *2:3* - noticeably squarer
// than a modern phone's own screen, which measures out at .board's actual
// rendered box (padding, HUD and footer already spent) rather than assumed:
// ~.51-.54 on three real sizes checked. Scale.FIT can only ever satisfy one
// of those two ratios, so the board was letterboxed top and bottom by
// however much they disagreed - a visible band of plain page above and below
// the felt, not felt itself, on every phone this was ever looked at on.
//
// 920 is chosen to match that measured range (480/920 ≈ .522) rather than
// the deepest-hand arithmetic, which still holds - it becomes a minimum
// this satisfies rather than a target it hits exactly. The room that opens
// up doesn't go to waste: BOARD_FLOOR and MAX_BOARD_DROP below both grew by
// the same 200 units this did, so the existing "board sits at the bottom of
// the room it's using" mechanic pulls typical hands down into the new space
// instead of leaving it as dead felt past a floor that never moved.
export const GAME_HEIGHT = 920;

// GAME_HEIGHT is the right canvas height for a 480-wide board, and only a
// 480-wide board - it was measured and chosen against GAME_WIDTH, not
// against anything that varies per game. FreeCell, Seahaven, Tri Peaks and
// Pyramid all bring their own width (eight and ten columns, or a shape
// that isn't columns at all), and a wider canvas at the same fixed height
// is a canvas relatively too short for its width - which Scale.FIT resolves
// by fitting to width and leaving the vertical letterboxing right back,
// found the same way the fixed GAME_HEIGHT was: measured on the actual
// device rather than assumed, this time by comparing the rendered canvas
// to its container for five real games. Tri Peaks came out 58px short top
// and bottom; Seahaven, the widest board here, 123px.
//
// This is the fix everywhere the canvas is actually sized: hold the ratio
// GAME_HEIGHT keeps at 480 constant, and scale height with whatever width
// the game in play actually asked for, rather than assuming every game
// wants the same fixed number Klondike does.
export function boardHeight(width: number): number {
  return Math.round((width * GAME_HEIGHT) / GAME_WIDTH);
}

// Poker size is 2.5 x 3.5 inches - a 5:7 ratio - and cards look wrong at
// anything else. The package keeps them in that proportion; 60 units wide is
// its default and this board's binding constraint, which is the one real
// difference between this table and Nertz's: Klondike lays seven piles
// across, and seven cards plus the gaps between them have to fit in 480.
export { CARD_HEIGHT, CARD_WIDTH };

// Seven tableau piles, four foundations, a stock and a waste. Only the
// tableau count sets the column pitch - the top row is laid out into the
// same seven columns so that a foundation sits squarely over the pile it
// feeds.
export const TABLEAU_COUNT = 7;
export const FOUNDATION_COUNT = 4;

// Room at the sides for the rail drawn in table.ts, plus a little more so a
// card near the edge doesn't look wedged against it. The board works out its
// own column pitch from this and its width, which is how eight columns fit a
// wider table without the cards changing size.
export const BOARD_MARGIN = 10;
const SIDE_MARGIN = BOARD_MARGIN;
export const COLUMN_PITCH = (GAME_WIDTH - 2 * SIDE_MARGIN) / TABLEAU_COUNT;

// The centre of column `i`, counted from the left, on a board of the given
// width and column count. Klondike's seven columns in 480 units and
// FreeCell's eight in 546 come out at the same pitch, which is why the cards
// are the same size in both.
export function columnCentre(column: number, width: number, columns: number): number {
  const pitch = (width - 2 * BOARD_MARGIN) / columns;
  return BOARD_MARGIN + pitch / 2 + column * pitch;
}

/** The same, for the board Klondike is laid out on. */
export function columnX(index: number): number {
  return columnCentre(index, GAME_WIDTH, TABLEAU_COUNT);
}

// The top row: stock, waste, a gap, then the four foundations. The gap is
// column 2 and is deliberately empty - it is the room a court card's shoulder
// needs, and it keeps the waste from crowding the first foundation.
//
// High enough to clear the rail by about its own width, and no higher: every
// unit spent up here is a unit the tableau's longest pile does not get.
export const TOP_ROW_Y = 72;
export const STOCK_COLUMN = 0;
export const WASTE_COLUMN = 1;
export const FIRST_FOUNDATION_COLUMN = 3;

// Where the tableau begins, measured to the top edge of the first card, with
// the board pushed as far up as it ever goes. Far enough below the top row
// that a long pile doesn't read as continuing it, and close enough that the
// longest one still finishes above the rail. The band between the two is
// where the layout's lettering is printed - it is the only strip of felt on
// this board that no card ever covers.
export const TABLEAU_TOP_Y = 162;

// The lowest a card's bottom edge may reach, clear of the rail. 200 units
// below where it sat when GAME_HEIGHT was 720 - the same 20-unit clearance
// from the bottom of the board, on a board that's now 200 units taller.
export const BOARD_FLOOR = 900;

// How far down the whole layout slides when the tableau is not using its full
// height, and in what steps.
//
// The measurements above reserve room for the deepest pile Klondike can
// produce - a king-to-ace run on top of six face-down cards - and a game
// spends almost none of its time anywhere near that. The rest of the time
// that reserved room is empty felt at the bottom of the screen, with every
// card up at the top where a thumb holding a phone cannot comfortably reach
// them. So the board sits at the bottom of the space it is actually using,
// and rises only when a pile grows long enough to need the room back.
//
// Stepped rather than continuous, and this is the important part: a layout
// that followed the deepest pile exactly would shift the whole table by the
// height of one index every time that pile gained or lost a card, which is
// most moves. In steps of a step-and-a-bit, the board moves a handful of
// times a game, far enough to be read as deliberate.
//
// The cap used to be four of those steps; it's seven now, the same 260 plus
// the 200 units BOARD_FLOOR gained when GAME_HEIGHT grew to match a real
// phone's own proportions rather than letterboxing above and below a board
// shaped for the deepest hand alone - so a typical hand drops into that new
// room instead of it sitting unused below a floor that never moved. What it
// costs is a band of bare felt above the foundations, which is no loss: a
// table is allowed to have table on it, and nothing was ever played up
// there.
export const MAX_BOARD_DROP = 460;
export const BOARD_DROP_STEP = 65;

// BOARD_FLOOR and MAX_BOARD_DROP above are only right at GAME_HEIGHT - the
// same problem boardHeight solves for a game's width, these two have for
// its height. A game wider than 480 gets a taller canvas than 920 (see
// boardHeight), and without pushing the floor and the drop range down to
// match, the extra room past 920 sits unused below a floor that never
// moved - precisely the bug boardHeight was written to fix, one level up.
// Derived from the two constants above rather than a second pair of magic
// numbers: the 20-unit clearance BOARD_FLOOR keeps below GAME_HEIGHT, and
// the 440-unit gap MAX_BOARD_DROP keeps below BOARD_FLOOR, both held
// constant as height changes rather than re-picked for every board size.
export function boardFloor(height: number): number {
  return height - (GAME_HEIGHT - BOARD_FLOOR);
}

export function maxBoardDrop(floor: number): number {
  return floor - (BOARD_FLOOR - MAX_BOARD_DROP);
}

// And how far down it must always sit, which is a fact about the waste rather
// than about the tableau: a draw-three waste fans *upward* out of its slot, so
// there has to be room above the top row for two more cards to stand in. One
// step is enough, and it costs the deepest pile Klondike can deal about seven
// per cent of its fan - which that pile survives, and which nothing shallower
// ever notices.
export const MIN_BOARD_DROP = BOARD_DROP_STEP;

// The four natural suits and the thirteen ranks, from the package. They are
// in the order the foundations sit in, left to right - which the package
// keeps, because it is the order a deck is built in there too.
//
// `sameColor` is the American spelling the package settled on. Klondike's
// tableau alternates colour rather than suit, so that - not the suit - is
// what a placement rule actually asks about. `rankValue` puts the ace at 1
// and the king at 13, and neither the foundations building up nor the tableau
// building down wraps.
export {
  RANKS,
  RED_SUITS,
  SUITS,
  isRed,
  rankValue,
  sameColor,
} from 'phaser-card-engine';
export type { Rank, Suit } from 'phaser-card-engine';
