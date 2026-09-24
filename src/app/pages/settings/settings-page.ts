import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BACK_COLORS,
  DECK_THEMES,
  DECK_THEME_LABELS,
  DeckTheme,
  backColorCss,
  deckThemePath,
} from '../../game/deck-theme';
import { colorCss, cssColor } from '../../game/deck-style';
import { DrawCount } from '../../game/klondike';
import { Handedness } from '../../game/settings-types';
import { Settings } from '../../settings';
import { DeckPreview } from './deck-preview';
import { DyeSwatch } from './dye-swatch';

// One of the seven colours a custom deck is made of.
//
// Read and written through the signal rather than copied into the component,
// so there is one value and not two: the picker shows what the board will
// draw because it is looking at the same place the board looks.
interface Dye {
  key: string;
  label: string;
  hint: string;
  value: () => string;
  set: (css: string) => void;
}

// Which build is running, taken from the name of the bundle the page loaded.
//
// No build plumbing behind it, and none wanted: the name already carries a
// content hash, so two people comparing this line are comparing the exact
// files they are running. It exists because an app that updates itself in the
// background makes "am I on the new one?" a real question, and until now the
// only way to answer it was to notice a feature missing.
function runningBuild(): string {
  const script = [...document.scripts]
    .map((s) => s.src.split('/').pop() ?? '')
    .find((name) => name.startsWith('main'));
  const hash = script?.match(/main-([A-Z0-9]+)\.js/)?.[1];
  // A development build has no hash in the name, and says so rather than
  // showing nothing.
  return hash ?? 'development';
}

@Component({
  imports: [DeckPreview, DyeSwatch, RouterLink],
  selector: 'app-settings-page',
  styleUrl: './settings-page.scss',
  templateUrl: './settings-page.html',
})
export class SettingsPage {
  protected readonly settings = inject(Settings);
  protected readonly build = runningBuild();

  protected readonly themes = DECK_THEMES;
  protected readonly labels = DECK_THEME_LABELS;
  protected readonly draws: DrawCount[] = [1, 3];

  protected readonly hands: { value: Handedness; label: string; hint: string }[] = [
    { value: 'left', label: 'Left', hint: 'Stock on the left' },
    { value: 'right', label: 'Right', hint: 'Stock on the right' },
  ];

  protected readonly stuckOptions: { value: boolean; label: string; hint: string }[] = [
    { value: true, label: 'On', hint: 'Say so when a hand is dead' },
    { value: false, label: 'Off', hint: 'Never mention it' },
  ];

  protected readonly shuffleOptions: { value: boolean; label: string; hint: string }[] = [
    { value: true, label: 'On', hint: 'Riffle the pack first' },
    { value: false, label: 'Off', hint: 'Deal straight away' },
  ];

  protected readonly customOptions: { value: boolean; label: string; hint: string }[] = [
    { value: false, label: 'Off', hint: 'Use the deck above' },
    { value: true, label: 'On', hint: 'Mix your own' },
  ];

  // The seven colours, in the order they matter: the two you read the card
  // by first, then the four the portraits are painted with.
  //
  // Hearts and diamonds share an ink, and so do spades and clubs. Four
  // separate pickers would be four chances to make a deck where a heart and
  // a diamond are different shades of red, which no deck anybody has played
  // with has ever been.
  protected readonly dyes: Dye[] = [
    {
      key: 'paper',
      label: 'Stock',
      hint: 'What the faces are printed on',
      value: () => colorCss(this.settings.paper()),
      set: (css) => this.settings.paper.set(cssColor(css)),
    },
    {
      key: 'red',
      label: 'Red suits',
      hint: 'Hearts and diamonds',
      value: () => colorCss(this.settings.redInk()),
      set: (css) => this.settings.redInk.set(cssColor(css)),
    },
    {
      key: 'black',
      label: 'Black suits',
      hint: 'Spades and clubs',
      value: () => colorCss(this.settings.blackInk()),
      set: (css) => this.settings.blackInk.set(cssColor(css)),
    },
    {
      key: 'ink',
      label: 'Court line',
      hint: 'Every outline in a portrait',
      value: () => this.settings.courtInk(),
      set: (css) => this.settings.courtInk.set(css),
    },
    {
      key: 'gold',
      label: 'Court gold',
      hint: 'Crowns, hilts and trim',
      value: () => this.settings.courtGold(),
      set: (css) => this.settings.courtGold.set(css),
    },
    {
      key: 'red-court',
      label: 'Court red',
      hint: 'Robes and cloaks',
      value: () => this.settings.courtRed(),
      set: (css) => this.settings.courtRed.set(css),
    },
    {
      key: 'highlight',
      label: 'Skin & linen',
      hint: 'Faces, hands and collars',
      value: () => this.settings.courtHighlight(),
      set: (css) => this.settings.courtHighlight.set(css),
    },
  ];

  // Offered inside every picker. The back colours this game already ships,
  // plus black and white - which are the two a picker is worst at reaching,
  // being the far corners of the square.
  protected readonly presets: string[] = [
    '#fdfdfd', '#1a1a1a', ...BACK_COLORS.map(backColorCss),
  ];

  // The back is ink on transparency, so a preview is that image over the
  // chosen colour - which is exactly how the board draws it, and the reason
  // the two cannot disagree about what a deck looks like.
  protected backImage(theme: DeckTheme): string {
    return `url(${deckThemePath(theme, 'back.webp')})`;
  }

  protected readonly css = backColorCss;
  protected readonly asColor = cssColor;

  // Which picker is open, if any.
  //
  // The library opens its own dialog on click and will not close it on a
  // second one: the button it is attached to becomes the focused element, and
  // it reads that as "open me". So the swatches are taken out of its hands -
  // `cpIgnoredElements` stops it acting on the click at all - and this signal
  // drives `cpToggle` instead, which makes a second tap on an open swatch
  // shut it. Which is what a swatch that is visibly pressed promises.
  protected readonly openDye = signal<string | null>(null);

  protected toggleDye(key: string): void {
    this.openDye.update((open) => (open === key ? null : key));
  }

  /** The dialog closing by itself - a click outside it, or Escape. */
  protected dyeClosed(key: string): void {
    if (this.openDye() === key) this.openDye.set(null);
  }

  // Turning the custom deck off destroys the swatches under any open dialog,
  // so the memory of which one was open has to go with them.
  protected setCustom(on: boolean): void {
    this.openDye.set(null);
    this.settings.customDeck.set(on);
  }

  /** Back to the chosen theme's palette, from wherever the pickers got to. */
  protected resetDeck(): void {
    this.openDye.set(null);
    this.settings.resetDeck();
  }
}
