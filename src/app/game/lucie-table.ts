import { BOARD_MARGIN, CARD_HEIGHT, CARD_PEEK_HEIGHT, SUITS, TABLEAU_TOP_Y } from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  FAN_COUNT,
  FOUNDATION_COUNT,
  LucieState,
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
} from './lucie';

const WIDTH = 480;
const COLUMNS = 6;
const PITCH = (WIDTH - 2 * BOARD_MARGIN) / COLUMNS;
const columnX = (column: number) => BOARD_MARGIN + PITCH / 2 + column * PITCH;

// The foundations and the redeal, along the bottom, under the thumb.
//
// Not in the top row, where Klondike keeps its foundations: a board that
// places its own piles is raised up a short screen as far as its lettering
// allows (see MAX_RAISE in solitaire-scene.ts), and anything printed above
// the lettering is raised into the rail. Down here they are also what holds
// the board down to its full height - a fixed layout is set on the floor by
// its lowest slot, and without one this low the fans would be slid down into
// the room they need to grow into.
const BOTTOM_Y = 846;

// Eighteen fans in three rows of six, below the lettering and above the
// bottom row. A fan is three cards at the deal and grows as cards are built on
// it, so each row gets an equal share of the height rather than the height
// of three cards.
const ROWS = 3;
const ROW_STEP = Math.floor((BOTTOM_Y - CARD_HEIGHT / 2 - 12 - TABLEAU_TOP_Y) / ROWS);
// How far down its slot a fan may reach before it starts to close up: its
// row's share, less a card and a gap above the next row.
const FAN_ROOM = ROW_STEP - CARD_HEIGHT - 10;

// La Belle Lucie, as the board sees it.
//
// The fans are fanned down rather than across, the way they would be on a
// table: eighteen fans of three across a phone's width is six cards a row,
// and a fan that spread sideways would cover its neighbour. Down, it only
// ever reaches into the gap above the next row - and closes up to stay in it.
export function lucieTable(): TableGame<LucieState> {
  return {
    id: 'lucie',
    label: 'La Belle Lucie',
    width: WIDTH,
    columns: COLUMNS,
    drops: false,
    showsMoves: true,

    slots(handedness: Handedness): PileSlot[] {
      const right = handedness === 'right';
      return [
        // The foundations across the middle of the bottom row, in suit
        // order, whichever hand: the redeal takes the corner the thumb is in.
        ...Array.from({ length: FOUNDATION_COUNT }, (_, i) => ({
          ref: { kind: 'foundation', index: i } as PileRef,
          column: i + 1,
          row: 'top' as const,
          x: columnX(i + 1),
          y: BOTTOM_Y,
          ghost: SUITS[i],
        })),
        ...Array.from({ length: FAN_COUNT }, (_, i) => ({
          ref: { kind: 'tableau', index: i } as PileRef,
          column: i % COLUMNS,
          row: 'tableau' as const,
          x: columnX(i % COLUMNS),
          y: TABLEAU_TOP_Y + CARD_HEIGHT / 2 + Math.floor(i / COLUMNS) * ROW_STEP,
          // An emptied fan is table again: nothing is printed where it was,
          // and canDrop refuses anything put there. A fan with cards on it is
          // a target like any other.
          printed: false,
        })),
        {
          ref: { kind: 'stock', index: 0 },
          column: right ? COLUMNS - 1 : 0,
          row: 'top',
          x: columnX(right ? COLUMNS - 1 : 0),
          y: BOTTOM_Y,
          // Gather, shuffle, deal again. The arrow is what says so.
          recycle: true,
        },
      ];
    },

    // Every index showing, closing up only once a fan has grown past the
    // room its row has for it.
    fanStep(ref: PileRef, cards: readonly Card[], index: number): number {
      if (ref.kind !== 'tableau' || index === 0) return 0;
      return Math.min(CARD_PEEK_HEIGHT, FAN_ROOM / (cards.length - 1));
    },

    fansUp: () => false,

    deal,
    dealsFaceDown: false,

    piles(state: LucieState): PileCards[] {
      return [
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
        // Always empty: the redeal is a press on a slot, not a pile of cards.
        { ref: { kind: 'stock', index: 0 }, cards: [] },
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<LucieState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // No homeFor, for Black Hole's reason: a flick is an upward gesture and
    // home is along the bottom. A tap sends a card home.

    // Cards still out, and what is left to fall back on: the redeals, and
    // then the merci.
    view(state: LucieState): GameView {
      return {
        left: cardsLeft(state),
        redeals: state.redeals > 0 ? state.redeals : undefined,
        merci: state.redeals === 0 ? (state.merci ? 1 : 0) : undefined,
      };
    },

    dealOrigin(handedness: Handedness) {
      return { x: columnX(handedness === 'right' ? COLUMNS - 1 : 0), y: BOTTOM_Y };
    },
  };
}
