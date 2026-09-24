import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BACK_COLORS,
  DECK_THEMES,
  DECK_THEME_LABELS,
  DeckTheme,
  backColorCss,
  deckThemePath,
} from '../../game/deck-theme';
import { DrawCount } from '../../game/klondike';
import { Handedness } from '../../game/settings-types';
import { Settings } from '../../settings';

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
  imports: [RouterLink],
  selector: 'app-settings-page',
  styleUrl: './settings-page.scss',
  templateUrl: './settings-page.html',
})
export class SettingsPage {
  protected readonly settings = inject(Settings);
  protected readonly build = runningBuild();

  protected readonly themes = DECK_THEMES;
  protected readonly labels = DECK_THEME_LABELS;
  protected readonly colors = BACK_COLORS;
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

  // The back is ink on transparency, so a preview is that image over the
  // chosen colour - which is exactly how the board draws it, and the reason
  // the two cannot disagree about what a deck looks like.
  protected backImage(theme: DeckTheme): string {
    return `url(${deckThemePath(theme, 'back.webp')})`;
  }

  protected readonly css = backColorCss;
}
