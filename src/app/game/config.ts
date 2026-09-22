// Portrait, phone-first base resolution. Phaser's Scale.FIT mode scales this
// uniformly to whatever the device screen is, so these are logical units,
// not real pixels.
export const GAME_WIDTH = 480;
// Shorter than a phone screen on purpose.
//
// Seven columns of cards decide the width, and the width then decides how big
// a card is; the height is what is left over. Made as tall as a phone, the
// board is fitted by width and the spare height becomes felt nobody plays on
// - and since Scale.FIT is uniform, that felt costs the cards a quarter of
// their size. 720 is the tallest fan the rules can produce (a king-to-ace run
// on top of six face-down cards) plus the top row above it, and nothing more.
export const GAME_HEIGHT = 720;

// Poker size is 2.5 x 3.5 inches - a 5:7 ratio - and cards look wrong at
// anything else, so the two are kept in that proportion exactly. Width is
// the binding constraint here rather than height, which is the one real
// difference between this board and Nertz's: Klondike lays seven piles
// across, and seven cards plus the gaps between them have to fit in 480.
export const CARD_WIDTH = 60;
export const CARD_HEIGHT = (CARD_WIDTH * 7) / 5;

// Seven tableau piles, four foundations, a stock and a waste. Only the
// tableau count sets the column pitch - the top row is laid out into the
// same seven columns so that a foundation sits squarely over the pile it
// feeds.
export const TABLEAU_COUNT = 7;
export const FOUNDATION_COUNT = 4;

// Room at the sides for the rail drawn in table.ts, plus a little more so a
// card near the edge doesn't look wedged against it.
const SIDE_MARGIN = 10;
export const COLUMN_PITCH = (GAME_WIDTH - 2 * SIDE_MARGIN) / TABLEAU_COUNT;

// The centre of column `i`, counted from the left.
export function columnX(index: number): number {
  return SIDE_MARGIN + COLUMN_PITCH / 2 + index * COLUMN_PITCH;
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

// The lowest a card's bottom edge may reach, clear of the rail.
export const BOARD_FLOOR = 700;

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
// The cap is four of those steps, which on a phone is most of the way from
// the middle of the screen to the bottom of it. What it costs is a band of
// bare felt above the foundations, which is no loss: a table is allowed to
// have table on it, and nothing was ever played up there.
export const MAX_BOARD_DROP = 260;
export const BOARD_DROP_STEP = 65;

// And how far down it must always sit, which is a fact about the waste rather
// than about the tableau: a draw-three waste fans *upward* out of its slot, so
// there has to be room above the top row for two more cards to stand in. One
// step is enough, and it costs the deepest pile Klondike can deal about seven
// per cent of its fan - which that pile survives, and which nothing shallower
// ever notices.
export const MIN_BOARD_DROP = BOARD_DROP_STEP;

// The four natural suits, and nothing else - this is a plain deck. They are
// in the order the foundations sit in, left to right.
export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
] as const;
export type Rank = (typeof RANKS)[number];

export const RED_SUITS = new Set<Suit>(['hearts', 'diamonds']);

export function isRed(suit: Suit): boolean {
  return RED_SUITS.has(suit);
}

// Klondike's tableau alternates colour rather than suit, so this - not the
// suit - is what a placement rule actually asks about.
export function sameColour(a: Suit, b: Suit): boolean {
  return isRed(a) === isRed(b);
}

// Ace is 1 and king is 13. Foundations build up from the ace and the tableau
// builds down from the king, and neither wraps: this is the number both of
// those compare.
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 1;
}
