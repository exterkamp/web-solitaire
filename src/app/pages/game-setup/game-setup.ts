import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ChipSelect } from '../../shared/chip-select/chip-select';
import { DrawCount } from '../../game/klondike';
import { GameId, asGameId } from '../../game/table-game';
import { formatPercent } from '../../format';
import { Settings } from '../../settings';
import { Stats, variantOf } from '../../stats';

// What a game is, before you are dealt one.
//
// Every game gets this page, including the one with nothing to choose. That
// is deliberate: the page is not a settings screen that FreeCell happens not
// to need, it is the place a game introduces itself. Somebody who has never
// played FreeCell should be able to find out what it is without dealing a
// hand and guessing, and somebody who has should be one button from playing.
interface Guide {
  title: string;
  // What the game is, in a sentence somebody can read while deciding.
  summary: string;
  // And what makes it itself, for somebody who wants to know before they
  // start rather than after they lose.
  detail: string;
}

const GUIDES: Record<GameId, Guide> = {
  klondike: {
    title: 'Klondike',
    summary:
      'Seven piles, a deck to turn, and four foundations to build up from ace to king.',
    detail:
      'Build the piles down in alternating colours, and move a run of them at ' +
      'once when it fits. Only a king starts an empty column. Two thirds of the ' +
      'deck begins face down, so the game is as much about what you have not ' +
      'seen as about what you have - which is why a deal can simply be a bad one.',
  },
  yukon: {
    title: 'Yukon',
    summary:
      'Klondike\u2019s seven columns with no deck to turn, and a handful of cards moves at once.',
    detail:
      'Any card that is face up comes away with every card sitting on it, in ' +
      'whatever order those happen to be - only the bottom one has to fit ' +
      'where it lands. Build down in alternating colours, kings into empty ' +
      'columns, and everything you will ever be dealt is already on the table ' +
      'from the first move. What is left is digging: twenty-one cards start ' +
      'face down, and every one you turn over you earned.',
  },
  freecell: {
    title: 'FreeCell',
    summary:
      'All fifty-two face up across eight columns, with four cells to park a card in.',
    detail:
      'Build down in alternating colours as usual, but an empty column takes ' +
      'any card, and a run only moves as far as there is room to shuffle it: ' +
      'one card, plus one for every free cell, doubled for every empty column. ' +
      'Nothing is hidden and almost every deal can be won - of the thirty-two ' +
      'thousand Microsoft shipped, only one cannot - so a loss here is a loss ' +
      'rather than a bad hand.',
  },
};

@Component({
  imports: [RouterLink, ChipSelect],
  selector: 'app-game-setup',
  styleUrl: './game-setup.scss',
  templateUrl: './game-setup.html',
})
export class GameSetup {
  protected readonly settings = inject(Settings);
  private readonly stats = inject(Stats);

  // Through asGameId, like the board does. This was a two-way check written
  // when there were two games, and it did not fail loudly when a third
  // arrived - it quietly answered "klondike", so the Yukon button opened a
  // page titled Klondike with a Deal that dealt Klondike. A guard that names
  // every game it knows is the only kind worth having.
  protected readonly game: GameId = asGameId(inject(ActivatedRoute).snapshot.paramMap.get('game'));
  protected readonly guide = GUIDES[this.game];

  protected readonly drawCounts: DrawCount[] = [1, 3];
  // The chips hold 1 and 3; the row reads One and Three, because a row of
  // digits beside the word "Draw" reads as a quantity of something rather
  // than as two ways to play.
  protected readonly drawLabel = (count: DrawCount): string => (count === 1 ? 'One' : 'Three');

  protected readonly drawNote = computed(() =>
    this.settings.drawCount() === 1
      ? 'Every card in the deck is reachable, and most hands are winnable.'
      : 'Three at a time, two free passes through the deck, and much the harder of the two.',
  );

  // This variant's own record rather than the game's: draw-three next to
  // draw-one is the comparison worth having, and the menu already shows the
  // two of them added together.
  protected record(): string | undefined {
    const mode = this.stats.mode(variantOf(this.game, this.settings.drawCount()));
    if (!mode.played) return undefined;
    return `${mode.won} of ${mode.played} won · ${formatPercent(mode.won / mode.played)}`;
  }
}
