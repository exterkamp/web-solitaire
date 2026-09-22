import { CARD_HEIGHT, CARD_WIDTH } from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  BOARD_SIZE,
  POSITIONS,
  PyramidState,
  ROW_COUNT,
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
} from './pyramid';

// Pyramid, as the board sees it - the second game here whose board is not a
// grid, and the one that fills the most of it.

// Half a card across, exactly, so the pyramid interlocks without overlapping
// sideways: each card sits in the notch between the two below it and every
// card is fully visible left to right. Tri Peaks overlaps by ten units to
// keep three peaks inside a phone; one pyramid is seven cards wide at the
// base and needs no such squeezing.
const HALF_STEP = CARD_WIDTH / 2;

// And down, which is where the overlapping happens: just over half a card,
// leaving the row beneath showing its index and a little more.
const ROW_STEP = 44;

const MARGIN = 20;

// Where the apex sits. A hundred and fifty rather than the hundred it was
// first given, because the board prints the game's name across the felt at
// TABLEAU_TOP_Y - 23 and a taller pyramid puts its second row straight
// through the lettering. Tri Peaks starts at the same height for the same
// reason.
const APEX_TOP = 150;

// The deck, the card in play and the heap, low, where the thumbs are. Three
// piles rather than Tri Peaks' two, because a king leaves on his own and has
// to leave somewhere.
const HAND_Y = 600;
const HAND_GAP = 150;

// Twelve half-steps from the left edge of the leftmost card to the left edge
// of the rightmost, plus a card, plus the margins.
const WIDTH = MARGIN * 2 + (ROW_COUNT - 1) * 2 * HALF_STEP + CARD_WIDTH;

function positionOf(index: number): { x: number; y: number } {
  const { row, slot } = POSITIONS[index];
  // Each row is half a card further left than the row above is wide, which is
  // the whole of the pyramid's geometry.
  const steps = ROW_COUNT - 1 - row + 2 * slot;
  return {
    x: MARGIN + CARD_WIDTH / 2 + steps * HALF_STEP,
    y: APEX_TOP + row * ROW_STEP + CARD_HEIGHT / 2,
  };
}

export function pyramidTable(): TableGame<PyramidState> {
  return {
    id: 'pyramid',
    label: 'Pyramid',
    width: WIDTH,
    // Nothing is laid out in columns here. Seven is what the base row would
    // be if it were.
    columns: ROW_COUNT,
    // Every pile placed by hand, so there is nothing for the board to slide.
    drops: false,
    showsMoves: true,

    slots(handedness: Handedness): PileSlot[] {
      const right = handedness === 'right';
      const middle = WIDTH / 2;
      // The deck under the thumb holding the phone; the heap at the other
      // end, where nothing is ever pressed.
      const stockX = middle + (right ? HAND_GAP : -HAND_GAP);
      const discardX = middle - (right ? HAND_GAP : -HAND_GAP);

      return [
        ...Array.from({ length: BOARD_SIZE }, (_, i) => {
          const at = positionOf(i);
          return {
            ref: { kind: 'tableau', index: i } as PileRef,
            column: 0,
            row: 'tableau' as const,
            x: at.x,
            y: at.y,
            // A taken position is table again rather than a place a card
            // belongs, so nothing is printed there - but it is a target, and
            // has to be: pairing two cards in the pyramid is done by dragging
            // one onto the other.
            printed: false,
            target: true,
          };
        }),
        { ref: { kind: 'stock', index: 0 }, column: 0, row: 'top', x: stockX, y: HAND_Y, recycle: true },
        { ref: { kind: 'waste', index: 0 }, column: 0, row: 'top', x: middle, y: HAND_Y, target: true },
        {
          ref: { kind: 'foundation', index: 0 },
          column: 0,
          row: 'top',
          x: discardX,
          y: HAND_Y,
          target: true,
        },
      ];
    },

    // Nothing fans: a pyramid position holds one card, the deck is a stack
    // nobody reads, and the heap only ever shows its top.
    fanStep: () => 0,
    fansUp: () => false,

    deal,
    // The pyramid is dealt as it lies. Nothing in this game is hidden.
    dealsFaceDown: false,

    piles(state: PyramidState): PileCards[] {
      // Row by row from the apex, so each row is drawn over the one above it
      // - which is what makes a pyramid look like a pyramid rather than a
      // pile of cards. POSITIONS is already in that order.
      return [
        ...state.pyramid.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
        { ref: { kind: 'foundation', index: 0 }, cards: state.discard },
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        { ref: { kind: 'waste', index: 0 }, cards: state.waste },
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<PyramidState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // A flick sends a king to the heap. Everything else the board offers the
    // throw to is refused by canDrop and lands where it was let go, which is
    // the right answer: a pair is two cards and a flick only ever names one.
    homeFor: (): PileRef => ({ kind: 'foundation', index: 0 }),

    // What is left standing, and what is left to turn. Between them they are
    // the whole of a hand of Pyramid: twenty-eight to clear, and about
    // seventy cards' worth of deck to do it with.
    view(state: PyramidState): GameView {
      return { left: cardsLeft(state), deck: state.stock.length, stock: state.stock.length };
    },

    dealOrigin(handedness: Handedness) {
      const right = handedness === 'right';
      return { x: WIDTH / 2 + (right ? HAND_GAP : -HAND_GAP), y: HAND_Y };
    },
  };
}
