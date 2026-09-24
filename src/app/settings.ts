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
const WARN_STUCK_KEY = 'solitaire.warnStuck';
const SHOW_SHUFFLE_KEY = 'solitaire.showShuffle';

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

  // Whether the board speaks up when a hand has no move left anywhere in it.
  // On by default, matching how the panel has always behaved; this is the
  // escape hatch for the player who would rather find that out themselves.
  readonly warnStuck = signal<boolean>(read(WARN_STUCK_KEY) !== 'false');

  // Whether a new game opens by shuffling the pack in front of you. On by
  // default, because it is the nicest thing on the board and most people will
  // see it a handful of times; off for the player who deals twenty hands in a
  // sitting and would rather have the second back each time.
  //
  // It is skipped anyway for anyone whose system asks for less movement - see
  // solitaire-scene.ts - so this is the preference of someone who likes
  // animation in general and not this one.
  readonly showShuffle = signal<boolean>(read(SHOW_SHUFFLE_KEY) !== 'false');

  constructor() {
    effect(() => write(DECK_THEME_KEY, this.deckTheme()));
    effect(() => write(BACK_COLOR_KEY, backColorHex(this.backColor())));
    effect(() => write(DRAW_COUNT_KEY, String(this.drawCount())));
    effect(() => write(HANDEDNESS_KEY, this.handedness()));
    effect(() => write(WARN_STUCK_KEY, String(this.warnStuck())));
    effect(() => write(SHOW_SHUFFLE_KEY, String(this.showShuffle())));
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
