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
import { Handedness } from '../../game/solitaire-scene';
import { Settings } from '../../settings';

@Component({
  imports: [RouterLink],
  selector: 'app-settings-page',
  styleUrl: './settings-page.scss',
  templateUrl: './settings-page.html',
})
export class SettingsPage {
  protected readonly settings = inject(Settings);

  protected readonly themes = DECK_THEMES;
  protected readonly labels = DECK_THEME_LABELS;
  protected readonly colors = BACK_COLORS;
  protected readonly draws: DrawCount[] = [1, 3];

  protected readonly hands: { value: Handedness; label: string; hint: string }[] = [
    { value: 'left', label: 'Left', hint: 'Stock on the left' },
    { value: 'right', label: 'Right', hint: 'Stock on the right' },
  ];

  // The back is ink on transparency, so a preview is that image over the
  // chosen colour - which is exactly how the board draws it, and the reason
  // the two cannot disagree about what a deck looks like.
  protected backImage(theme: DeckTheme): string {
    return `url(${deckThemePath(theme, 'back.webp')})`;
  }

  protected readonly css = backColorCss;
}
