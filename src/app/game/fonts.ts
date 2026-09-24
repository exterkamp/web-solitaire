// The typefaces, named for the canvas.
//
// These moved into phaser-card-engine: both this game and Nertz named the
// same four families for Phaser, identically, because Phaser cannot read the
// CSS custom properties in src/styles.scss and they have to be repeated
// somewhere. A third copy is how they drift.
//
// Re-exported under the old name so nothing else in the app has to care
// where they live. The app still declares its own @font-face rules over the
// files - see styles.scss; the package only says what to ask the canvas for.
export {
  BODY_FONT,
  CARD_INDEX_FONT,
  DISPLAY_FONT,
  DISPLAY_WEIGHT,
  TEXT_OVERSAMPLE,
  fontsReady,
} from 'phaser-card-engine';
