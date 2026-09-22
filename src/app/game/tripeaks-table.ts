import { CARD_HEIGHT, CARD_WIDTH } from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  BOARD_SIZE,
  POSITIONS,
  TriPeaksState,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDrop,
  cardsLeft,
  deal,
  hasWon,
  isDeadEnd,
  liftable,
} from './tripeaks';

// TriPeaks, as the board sees it - and the first game here whose board is not
// a grid.
//
// Everything else lays its piles out in columns and two rows and lets the
// board work out where those are. This one places all thirty positions
// itself: three peaks of overlapping cards, and a deck and a discard down
// where a thumb can reach them.

// Half a card's step across, which is the unit the peaks are built in.
//
// Twenty-five rather than thirty, so the base row overlaps by ten units of
// sixty. That overlap is what keeps the board narrow enough for the cards to
// stay a decent size: at no overlap this board is 674 units wide and a card
// comes out smaller on a phone than FreeCell's; at this pitch it is 550 and
// they match. A card is indexed in its top-left corner, so ten units off its
// right edge costs nothing you read.
const HALF_STEP = 25;

// And down. Just over half a card, which leaves the card underneath showing
// its index and a little more - the same bargain a tableau fan makes.
const ROW_STEP = 44;

const MARGIN = 20;
const PEAK_TOP = 150;

// Where the deck and the card in play sit: low, because between them they are
// every press in the game.
const HAND_Y = 600;
const HAND_GAP = 150;

const WIDTH = MARGIN * 2 + 18 * HALF_STEP + CARD_WIDTH;

function positionOf(index: number): { x: number; y: number } {
  const { row, x } = POSITIONS[index];
  return {
    x: MARGIN + CARD_WIDTH / 2 + x * HALF_STEP,
    y: PEAK_TOP + row * ROW_STEP + CARD_HEIGHT / 2,
  };
}

export function tripeaksTable(): TableGame<TriPeaksState> {
  return {
    id: 'tripeaks',
    label: 'Tri Peaks',
    width: WIDTH,
    // Nothing here is laid out in columns, but the board asks, and ten is
    // what the base row would be if it were.
    columns: 10,
    // Every pile placed by hand, so there is nothing for the board to slide.
    drops: false,
    // A move here is a tap on whatever you spotted, not a decision worth
    // counting - and the bar has four numbers on it already.
    showsMoves: false,

    slots(handedness: Handedness): PileSlot[] {
      // The deck under the thumb holding the phone, and the card in play
      // beside it. The deck is the only thing pressed repeatedly here - it is
      // what you press when you cannot see a move.
      const right = handedness === 'right';
      const middle = WIDTH / 2;
      const stockX = middle + (right ? HAND_GAP / 2 : -HAND_GAP / 2);
      const wasteX = middle - (right ? HAND_GAP / 2 : -HAND_GAP / 2);

      return [
        ...Array.from({ length: BOARD_SIZE }, (_, i) => {
          const at = positionOf(i);
          return {
            ref: { kind: 'tableau', index: i } as PileRef,
            column: 0,
            row: 'tableau' as const,
            x: at.x,
            y: at.y,
            // A cleared position is table again, not a place a card belongs -
            // and nothing can be put back on the peaks, so there is nothing
            // to highlight either.
            printed: false,
            target: false,
          };
        }),
        {
          ref: { kind: 'stock', index: 0 },
          column: 0,
          row: 'top',
          x: stockX,
          y: HAND_Y,
          recycle: true,
        },
        {
          ref: { kind: 'waste', index: 0 },
          column: 0,
          row: 'top',
          x: wasteX,
          y: HAND_Y,
          // The one place a card can go in this game, so the one thing worth
          // lighting up when a card is dragged.
          target: true,
        },
      ];
    },

    // Nothing fans. A peak position holds one card, the deck is a stack you
    // never read, and the discard is a pile whose top is the only part that
    // matters.
    fanStep: () => 0,
    fansUp: () => false,

    deal,
    // The peaks are dealt face down above the base row, but the board's
    // dealing animation turns cards over on arrival only for games that hide
    // their tableau under others. Here the cards are dealt as they lie.
    dealsFaceDown: false,

    piles(state: TriPeaksState): PileCards[] {
      // Row by row from the top, so that each row is drawn over the one
      // above it - which is what makes the peaks look like peaks rather than
      // like a wall of cards. POSITIONS is already in that order.
      return [
        ...state.board.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        { ref: { kind: 'waste', index: 0 }, cards: state.waste },
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<TriPeaksState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // No homeFor, and that is the answer rather than an omission: there are
    // no foundations here. Naming the discard would make a flick mean the
    // same as a tap, which is worse than it meaning nothing - the gesture
    // would fire on every card somebody lifted to look at.

    view(state: TriPeaksState): GameView {
      // The run is the game. A card taken is worth as much as the number of
      // cards taken before it without turning the deck, so watching that
      // number climb is watching yourself play well.
      return { score: state.score, run: state.run, left: cardsLeft(state), stock: state.stock.length };
    },

    // Off the deck, like everything else in this game.
    dealOrigin(handedness: Handedness) {
      const right = handedness === 'right';
      return { x: WIDTH / 2 + (right ? HAND_GAP / 2 : -HAND_GAP / 2), y: HAND_Y };
    },
  };
}
