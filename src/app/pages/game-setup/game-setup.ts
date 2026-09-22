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
  tripeaks: {
    title: 'Tri Peaks',
    summary:
      'Three peaks of cards, one card face up beside the deck, and two minutes.',
    detail:
      'Take any card you can see that is one rank above or below the card ' +
      'beside the deck - and the ranks go round the corner, so an ace follows ' +
      'a king and a king follows an ace. A card is yours once the two cards ' +
      'lying over it have gone. Nothing is built and nothing is sorted; the ' +
      'whole game is noticing. Every card you take in a row is worth more ' +
      'than the last, and turning the deck starts you back at one.',
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
  canfield: {
    title: 'Canfield',
    summary:
      'Thirteen cards in reserve, four columns, and foundations that start wherever the first card did.',
    detail:
      'The gambling one: Richard Canfield sold a deck for fifty dollars and ' +
      'paid five a card for whatever you got home, and a hand goes out about ' +
      'one time in thirty. The card turned up first sets the rank all four ' +
      'foundations build from, and both sequences go round the corner - a ' +
      'foundation counts on past the king to the ace, and a king goes on an ' +
      'ace in the columns. The reserve is the game: thirteen cards you ' +
      'cannot see, only the top one is yours, and any column you manage to ' +
      'empty refills from it before you can use it. Three cards a turn, and ' +
      'as many passes through the deck as you like.',
  },
  seahaven: {
    title: 'Seahaven Towers',
    summary:
      'FreeCell\u2019s furniture, built down in suit, and only a king may take an empty column.',
    detail:
      'Ten columns of five, four cells with two of them already full, and ' +
      'nothing hidden. The two changes from FreeCell are what make it: ' +
      'columns build down in suit rather than in alternating colours, and an ' +
      'empty column takes a king and nothing else. So an empty column is ' +
      'worth nothing unless you are holding a king, a run can never be ' +
      'shuffled through one, and the only room you have is those four ' +
      'squares. Ten columns across a phone means smaller cards - the price ' +
      'of seeing all fifty-two at once.',
  },
  spiderette: {
    title: 'Spiderette',
    summary:
      'Spider on one deck: build down by rank, but carry only a run of one suit.',
    detail:
      'Any card goes on one a rank higher, whatever the suits - and only a ' +
      'run that is all one suit can be picked up and moved. So every ' +
      'convenient place to put a card is a card buried on purpose, and that ' +
      'argument is the whole game. Nothing goes home one card at a time: a ' +
      'suit leaves the table as a finished king-to-ace run, all thirteen at ' +
      'once. The deck deals a card onto every column when you ask it, four ' +
      'times, and an empty column will hold anything.',
  },
  scorpion: {
    title: 'Scorpion',
    summary:
      'Yukon\u2019s grip and Spider\u2019s order: a handful moves at once, onto its own suit.',
    detail:
      'Any face-up card comes away with everything piled on it, in whatever ' +
      'state those cards are in - and it may only be put down on the same ' +
      'suit, one rank higher. A nine of hearts has exactly one home in the ' +
      'whole deck, and it is very probably buried. Kings start empty ' +
      'columns, a finished suit goes home by itself, and three cards are ' +
      'held back to be dealt when you want them. The hardest game here.',
  },
  pyramid: {
    title: 'Pyramid',
    summary:
      'Twenty-eight cards stacked in a pyramid, taken away in pairs that add to thirteen.',
    detail:
      'An ace is one, a jack eleven, a queen twelve - and a king is thirteen ' +
      'on his own, so kings leave alone. A card is yours once the two cards ' +
      'lying on it have gone. Drag one card onto another to take the pair, ' +
      'or tap a card to pair it with the one beside the deck; finding the ' +
      'other half is the game, so nothing here goes looking for it. Three ' +
      'passes through the deck, and then the hand is over.',
  },
  golf: {
    title: 'Golf',
    summary:
      'A wall of thirty-five cards, cleared one rank up or down onto the card in play.',
    detail:
      'Take any card at the foot of a column that is one rank above or below ' +
      'the card beside the deck, over and over, and turn the deck when you ' +
      'run out. The ranks do not go round the corner here - a king takes ' +
      'only a queen and an ace only a two - which is what makes a king on ' +
      'the wall a problem rather than a card. Sixteen turns of the deck and ' +
      'no second pass. Ninety seconds, and about one hand in ten goes out.',
  },
  acesup: {
    title: 'Aces Up',
    summary:
      'Four piles, four cards at a time, and the lower card of a suit is thrown away.',
    detail:
      'Deal four, throw away any card that has a higher card of its own suit ' +
      'showing elsewhere, and deal four more. An ace beats everything and ' +
      'can never be thrown away, which is where the game gets its name and ' +
      'its difficulty. The only decision is what to move into an empty ' +
      'column, because that uncovers what was underneath. You win by getting ' +
      'down to the four aces, which happens about one hand in twenty.',
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
