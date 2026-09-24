import { describe, expect, it } from 'vitest';
import { COURT_PALETTES, DECK_STOCK, DECK_THEMES } from 'phaser-card-engine';
import {
  DEFAULT_EDGE, DEFAULT_HIGHLIGHT, DEFAULT_PAPER, colorCss, courtStart, cssColor, customStyle,
  themeStyle,
} from './deck-style';

describe('themeStyle', () => {
  // A deck is a whole deck in the package now - stock and inks as well as
  // courts - and two of the six are screens rather than cards. Reading only
  // the court palette would put a matrix portrait on a white card.
  it('takes every deck its own stock and inks, from the package', () => {
    for (const theme of DECK_THEMES) {
      const style = themeStyle(theme);
      const stock = DECK_STOCK[theme];
      expect(style.paper).toBe(stock.paper);
      expect(style.ink['hearts']).toBe(stock.red);
      expect(style.ink['diamonds']).toBe(stock.red);
      expect(style.ink['spades']).toBe(stock.black);
      expect(style.ink['clubs']).toBe(stock.black);
    }
  });

  it('still prints the decks that are cards on near-white paper', () => {
    for (const theme of ['classic', 'press', 'millionaire'] as const) {
      expect(themeStyle(theme).paper).toBe(DEFAULT_PAPER);
    }
  });

  it('takes each theme its own court palette', () => {
    for (const theme of DECK_THEMES) {
      expect(themeStyle(theme).court.ink).toBe(COURT_PALETTES[theme].ink);
    }
  });

  // Without this the courts on a theme deck lose their faces, which is what
  // the highlight colour was added for in the first place.
  it('gives every theme a highlight, palette or not', () => {
    for (const theme of DECK_THEMES) {
      expect(themeStyle(theme).court.highlight).toBeTruthy();
    }
  });

  // The same rule the custom decks follow: a portrait on different paper
  // from the card under it reads as a sticker.
  it('prints every deck\'s portraits on that deck\'s own stock', () => {
    for (const theme of DECK_THEMES) {
      const style = themeStyle(theme);
      expect(style.court.paper).toBe(colorCss(style.paper));
    }
  });
});

describe('customStyle', () => {
  const parts = {
    paper: 0x102030,
    redInk: 0xff0000,
    blackInk: 0x00ff00,
    courtInk: '#111111',
    courtGold: '#222222',
    courtRed: '#333333',
    courtHighlight: '#444444',
  };

  it('gives both suits of a colour the same ink', () => {
    const { ink } = customStyle(parts);
    expect(ink['hearts']).toBe(ink['diamonds']);
    expect(ink['spades']).toBe(ink['clubs']);
    expect(ink['hearts']).not.toBe(ink['spades']);
  });

  // A portrait on a different stock from the card under it reads as a
  // sticker, which is what this stops.
  it('prints the portraits on the stock the card is printed on', () => {
    expect(customStyle(parts).court.paper).toBe(colorCss(parts.paper));
    expect(customStyle(parts).paper).toBe(parts.paper);
  });

  it('passes the four court colours through as given', () => {
    const { court } = customStyle(parts);
    expect(court.ink).toBe('#111111');
    expect(court.gold).toBe('#222222');
    expect(court.red).toBe('#333333');
    expect(court.highlight).toBe('#444444');
  });
});

describe('courtStart', () => {
  it('opens on the theme already on the table', () => {
    expect(courtStart('press').ink).toBe(COURT_PALETTES['press'].ink);
    expect(courtStart('press').highlight).toBe(DEFAULT_HIGHLIGHT);
  });

  // A dark deck states its own, and it must not be overwritten with white -
  // that field is the difference between a king and a crown floating over
  // nothing.
  it('keeps a dark deck\'s own highlight rather than whitening it', () => {
    expect(courtStart('matrix').highlight).toBe(COURT_PALETTES['matrix'].highlight);
    expect(courtStart('matrix').highlight).not.toBe(DEFAULT_HIGHLIGHT);
  });
});

// The colour pickers speak CSS and the renderer speaks numbers, so every
// value a player picks makes this trip. A colour with a leading zero is the
// one that breaks it - `0x0000ff` is three characters without the padding,
// and reads back as a different colour.
describe('the trip between a picker and a renderer', () => {
  it('survives colours with leading zeros', () => {
    for (const color of [0x000000, 0x0000ff, 0x00ff00, 0x0a0b0c, 0xffffff, 0xfdfdfd]) {
      expect(cssColor(colorCss(color))).toBe(color);
      expect(colorCss(color)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// A grey hairline round a card printed on near-black is a frame, not an
// edge: it survived the portrait only on the sides the art does not reach,
// so a custom deck showed a bright border round its top and left and nothing
// round its bottom. The package draws it from the stock when nobody names
// one, which is the whole fix.
describe('the hairline round a card', () => {
  it('is this board\'s own grey on a deck printed on near-white', () => {
    for (const theme of ['classic', 'press', 'millionaire'] as const) {
      expect(themeStyle(theme).edge).toBe(DEFAULT_EDGE);
    }
  });

  // Same rule as a deck the player mixed, and for the same reason: a grey
  // rule round a black card is a frame.
  it('is left to the package on a deck that is not printed on near-white', () => {
    for (const theme of DECK_THEMES) {
      if (DECK_STOCK[theme].paper === DEFAULT_PAPER) continue;
      expect(themeStyle(theme).edge).toBeUndefined();
    }
  });

  it('is left to the package on a deck the player mixed', () => {
    expect(customStyle({
      paper: 0x101014,
      redInk: 0xff7ab8,
      blackInk: 0x7ad7ff,
      courtInk: '#f2e9d0',
      courtGold: '#ffcc33',
      courtRed: '#9b1b30',
      courtHighlight: '#e8d8c0',
    }).edge).toBeUndefined();
  });
});
