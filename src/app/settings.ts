import { Injectable, effect, signal } from '@angular/core';
import { DeckTheme, asDeckTheme, asBackColor, backColorHex } from './game/deck-theme';
import { DrawCount } from './game/klondike';
import { Handedness } from './game/settings-types';

// Standing preferences: facts about the person rather than about one deal.
// Everything here outlives a game, which is exactly what distinguishes it
// from the things the play screen holds.
//
// All of it lives in localStorage and nowhere else. There is no account and
// no server in this game - see README.md - so this file and stats.ts are the
// whole of what persists, and every read goes through a guard because
// localStorage is user-writable and survives anything being renamed.

const DECK_THEME_KEY = 'solitaire.deckTheme';
const BACK_COLOR_KEY = 'solitaire.backColor';
const DRAW_COUNT_KEY = 'solitaire.drawCount';
const HANDEDNESS_KEY = 'solitaire.handedness';

@Injectable({ providedIn: 'root' })
export class Settings {
  readonly deckTheme = signal<DeckTheme>(asDeckTheme(read(DECK_THEME_KEY)));
  readonly backColor = signal<number>(asBackColor(read(BACK_COLOR_KEY)));

  // One card or three. Three is the game as it was dealt from a real deck and
  // is the harder of the two; one is the version most people have actually
  // played, and is the default for that reason rather than out of mercy.
  readonly drawCount = signal<DrawCount>(read(DRAW_COUNT_KEY) === '3' ? 3 : 1);

  // Which hand the phone is in, which decides which end of the top row the
  // stock sits at. The stock is tapped more than everything else on the board
  // put together, so it belongs under a thumb rather than across the screen
  // from one.
  readonly handedness = signal<Handedness>(read(HANDEDNESS_KEY) === 'left' ? 'left' : 'right');

  constructor() {
    effect(() => write(DECK_THEME_KEY, this.deckTheme()));
    effect(() => write(BACK_COLOR_KEY, backColorHex(this.backColor())));
    effect(() => write(DRAW_COUNT_KEY, String(this.drawCount())));
    effect(() => write(HANDEDNESS_KEY, this.handedness()));
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing and blocked storage both throw here. The setting still
    // applies for this session; it just won't outlive the tab.
  }
}
