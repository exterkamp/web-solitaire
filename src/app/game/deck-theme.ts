// The decks a player can hold, and the colour behind a card's back.
//
// Moved into phaser-card-engine, which both this game and Nertz now share:
// the two had the same file and the same 4.8MB of art beside it, byte for
// byte. The package holds the art as well, so `deckThemePath` points into
// whatever directory the app serves it from - see angular.json.
//
// Re-exported under the old name so nothing else in the app has to care.
export {
  BACK_COLORS,
  DECK_STOCK,
  DECK_THEMES,
  DECK_THEME_LABELS,
  DEFAULT_BACK_COLOR,
  DEFAULT_DECK_THEME,
  asBackColor,
  asDeckTheme,
  backColorCss,
  backColorHex,
  deckThemePath,
} from 'phaser-card-engine';
export type { DeckTheme } from 'phaser-card-engine';
