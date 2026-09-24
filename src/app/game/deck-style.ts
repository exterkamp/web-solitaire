import {
  COURT_PALETTES,
  CourtPalette,
  DECK_STOCK,
  DeckTheme,
  colorCss,
  cssColor,
} from 'phaser-card-engine';

// What a deck looks like, as the package wants it.
//
// The seven themes are palettes, and a custom deck is one more - made by the
// player rather than by us. Everything on the board is drawn from four
// numbers and four colours, so this is the whole of what a deck is here:
// the stock the faces are printed on, the ink each pair of suits is drawn in,
// and the four the courts are painted with.
//
// Kept apart from settings.ts because settings is about storage and this is
// about what those values mean to a renderer. And apart from card-sprite.ts
// because the settings page needs it too, to draw the preview, and a page
// should not have to reach into the board's drawing code for it.

/** A whole deck, ready to hand to CardSprite and renderCourts. */
export interface DeckStyle {
  paper: number;
  ink: Record<string, number>;
  court: CourtPalette;
  /** Left out to let the package take it from the stock. */
  edge?: number;
}

/** What a deck looks like before anybody has changed anything. */
export const DEFAULT_PAPER = 0xfdfdfd;
export const DEFAULT_HIGHLIGHT = '#fdfdfd';

// The hairline round a face-up card. Lighter than the package's default,
// which is the stock darkened a shade; the difference is two values of grey
// and it is this board's own number, kept because there was no reason to
// change what a card looks like while changing what draws it.
//
// Only for the seven, though. It is a grey, and a grey hairline round a card
// printed on anything but near-white is a frame rather than an edge - so a
// deck the player mixed gets the package's version, which is a shade of
// whatever stock they chose.
export const DEFAULT_EDGE = 0xc9c9c9;

/**
 * The deck as one of the six, which is what a player gets until they go
 * looking for the pickers.
 *
 * Every value comes from the package now. A deck used to be a court palette
 * over a white card; two of the six are screens rather than cards and carry
 * their own stock and inks, so reading only the courts would give a matrix
 * portrait on white paper.
 */
export function themeStyle(theme: DeckTheme): DeckStyle {
  const stock = DECK_STOCK[theme];
  return {
    paper: stock.paper,
    ink: inkPair(stock.red, stock.black),
    court: courtStart(theme),
    // The board's own grey hairline, but only where it is a hairline. On
    // anything but near-white stock a grey rule round a card is a frame, so
    // those decks get the package's version - a shade of their own stock.
    edge: stock.paper === DEFAULT_PAPER ? DEFAULT_EDGE : undefined,
  };
}

/** The deck as the player has drawn it. */
export function customStyle(parts: {
  paper: number;
  redInk: number;
  blackInk: number;
  courtInk: string;
  courtGold: string;
  courtRed: string;
  courtHighlight: string;
}): DeckStyle {
  return {
    paper: parts.paper,
    ink: inkPair(parts.redInk, parts.blackInk),
    court: {
      ink: parts.courtInk,
      gold: parts.courtGold,
      red: parts.courtRed,
      highlight: parts.courtHighlight,
      // The courts are printed on the same stock as the card under them, or
      // the portrait reads as a sticker. One decision, stated once.
      paper: colorCss(parts.paper),
    },
  };
}

/**
 * Both suits of a colour get the same ink.
 *
 * Which is a choice, and the right one here: hearts and diamonds differ by
 * shape and not by shade on any deck anybody has played with, and four
 * separate pickers would be four chances to make a deck where they do.
 */
function inkPair(red: number, black: number): Record<string, number> {
  return { hearts: red, diamonds: red, spades: black, clubs: black };
}

/**
 * A deck's court palette, as the starting point for a custom one.
 *
 * The stock comes with it. A portrait on different paper from the card under
 * it reads as a sticker, and on the decks that are not white that is the
 * difference between a deck and a mistake.
 */
export function courtStart(theme: DeckTheme): CourtPalette {
  const court = COURT_PALETTES[theme];
  return {
    ...court,
    paper: court.paper ?? colorCss(DECK_STOCK[theme].paper),
    highlight: court.highlight ?? DEFAULT_HIGHLIGHT,
  };
}

export { colorCss, cssColor };
