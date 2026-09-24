import { describe, expect, it } from 'vitest';
import { COURT_PALETTES, DECK_THEMES, defaultInk } from 'phaser-card-engine';
import {
  DEFAULT_EDGE, DEFAULT_HIGHLIGHT, DEFAULT_PAPER, colorCss, courtStart, cssColor, customStyle,
  themeStyle,
} from './deck-style';

describe('themeStyle', () => {
  it('draws every theme on the same stock, in the same ink', () => {
    for (const theme of DECK_THEMES) {
      const style = themeStyle(theme);
      expect(style.paper).toBe(DEFAULT_PAPER);
      expect(style.ink['hearts']).toBe(defaultInk('hearts'));
      expect(style.ink['spades']).toBe(defaultInk('spades'));
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
  it('is this board\'s own grey on the seven', () => {
    for (const theme of DECK_THEMES) {
      expect(themeStyle(theme).edge).toBe(DEFAULT_EDGE);
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
