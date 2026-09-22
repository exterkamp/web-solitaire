import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChipSelect } from '../../shared/chip-select/chip-select';
import { DrawCount } from '../../game/klondike';
import { GameId } from '../../game/table-game';
import { formatPercent } from '../../format';
import { Settings } from '../../settings';
import { Stats, variantOf } from '../../stats';

@Component({
  imports: [RouterLink, ChipSelect],
  selector: 'app-main-menu',
  styleUrl: './main-menu.scss',
  templateUrl: './main-menu.html',
})
export class MainMenu {
  protected readonly settings = inject(Settings);
  protected readonly stats = inject(Stats);

  protected readonly games: GameId[] = ['klondike', 'freecell'];
  protected readonly gameLabel = (game: GameId): string =>
    game === 'freecell' ? 'FreeCell' : 'Klondike';

  protected readonly drawCounts: DrawCount[] = [1, 3];
  // The chips hold 1 and 3; the row reads One and Three, because a row of
  // digits beside the word "Draw" reads as a quantity of something rather
  // than as two ways to play.
  protected readonly drawLabel = (count: DrawCount): string => (count === 1 ? 'One' : 'Three');

  protected readonly asPercent = formatPercent;

  // The line under the Deal button: how this game has gone for you. Shown
  // only once there is something to say - "0% of 0" is not an achievement to
  // report, it is a scolding for being new.
  protected record(): string | undefined {
    const mode = this.stats.mode(variantOf(this.settings.game(), this.settings.drawCount()));
    if (!mode.played) return undefined;
    return `${mode.won} of ${mode.played} won · ${formatPercent(mode.won / mode.played)}`;
  }
}
