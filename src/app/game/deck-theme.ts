// The decks a player can hold. Each is a whole palette - the courts' line
// work and garment colours, and a card back with its own field, medallion
// and border.
//
// The art is Nertz's, baked by that project's tools/render-face-art.py and
// copied here rather than shared. A symlink or a package would keep the two
// in step, which sounds like the better arrangement until you notice these
// are different games: nothing about a solitaire deck should be waiting on
// a change made for a four-player race.
export const DECK_THEMES = [
  'classic',
  'press',
  'felt',
  'royal',
  'steel',
  'antique',
  'millionaire',
] as const;

export type DeckTheme = (typeof DECK_THEMES)[number];

// What the player gets before they have chosen anything, and what an
// unrecognised name falls back to.
export const DEFAULT_DECK_THEME: DeckTheme = 'press';

// Shown in the settings list. Kept here so nothing else has to name a deck.
export const DECK_THEME_LABELS: Record<DeckTheme, string> = {
  classic: 'Classic',
  press: 'Press',
  felt: 'Felt',
  royal: 'Royal',
  steel: 'Steel',
  antique: 'Antique',
  millionaire: 'Millionaire',
};

// Anything out of storage comes through here. localStorage is user-writable
// and survives a theme being renamed, and an unknown name would otherwise
// become a 404 on a texture and a card with no art at all.
export function asDeckTheme(value: unknown): DeckTheme {
  return DECK_THEMES.includes(value as DeckTheme)
    ? (value as DeckTheme)
    : DEFAULT_DECK_THEME;
}

// Where a theme's art lives. One directory per theme, same thirteen names
// inside each.
export function deckThemePath(theme: DeckTheme, file: string): string {
  return `/cards/art/${theme}/${file}`;
}

// What the back's ink is printed over.
//
// The back art is line work on transparency, so the colour under it is a
// choice rather than part of the picture - which in Nertz is how you tell
// four players' decks apart. Nobody else is at this table, so here it is
// simply the colour of your deck, and the palette is that game's seat
// colours with two more added: muted rather than primary, and dark enough
// to carry a light ink.
export const BACK_COLORS = [
  0x2a5866, // petrol
  0x7a2e35, // oxblood
  0x4f6b38, // moss
  0x5e3a5c, // plum
  0x1f3a5f, // navy
  0x6b4a2a, // tobacco
] as const;

export const DEFAULT_BACK_COLOR = BACK_COLORS[0];

export function asBackColor(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 16) : Number(value);
  return (BACK_COLORS as readonly number[]).includes(parsed) ? parsed : DEFAULT_BACK_COLOR;
}

// Six digits, always, because '#2a5866'.slice(1) has to round-trip through
// asBackColor above and a colour whose top byte is small would otherwise be
// written short.
export function backColorHex(color: number): string {
  return color.toString(16).padStart(6, '0');
}

export function backColorCss(color: number): string {
  return `#${backColorHex(color)}`;
}
