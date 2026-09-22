import {
  CARD_PEEK_HEIGHT,
  FOUNDATION_COUNT,
  SUITS,
  TOP_ROW_Y,
  columnCentre,
} from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import { foundationIndexOf } from './card-rules';
import {
  COLUMN_COUNT,
  CanfieldState,
  RESERVE_REF,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDrop,
  deal,
  hasWon,
  isDeadEnd,
  liftable,
  reserveLeft,
} from './canfield';

const WIDTH = 480;

// Six columns of room for four columns of cards.
//
// Four foundations, a waste and a deck is six things across the top row, and
// the tableau has to sit under the foundations rather than beside them - so
// the board is six columns wide and the four piles use the first four of
// them. The spare column between the tableau and the reserve is the gap that
// makes the reserve read as a pile off to one side rather than a fifth
// column, which is what it would be mistaken for otherwise.
const LAYOUT_COLUMNS = 6;

// Canfield, as the board sees it.
export function canfieldTable(): TableGame<CanfieldState> {
  return {
    id: 'canfield',
    label: 'Canfield',
    width: WIDTH,
    columns: LAYOUT_COLUMNS,

    slots(handedness: Handedness): PileSlot[] {
      // The deck and the reserve under the thumb holding the phone, one above
      // the other. Between them they are nearly every press in this game: the
      // deck because it is turned constantly, and the reserve because it is
      // the pile you are playing against.
      const right = handedness === 'right';
      const home = (i: number) => (right ? i : LAYOUT_COLUMNS - FOUNDATION_COUNT + i);
      const column = (i: number) => (right ? i : LAYOUT_COLUMNS - COLUMN_COUNT + i);
      const stockColumn = right ? LAYOUT_COLUMNS - 1 : 0;
      const wasteColumn = right ? LAYOUT_COLUMNS - 2 : 1;

      return [
        ...SUITS.map((suit, i) => ({
          ref: { kind: 'foundation', index: i } as PileRef,
          column: home(i),
          row: 'top' as const,
          ghost: suit,
        })),
        { ref: { kind: 'waste', index: 0 }, column: wasteColumn, row: 'top' },
        { ref: { kind: 'stock', index: 0 }, column: stockColumn, row: 'top', recycle: true },
        ...Array.from({ length: COLUMN_COUNT }, (_, i) => ({
          ref: { kind: 'tableau', index: i } as PileRef,
          column: column(i),
          row: 'tableau' as const,
        })),
        // The reserve, held as a cell because that is what it is to the
        // board: a pile off to one side that gives up its top card. Printed,
        // because an empty one is worth seeing - it is the moment the game
        // changes.
        { ref: RESERVE_REF, column: stockColumn, row: 'tableau' },
      ];
    },

    // The columns fan; the reserve is squared, which is how it is dealt and
    // how it is played - one card at a time off the top, and no reading ahead.
    fanStep(ref: PileRef, _cards: readonly Card[], index: number): number {
      return ref.kind === 'tableau' && index > 0 ? CARD_PEEK_HEIGHT : 0;
    },

    fansUp: () => false,

    deal,
    dealsFaceDown: false,

    piles(state: CanfieldState): PileCards[] {
      return [
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        { ref: { kind: 'waste', index: 0 }, cards: state.waste },
        { ref: RESERVE_REF, cards: state.reserve },
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<CanfieldState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    homeFor: (card: Card): PileRef => ({ kind: 'foundation', index: foundationIndexOf(card.suit) }),

    // The base rank and the reserve, and deliberately not the deck.
    //
    // The reserve is the game - thirteen cards you cannot see and cannot
    // refuse - and how many are left is the only honest measure of how a hand
    // is going. The deck is not a clock in this one: passes are unlimited, so
    // a count of what is still in it says nothing about how much game is
    // left. `stock` and `waste` are still reported because the board's finish
    // uses them to know when turning the deck has stopped getting anywhere;
    // neither is shown.
    view(state: CanfieldState): GameView {
      return {
        base: state.base,
        reserve: reserveLeft(state),
        stock: state.stock.length,
        waste: state.waste.length,
      };
    },

    drops: true,
    showsMoves: true,

    dealOrigin(handedness: Handedness) {
      const right = handedness === 'right';
      return {
        x: columnCentre(right ? LAYOUT_COLUMNS - 1 : 0, WIDTH, LAYOUT_COLUMNS),
        y: TOP_ROW_Y,
      };
    },
  };
}
