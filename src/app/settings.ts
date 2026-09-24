import { Injectable, effect, signal } from '@angular/core';
import { DEFAULT_BACK_COLOR, DeckTheme, asDeckTheme, backColorHex } from './game/deck-theme';
import {
  DEFAULT_HIGHLIGHT, DEFAULT_PAPER, DeckStyle, colorCss, courtStart, cssColor,
  customStyle, themeStyle,
} from './game/deck-style';
import { defaultInk } from 'phaser-card-engine';
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
const CUSTOM_DECK_KEY = 'solitaire.customDeck';
const PAPER_KEY = 'solitaire.paper';
const RED_INK_KEY = 'solitaire.redInk';
const BLACK_INK_KEY = 'solitaire.blackInk';
const COURT_INK_KEY = 'solitaire.courtInk';
const COURT_GOLD_KEY = 'solitaire.courtGold';
const COURT_RED_KEY = 'solitaire.courtRed';
const COURT_HIGHLIGHT_KEY = 'solitaire.courtHighlight';

// Where a custom deck starts from: the theme a player has before they have
// chosen one, so the sliders open on the deck already in front of them.
const start = courtStart('press');

/** A stored colour, or the fallback. Anything unparseable is the fallback. */
function asColor(value: string | null, fallback: number): number {
  if (!value || !/^#?[0-9a-fA-F]{6}$/.test(value)) return fallback;
  return cssColor(value);
}

/** The same, as CSS, which is what a court palette is written in. */
function asCss(value: string | null, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

@Injectable({ providedIn: 'root' })
export class Settings {
  readonly deckTheme = signal<DeckTheme>(asDeckTheme(read(DECK_THEME_KEY)));
  // Any colour, not one of the package's six.
  //
  // The six are still what the picker offers first - they are the ones that
  // have to be told apart at a Nertz table - but this is a single player's
  // own deck and there is no reason the shade of it has to come off a list.
  // `asColor` rather than the package's `asBackColor`, which snaps anything
  // it does not recognise back to petrol.
  readonly backColor = signal<number>(asColor(read(BACK_COLOR_KEY), DEFAULT_BACK_COLOR));

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

  // A deck of the player's own, drawn rather than chosen.
  //
  // Off until somebody goes looking for it, and the seven themes are what a
  // deck is until then. When it is on these eight values are the deck - see
  // game/deck-style.ts, which is where they turn into something a renderer
  // understands.
  //
  // Every one is seeded from the default theme rather than from nothing, so
  // turning it on gives a deck that looks like the one already on the table
  // and the first change is a change rather than a repair.
  readonly customDeck = signal<boolean>(read(CUSTOM_DECK_KEY) === 'true');
  readonly paper = signal<number>(asColor(read(PAPER_KEY), DEFAULT_PAPER));
  readonly redInk = signal<number>(asColor(read(RED_INK_KEY), defaultInk('hearts')));
  readonly blackInk = signal<number>(asColor(read(BLACK_INK_KEY), defaultInk('spades')));
  readonly courtInk = signal<string>(asCss(read(COURT_INK_KEY), start.ink));
  readonly courtGold = signal<string>(asCss(read(COURT_GOLD_KEY), start.gold));
  readonly courtRed = signal<string>(asCss(read(COURT_RED_KEY), start.red));
  readonly courtHighlight = signal<string>(
    asCss(read(COURT_HIGHLIGHT_KEY), start.highlight ?? DEFAULT_HIGHLIGHT),
  );

  /**
   * The deck as the board wants it: the player's own if they have drawn one,
   * and the chosen theme's if they have not.
   */
  deckStyle(): DeckStyle {
    if (!this.customDeck()) return themeStyle(this.deckTheme());
    return customStyle({
      paper: this.paper(),
      redInk: this.redInk(),
      blackInk: this.blackInk(),
      courtInk: this.courtInk(),
      courtGold: this.courtGold(),
      courtRed: this.courtRed(),
      courtHighlight: this.courtHighlight(),
    });
  }

  /**
   * Put the custom deck back to one of the seven.
   *
   * The way out of a deck that has gone wrong. Without it the only route back
   * from a black-on-black deck is seven pickers and a good memory, and the
   * player who most needs it is the one who can no longer read the cards.
   */
  resetDeck(theme: DeckTheme = this.deckTheme()): void {
    const court = courtStart(theme);
    this.paper.set(DEFAULT_PAPER);
    this.redInk.set(defaultInk('hearts'));
    this.blackInk.set(defaultInk('spades'));
    this.courtInk.set(court.ink);
    this.courtGold.set(court.gold);
    this.courtRed.set(court.red);
    this.courtHighlight.set(court.highlight ?? DEFAULT_HIGHLIGHT);
  }

  constructor() {
    effect(() => write(DECK_THEME_KEY, this.deckTheme()));
    effect(() => write(BACK_COLOR_KEY, backColorHex(this.backColor())));
    effect(() => write(DRAW_COUNT_KEY, String(this.drawCount())));
    effect(() => write(HANDEDNESS_KEY, this.handedness()));
    effect(() => write(WARN_STUCK_KEY, String(this.warnStuck())));
    effect(() => write(SHOW_SHUFFLE_KEY, String(this.showShuffle())));
    effect(() => write(CUSTOM_DECK_KEY, String(this.customDeck())));
    effect(() => write(PAPER_KEY, colorCss(this.paper())));
    effect(() => write(RED_INK_KEY, colorCss(this.redInk())));
    effect(() => write(BLACK_INK_KEY, colorCss(this.blackInk())));
    effect(() => write(COURT_INK_KEY, this.courtInk()));
    effect(() => write(COURT_GOLD_KEY, this.courtGold()));
    effect(() => write(COURT_RED_KEY, this.courtRed()));
    effect(() => write(COURT_HIGHLIGHT_KEY, this.courtHighlight()));
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
