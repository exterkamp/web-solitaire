import { CARD_HEIGHT } from './config';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  CELL_COUNT,
  PokerSquaresState,
  SIZE,
  TARGET,
  apply,
  canDrop,
  deal,
  emptyCells,
  hasWon,
  isDeadEnd,
  liftable,
  placeAt,
  score,
} from './pokersquares';

// Narrower than the 480 every column game is laid out on, which is the point:
// the board is fitted to the screen's width, so five columns on a narrower
// table are five bigger cards. Twenty-five of them have to be read at a
// glance, all at once, every turn - the one game here where every card on
// the table is part of every decision.
const WIDTH = 400;
const PITCH_X = (WIDTH - 2 * 10) / SIZE;
const PITCH_Y = CARD_HEIGHT + 12;

// The top edge of the grid: below the printed lettering, which sits at
// TABLEAU_TOP_Y - 23 on every board.
const GRID_TOP = 172;

// The card in hand, centred under the grid, with the deck it came off to one
// side. Low on the board, where every turn starts.
const HAND_Y = GRID_TOP + PITCH_Y * SIZE + 24 + CARD_HEIGHT / 2;
const STOCK_OFFSET = 120;

const cellX = (column: number) => 10 + PITCH_X / 2 + column * PITCH_X;
const cellY = (row: number) => GRID_TOP + CARD_HEIGHT / 2 + row * PITCH_Y;

// Poker Squares, as the board sees it.
//
// A grid of twenty-five printed cells and the card waiting to go into one.
// Press a cell and the card goes there; or carry it there, which is the same
// move made slower. Nothing else on the board moves, so there is nothing to
// flick, nothing to tap a card for, and nothing to take back: the next card
// is turned the moment this one lands, and an undo would be a look at it.
export function pokerSquaresTable(): TableGame<PokerSquaresState> {
  return {
    id: 'pokersquares',
    label: 'Poker Squares',
    width: WIDTH,
    columns: SIZE,
    drops: false,
    // Twenty-five, every hand. Not a number anybody plays against.
    showsMoves: false,
    target: TARGET,
    undoable: false,

    slots(handedness: Handedness): PileSlot[] {
      const right = handedness === 'right';
      const middle = WIDTH / 2;
      return [
        ...Array.from({ length: CELL_COUNT }, (_, i) => ({
          ref: { kind: 'tableau', index: i } as PileRef,
          column: i % SIZE,
          row: 'tableau' as const,
          x: cellX(i % SIZE),
          y: cellY(Math.floor(i / SIZE)),
        })),
        {
          ref: { kind: 'waste', index: 0 },
          column: 0,
          row: 'top',
          x: middle,
          y: HAND_Y,
        },
        {
          // Away from the thumb: it is never pressed. It is only there to
          // say the card in hand came from somewhere.
          ref: { kind: 'stock', index: 0 },
          column: 0,
          row: 'top',
          x: middle + (right ? -STOCK_OFFSET : STOCK_OFFSET),
          y: HAND_Y,
          recycle: false,
        },
      ];
    },

    fanStep: () => 0,
    fansUp: () => false,

    deal,
    dealsFaceDown: false,

    piles(state: PokerSquaresState): PileCards[] {
      return [
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        { ref: { kind: 'waste', index: 0 }, cards: state.waste },
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<PokerSquaresState> | undefined => apply(state, move),
    // A tap on the card in hand has no answer: where it goes is the whole
    // game. A tap on the cell is the answer instead - see placeAt.
    autoTarget: () => undefined,
    placeAt,
    autoFinishMove: () => undefined,
    canAutoFinish: () => false,
    hasWon,
    isDeadEnd,

    // The score so far, and how many cells are still to fill.
    view(state: PokerSquaresState): GameView {
      return { score: score(state), left: emptyCells(state) };
    },

    dealOrigin(handedness: Handedness) {
      return { x: WIDTH / 2 + (handedness === 'right' ? -STOCK_OFFSET : STOCK_OFFSET), y: HAND_Y };
    },
  };
}
