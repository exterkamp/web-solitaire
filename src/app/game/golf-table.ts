import { CARD_HEIGHT, CARD_PEEK_HEIGHT, TABLEAU_COUNT, columnCentre } from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  COLUMN_COUNT,
  GolfState,
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
} from './golf';

const WIDTH = 480;

// Where the wall starts, measured to the top edge of the first card. Higher
// than a tableau usually sits, because this one never grows: five cards is
// five cards from the deal to the end of the hand, and the room a Klondike
// pile might one day need is room this game can spend on the gap between the
// wall and the hand.
const WALL_TOP = 150;

// The deck and the card in play, low, where between them they are every press
// in the game. The same arrangement Tri Peaks uses, for the same reason.
const HAND_Y = 600;
const HAND_GAP = 150;

// Golf, as the board sees it.
//
// A wall of seven columns that never changes shape, and the two piles that
// matter at the bottom of the screen. Everything is placed by hand rather
// than laid out in the board's two rows - which is why this one turns the
// board's thumb-reach drop off: there is nothing to slide down, because it
// was written where a thumb can reach it in the first place.
export function golfTable(): TableGame<GolfState> {
  return {
    id: 'golf',
    label: 'Golf',
    width: WIDTH,
    columns: TABLEAU_COUNT,
    drops: false,
    // A tap on whatever you spotted, not a decision worth counting.
    showsMoves: false,

    slots(handedness: Handedness): PileSlot[] {
      const right = handedness === 'right';
      const middle = WIDTH / 2;
      return [
        ...Array.from({ length: COLUMN_COUNT }, (_, i) => ({
          ref: { kind: 'tableau', index: i } as PileRef,
          column: i,
          row: 'tableau' as const,
          x: columnCentre(i, WIDTH, TABLEAU_COUNT),
          y: WALL_TOP + CARD_HEIGHT / 2,
          // A column emptied is a hole in the wall, not a place a card
          // belongs - and nothing is ever put back, so there is nothing to
          // light up either.
          printed: false,
          target: false,
        })),
        {
          ref: { kind: 'stock', index: 0 },
          column: 0,
          row: 'top',
          x: middle + (right ? HAND_GAP / 2 : -HAND_GAP / 2),
          y: HAND_Y,
          // No second pass. When the deck is out it is out, and an arrow
          // printed on the empty slot would be an invitation to press
          // something that does nothing.
          recycle: false,
        },
        {
          ref: { kind: 'waste', index: 0 },
          column: 0,
          row: 'top',
          x: middle - (right ? HAND_GAP / 2 : -HAND_GAP / 2),
          y: HAND_Y,
          // The one place a card can go in this game.
          target: true,
        },
      ];
    },

    // The wall fans downward and every card in it is face up, so the gap is
    // the same all the way: an index and its margins.
    fanStep(ref: PileRef, _cards: readonly Card[], index: number): number {
      return ref.kind === 'tableau' && index > 0 ? CARD_PEEK_HEIGHT : 0;
    },

    fansUp: () => false,

    deal,
    // Nothing on the wall is hidden, so there is nothing to turn over on the
    // way down.
    dealsFaceDown: false,

    piles(state: GolfState): PileCards[] {
      return [
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        { ref: { kind: 'waste', index: 0 }, cards: state.waste },
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<GolfState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // No foundations, so no homeFor and no flick - the same answer Tri Peaks
    // gives, for the same reason.

    // What is left on the wall, and what is left in the deck. Between them
    // they are the arithmetic of the whole hand: thirty-five to clear and
    // sixteen turns to do it in.
    view(state: GolfState): GameView {
      return { left: cardsLeft(state), deck: state.stock.length, stock: state.stock.length };
    },

    dealOrigin(handedness: Handedness) {
      const right = handedness === 'right';
      return { x: WIDTH / 2 + (right ? HAND_GAP / 2 : -HAND_GAP / 2), y: HAND_Y };
    },
  };
}
