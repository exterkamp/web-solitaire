import { BOARD_MARGIN, CARD_HEIGHT, CARD_PEEK_HEIGHT } from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  BlackHoleState,
  FAN_COUNT,
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
} from './blackhole';

const WIDTH = 480;

// Seventeen fans in rows of six, six and five, and the hole below them.
//
// The game is traditionally laid out as a rosette with the foundation in the
// middle of it, which is a shape for a table rather than for a phone: it
// wants to be as wide as it is tall, and this board is half as wide as it is
// tall. Rows of six keep the cards at Klondike's size - the alternative was a
// ring of seventeen fans at about two thirds of it, which in a game where
// every card is a decision is the wrong thing to economise on.
const COLUMNS = 6;
const ROWS = [6, 6, 5];

// Below the printed lettering, which sits at TABLEAU_TOP_Y - 23.
const FAN_TOP = 150;
// Three cards deep is 143 units, so 152 leaves a clear gap between rows
// without the fans reading as one long column.
const ROW_STEP = 152;

// The hole, low and central: it is the only place a card can go, so it is the
// one thing a dragged card is ever aimed at.
const HOLE_Y = 655;

const PITCH = (WIDTH - 2 * BOARD_MARGIN) / COLUMNS;

function positionOf(index: number): { x: number; y: number } {
  let row = 0;
  let seen = 0;
  while (row < ROWS.length - 1 && index >= seen + ROWS[row]) {
    seen += ROWS[row];
    row++;
  }
  const place = index - seen;
  // Short rows are centred rather than left-aligned, so the block reads as a
  // block rather than as a table somebody stopped filling in.
  const start = (WIDTH - ROWS[row] * PITCH) / 2 + PITCH / 2;
  return { x: start + place * PITCH, y: FAN_TOP + row * ROW_STEP + CARD_HEIGHT / 2 };
}

// Black Hole, as the board sees it.
export function blackHoleTable(): TableGame<BlackHoleState> {
  return {
    id: 'blackhole',
    label: 'Black Hole',
    width: WIDTH,
    columns: COLUMNS,
    // Every pile placed by hand, and nothing here grows: a fan is three cards
    // at the deal and three cards or fewer for ever after, so there is no
    // room to reclaim and nothing for the board to slide.
    drops: false,
    // A win is fifty-one cards into the hole and so is fifty-one moves, every
    // time. Counting them measures nothing.
    showsMoves: false,

    slots(_handedness: Handedness): PileSlot[] {
      // Handedness does not come into it. There is one target and it is in
      // the middle, which is as reachable by one thumb as the other.
      return [
        ...Array.from({ length: FAN_COUNT }, (_, i) => {
          const at = positionOf(i);
          return {
            ref: { kind: 'tableau', index: i } as PileRef,
            column: 0,
            row: 'tableau' as const,
            x: at.x,
            y: at.y,
            // An emptied fan is table again, and nothing is ever put back on
            // one - cards only ever go one way in this game.
            printed: false,
            target: false,
          };
        }),
        {
          ref: { kind: 'foundation', index: 0 },
          column: 0,
          row: 'top',
          x: WIDTH / 2,
          y: HOLE_Y,
          target: true,
        },
      ];
    },

    // The fans show every card's index; the hole is a heap whose top is the
    // only part that matters.
    fanStep(ref: PileRef, _cards: readonly Card[], index: number): number {
      return ref.kind === 'tableau' && index > 0 ? CARD_PEEK_HEIGHT : 0;
    },

    fansUp: () => false,

    deal,
    // Nothing is hidden in this game, at any point.
    dealsFaceDown: false,

    piles(state: BlackHoleState): PileCards[] {
      return [
        ...state.fans.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
        { ref: { kind: 'foundation', index: 0 }, cards: state.hole },
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<BlackHoleState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // No homeFor, and this is the one game where that is a choice rather than
    // an absence: the hole *is* a foundation and a flick would work. But a
    // flick is an upward gesture and the hole is at the bottom of the board,
    // so it would mean "send this card home" while pointing away from home.
    // Tap it or drag it down to it.

    // How many cards are still out there. The only number in the game, and
    // the whole of the scoring: fifty-one is a bad hand and nought is a won
    // one, and everything in between is how close you came.
    view(state: BlackHoleState): GameView {
      return { left: cardsLeft(state) };
    },

    // Out of the hole, which is where the deal starts and ends.
    dealOrigin() {
      return { x: WIDTH / 2, y: HOLE_Y };
    },
  };
}
