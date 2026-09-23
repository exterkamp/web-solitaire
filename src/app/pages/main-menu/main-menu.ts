import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameId } from '../../game/table-game';
import { formatPercent } from '../../format';
import { Stats } from '../../stats';

// One button per game, and nothing else to decide here.
//
// This was a chip row and a single Deal button, which asked the question in
// the wrong order: you had to notice the chips, understand that they changed
// what Deal would do, and only then press it. A game is not a setting. Now
// each game is its own way in - and the one with something to choose opens a
// page to choose it on, rather than crowding the front door with a decision
// that only applies to half of it.
@Component({
  imports: [RouterLink],
  selector: 'app-main-menu',
  styleUrl: './main-menu.scss',
  templateUrl: './main-menu.html',
})
export class MainMenu {
  private readonly stats = inject(Stats);

  // What a game is, for somebody who has not played it here before. Replaced
  // by their own record the moment they have one, because by then this is
  // less interesting than how they are doing.
  private readonly blurbs: Record<GameId, string> = {
    klondike: 'Draw one or three · the classic',
    freecell: 'Nothing hidden · almost always winnable',
    yukon: 'No deck to turn · dig for what is buried',
    canfield: 'Thirteen in reserve · the gambling one',
    spiderette: 'Build down by rank · carry a suit at a time',
    scorpion: 'One suit only · the hardest here',
    seahaven: 'Ten columns, four cells · kings only in a gap',
    tripeaks: 'Quick · clear the peaks a card at a time',
    pyramid: 'Pairs that add to thirteen',
    golf: 'One rank up or down · ninety seconds',
    blackhole: 'Nothing hidden, no deck · every move a choice',
    acesup: 'Four piles · the aces cannot be beaten',
  };

  protected line(game: GameId): string {
    const record = this.stats.game(game);
    if (!record.played) return this.blurbs[game];
    return `${record.won} of ${record.played} won · ${formatPercent(record.won / record.played)}`;
  }
}
