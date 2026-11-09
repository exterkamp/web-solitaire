import {
  Board,
  CardSprite as EngineCardSprite,
  CardStyle,
  DEFAULT_BACK_COLOR,
  DEFAULT_DECK_THEME,
  DeckTheme,
  Region,
  Suit,
  renderCourts,
  suitTexture,
} from '@exterkamp/felt';
import { CARD_WIDTH } from './config';
import { DeckStyle, themeStyle } from './deck-style';
import { Card } from './deck';

// How a card is drawn, which is felt's job now.
//
// What was here was 496 lines that the package has, to the decimal: the same
// large index with its suit beside it, the same single big pip instead of a
// true pip count, the same 27px corner and 48px centre and 29.4 units of
// peek. It was the same drawing because it is where the package's came from.
//
// What is left is this table's own dialect of it - the deck the player
// picked, the board's slightly lighter card edge, and the court art rendered
// at the size these cards are actually played at rather than the package's
// default.

// The player's choice, held here because a CardSprite is built one at a time
// from all over the scene and passing the deck to each of them would mean
// threading it through every call site that makes a card.
let currentTheme: DeckTheme = DEFAULT_DECK_THEME;
let currentBackColor: number = DEFAULT_BACK_COLOR;
let currentStyle: DeckStyle = themeStyle(DEFAULT_DECK_THEME);

// What the courts are rasterised at. A card here is 60 units wide and the
// densest phone triples that, so 240 is twice what is ever shown and a
// quarter of the pixels the package's default would spend.
const COURT_RASTER = 240;

/** Which deck every card built after this uses. */
export function setDeck(theme: DeckTheme, backColor: number, style?: DeckStyle): void {
  currentTheme = theme;
  currentBackColor = backColor;
  // A deck of the player's own, or the theme's. Held here for the same reason
  // the theme is: a CardSprite is built one at a time from all over the
  // scene, and threading a palette through every call site that makes a card
  // is how one of them ends up with last week's deck.
  currentStyle = style ?? themeStyle(theme);
}

/**
 * Draws the twelve court cards, and resolves when they are all in hand.
 *
 * They are rendered from SVG rather than loaded as pictures, which is what
 * lets a deck be a palette instead of a directory: switching themes is a
 * recolour now rather than another 700kB down the wire.
 *
 * Not awaited by the board. felt holds a card back until its face is painted
 * (see cardsReady), so nothing is ever seen half-drawn; this only starts the
 * portraits early, at the size these cards are played at.
 */
export function renderCourtArt(board: Board): Promise<void> {
  return renderCourts(board, currentStyle.court, { width: COURT_RASTER });
}

/**
 * The white suit artwork, for a pip that is not on a card - the ghost printed
 * in an empty foundation, which is the felt's own marking rather than a card
 * and so is neither red nor black.
 */
export function ghostSuit(board: Board, suit: Suit, size: number): Region {
  return suitTexture(board, suit, 0xffffff, size);
}

/** How every card built now is drawn: the deck, its back, its palette. */
export function currentCardStyle(): CardStyle {
  return {
    width: CARD_WIDTH,
    theme: currentTheme,
    backColor: currentBackColor,
    edge: currentStyle.edge,
    courtWidth: COURT_RASTER,
    paper: currentStyle.paper,
    ink: currentStyle.ink,
    courtPalette: currentStyle.court,
  };
}

/** A card, at a place on the board. */
export class CardSprite extends EngineCardSprite {
  constructor(board: Board, x: number, y: number, card: Card) {
    super(board, card, currentCardStyle());
    this.setPosition(x, y);
  }
}
