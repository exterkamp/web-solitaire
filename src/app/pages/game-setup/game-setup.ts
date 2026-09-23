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
  // What the game is, in a sentence somebody can read while deciding. The
  // only part of this that is a pitch rather than a rule.
  summary: string;
  // And then the rules, in the order somebody meets them: what is on the
  // table, what may be done with it, and what counts as having done it.
  //
  // Three short sections rather than one paragraph, because a paragraph is
  // what you write when you are describing a game to somebody who already
  // knows it. A person who has heard of Scorpion and never played it needs
  // the deal before the moves, and the moves before the object, and they
  // need to be able to come back and find one of the three without reading
  // the other two.
  //
  // Checked against Wikipedia's articles and, where it has them, Bicycle's
  // rulebook. These are the standard rules, strictly: the four places this
  // used to be more forgiving than the real game were all tightened rather
  // than explained away, so what is written here is what the board does and
  // what the books say.
  setup: string;
  play: string;
  winning: string;
}

const GUIDES: Record<GameId, Guide> = {
  klondike: {
    title: 'Klondike',
    summary: 'The one everybody means by solitaire: seven piles, a deck to turn, and four foundations to fill.',
    setup:
      'Seven piles, the first of one card and the last of seven, each with ' +
      'only its top card face up - twenty-eight cards in all. The other ' +
      'twenty-four stay in the deck, and the four foundations start empty.',
    play:
      'Build the piles down in alternating colours: a black five goes on a ' +
      'red six. Any run of face-up cards moves as a unit, and only a king ' +
      'starts an empty column. Turn the deck when you run out of moves, as ' +
      'often as you like. Aces go up to the foundations as they appear, and ' +
      'each foundation then builds up in its own suit.',
    winning:
      'All fifty-two cards home, ace to king in four suits. Two thirds of ' +
      'the deck starts face down, so a deal can simply be a bad one: ' +
      'somewhere between a fifth and two fifths of them go out, depending on ' +
      'how many cards a draw turns.',
  },
  freecell: {
    title: 'FreeCell',
    summary: 'All fifty-two face up across eight columns, with four cells to park a card in.',
    setup:
      'Eight columns, four of seven cards and four of six, every card face ' +
      'up from the start. Four empty cells at one end of the top row and ' +
      'four empty foundations at the other.',
    play:
      'Build down in alternating colours, and send cards home in suit from ' +
      'the ace. A cell holds any one card, and an empty column takes ' +
      'anything at all. A run moves as far as there is room to shuffle it ' +
      'through: one card, plus one for each free cell, doubled for every ' +
      'empty column.',
    winning:
      'All fifty-two home. Nothing is hidden, so nothing is luck - of the ' +
      'thirty-two thousand deals Microsoft shipped, every one can be won but ' +
      '#11982. A loss here is a loss rather than a bad hand.',
  },
  yukon: {
    title: 'Yukon',
    summary: 'Klondike\u2019s seven columns with no deck to turn, and a handful of cards moves at once.',
    setup:
      'Seven columns holding one, six, seven, eight, nine, ten and eleven ' +
      'cards. The top five of each are face up and the rest are buried: ' +
      'twenty-one cards face down, and no deck at all.',
    play:
      'Any face-up card comes away with every card sitting on it, in ' +
      'whatever order those happen to be - only the bottom one has to fit ' +
      'where it lands, on a card of the other colour and one rank higher. ' +
      'Kings go into empty columns. Foundations build up in suit from the ' +
      'ace, as usual.',
    winning:
      'All fifty-two home. Everything you will ever be dealt is on the table ' +
      'from the first move, so the game is digging: every one of those ' +
      'twenty-one buried cards is turned by a move you found.',
  },
  canfield: {
    title: 'Canfield',
    summary: 'Thirteen cards in reserve, and foundations that start wherever the first card did.',
    setup:
      'Thirteen cards face down in the reserve with the top one turned up, ' +
      'four columns of one card each, and one card to a foundation - ' +
      'whatever rank that card is, all four foundations start there. The ' +
      'remaining thirty-four are the deck.',
    play:
      'Foundations build up in suit from the base rank and go round the ' +
      'corner - on past the king to the ace and onward. The columns build ' +
      'down in alternating colours and turn the same corner, so a king goes ' +
      'on an ace. The reserve gives up its top card, and refills any column ' +
      'you empty before you can use the space yourself; once it is gone, an ' +
      'empty column takes any card. Three cards a turn from the deck, and as ' +
      'many passes as you like.',
    winning:
      'All fifty-two home. Richard Canfield sold a deck for fifty dollars ' +
      'and paid five a card for whatever you got up - two thousand six ' +
      'hundred if you got them all - which is a business rather than a ' +
      'charity: a hand goes out perhaps one time in thirty.',
  },
  spiderette: {
    title: 'Spiderette',
    summary: 'Spider on one deck: build down by rank, but carry only a run of one suit.',
    setup:
      'Seven piles in a staircase, the first of one card and the last of ' +
      'seven, each with its top card face up. The other twenty-four cards ' +
      'stay in the deck, to be dealt a row at a time.',
    play:
      'Build down by rank and ignore suit entirely - any nine goes on any ' +
      'ten. But only a run that is all one suit can be picked up and moved, ' +
      'so every convenient placement is a card buried on purpose. An empty ' +
      'column takes anything - but the deck will not deal while one is open, ' +
      'so a space is a decision rather than a prize. Dealing puts one card ' +
      'onto every column at once, four times; the last row is three cards ' +
      'and goes to the first three columns.',
    winning:
      'Four complete suits, king down to ace. Nothing goes home a card at a ' +
      'time: a suit leaves the table the moment it is finished, all thirteen ' +
      'together. With four rows in the deck and a rule against dealing over ' +
      'a space, most hands come down to whether you can keep every column ' +
      'alive long enough to see the last of them.',
  },
  scorpion: {
    title: 'Scorpion',
    summary: 'Yukon\u2019s grip and Spider\u2019s order: a handful moves at once, onto its own suit.',
    setup:
      'Seven columns of seven. The first four have three cards face down ' +
      'under four face up; the last three are face up all the way. Three ' +
      'cards are held back.',
    play:
      'Any face-up card comes away with everything piled on it, whatever ' +
      'state those cards are in - and it may only be put down on the same ' +
      'suit, one rank higher. A nine of hearts has exactly one home in the ' +
      'whole deck, and it is very probably buried. Kings go into empty ' +
      'columns. The three held back are dealt onto the first three columns ' +
      'when you ask for them, once. There are no foundations: nothing is ' +
      'ever sent anywhere.',
    winning:
      'The four suits lying in four columns, king down to ace, and the other ' +
      'three columns empty. A finished suit stays where it was built and ' +
      'goes on occupying its column for the rest of the hand, which is most ' +
      'of why this is the hardest game here: three empty columns is all the ' +
      'room there will ever be.',
  },
  seahaven: {
    title: 'Seahaven Towers',
    summary: 'FreeCell\u2019s furniture, built down in suit, and only a king may take an empty column.',
    setup:
      'Ten columns of five cards, all face up, and four cells - the middle ' +
      'two already holding the pair of cards that would not fit the columns. ' +
      'Four empty foundations.',
    play:
      'Build down in suit rather than in colour, and send cards home in suit ' +
      'from the ace. A cell holds any one card. An empty column takes a king ' +
      'and nothing else, which is the rule the game turns on: a run can ' +
      'never be shuffled through a space, so the only room you have is the ' +
      'cells, and a run moves one card plus one for each cell still free.',
    winning:
      'All fifty-two home. The suit rule makes it harder than FreeCell and ' +
      'ten short columns make it easier; good players win most of their ' +
      'hands. Ten columns across a phone means smaller cards, which is the ' +
      'price of seeing all fifty-two at once.',
  },
  tripeaks: {
    title: 'Tri Peaks',
    summary: 'Three peaks of cards, one card face up beside the deck, and two minutes.',
    setup:
      'Three peaks of six cards each over a shared row of ten - twenty-eight ' +
      'in all, and only the bottom row face up. One card is turned face up ' +
      'beside the deck to start from, and twenty-three are left in it.',
    play:
      'Take any card you can see that is one rank above or below the card ' +
      'beside the deck, and it becomes the new card to match. The ranks go ' +
      'round the corner, so an ace follows a king and a king follows an ace. ' +
      'A card is yours once the two cards lying over it have gone; anything ' +
      'that uncovers turns face up. Turn the deck when you cannot see a ' +
      'move - there is no second pass.',
    winning:
      'All three peaks cleared. Nine in ten deals can be won by somebody who ' +
      'sees everything, which is the game: every card you take in a row is ' +
      'worth more than the last, and turning the deck starts you back at one.',
  },
  pyramid: {
    title: 'Pyramid',
    summary: 'Twenty-eight cards stacked in a pyramid, taken away in pairs that add to thirteen.',
    setup:
      'A pyramid of seven rows, one card at the top and seven along the ' +
      'bottom, all face up and each row covering the one above. The other ' +
      'twenty-four cards are the deck.',
    play:
      'An ace is one, a jack eleven, a queen twelve - and a king is thirteen ' +
      'on his own, so kings leave alone. Any two uncovered cards adding to ' +
      'thirteen come off together: two in the pyramid, or one in the pyramid ' +
      'and the card beside the deck, or that card and the one turned before ' +
      'it. A card is yours once the two lying on it have gone. The deck is ' +
      'turned one card at a time and does not come round again, so a card ' +
      'passed over is a card gone.',
    winning:
      'The pyramid bare, which happens about once in fifty hands - this is ' +
      'the strict game, one pass and no second look. Every pair you take ' +
      'uncovers something, so taking the wrong six early is how a hand stops ' +
      'being winnable twenty moves before you find out.',
  },
  golf: {
    title: 'Golf',
    summary: 'A wall of thirty-five cards, cleared one rank up or down onto the card in play.',
    setup:
      'Seven columns of five cards, all face up - thirty-five in the wall. ' +
      'One card is turned up beside the deck to play onto, and sixteen are ' +
      'left in it.',
    play:
      'Take any card at the foot of a column that is one rank above or below ' +
      'the card beside the deck, and it becomes the card to match. The ranks ' +
      'do not go round the corner: an ace takes only a two, and nothing at ' +
      'all may be played onto a king - a king turned off the deck ends the ' +
      'sequence there and then. Turn the deck when nothing fits, one card at ' +
      'a time, and there is no second pass.',
    winning:
      'The wall cleared before the deck runs out, which happens about one ' +
      'hand in ten. A full game is traditionally nine of them - nine holes, ' +
      'a point for every card you leave behind, and the lowest score wins.',
  },
  blackhole: {
    title: 'Black Hole',
    summary:
      'Seventeen fans of three around one hole, no deck, and nothing hidden anywhere.',
    setup:
      'The ace of spades alone in the hole, and the other fifty-one cards ' +
      'dealt face up into seventeen fans of three. There is no deck and ' +
      'nothing in reserve: what you can see is the whole game.',
    play:
      'Play the top card of any fan onto the hole if it is one rank above or ' +
      'below the card lying there - suit never matters. The ranks go round ' +
      'the corner, so an ace follows a king and a king follows an ace. Cards ' +
      'never move between fans and nothing ever comes back out of the hole. ' +
      'There is no deck to turn when you are stuck, which means there is no ' +
      'luck left after the deal.',
    winning:
      'All fifty-one cards into the hole. Something like eight or nine deals ' +
      'in ten can be won by somebody who plans the whole thing, so a hand ' +
      'you lose is a hand you misplayed - which is the opposite of Golf, ' +
      'where the deck decides half of it. David Parlett invented it, and it ' +
      'is the best thinking game here.',
  },
  acesup: {
    title: 'Aces Up',
    summary: 'Four piles, four cards at a time, and the lower card of a suit is thrown away.',
    setup:
      'Four cards face up in a row, one to each pile. The other forty-eight ' +
      'stay in the deck.',
    play:
      'Where two cards showing are of the same suit, the lower one is thrown ' +
      'away - and an ace is the highest card there is, so no ace can ever be ' +
      'thrown away. Only the top card of each pile counts as showing. A card ' +
      'may be moved into an empty pile, which is the only decision in the ' +
      'game, because it uncovers whatever was underneath. Then deal four ' +
      'more, one onto every pile, empty ones included.',
    winning:
      'The deck gone and only the four aces left - about one hand in thirty ' +
      'five. Most hands you will lose while playing perfectly, which is ' +
      'worth knowing before you start: it is a two-minute game and the ' +
      'shortest one here.',
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
