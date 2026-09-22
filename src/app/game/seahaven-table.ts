import {
  CARD_PEEK_HEIGHT,
  COLUMN_PITCH,
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
  CELL_COUNT,
  COLUMN_COUNT,
  SeahavenState,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDrop,
  deal,
  freeCells,
  hasWon,
  isDeadEnd,
  liftable,
} from './seahaven';

// The widest table here, and the cards pay for it.
//
// Ten columns at the pitch the other games use is 677 units against
// Klondike's 480, and since the board is fitted to the screen by width, a
// card comes out about seventy per cent of the size - 37 CSS pixels across on
// a 412-pixel phone, where Klondike's is 51. That is the real cost of ten
// columns in portrait and there is no way to buy it back: the screen is as
// wide as it is, and ten piles have to fit across it. It is the same
// arithmetic that kept Spider off this menu, and the difference is that
// Seahaven's piles are five deep rather than fifty-four - everything is
// visible at a glance, so a smaller card is still a card you can read rather
// than one you have to dig through.
const WIDTH = Math.round(COLUMN_PITCH * COLUMN_COUNT + 20);

// Seahaven Towers, as the board sees it.
export function seahavenTable(): TableGame<SeahavenState> {
  return {
    id: 'seahaven',
    label: 'Seahaven Towers',
    width: WIDTH,
    columns: COLUMN_COUNT,

    slots(handedness: Handedness): PileSlot[] {
      // Foundations under the thumb holding the phone and the cells at the
      // far end. Nothing here is pressed repeatedly - there is no deck - so
      // the row goes to the pile you aim at, and in this game that is
      // overwhelmingly a foundation: a suit-built column refuses almost
      // everything, so home is where cards go.
      const right = handedness === 'right';
      const cellColumn = (i: number) => (right ? i : COLUMN_COUNT - CELL_COUNT + i);
      const homeColumn = (i: number) => (right ? COLUMN_COUNT - SUITS.length + i : i);

      return [
        ...Array.from({ length: CELL_COUNT }, (_, i) => ({
          ref: { kind: 'cell', index: i } as PileRef,
          column: cellColumn(i),
          row: 'top' as const,
        })),
        ...SUITS.map((suit, i) => ({
          ref: { kind: 'foundation', index: i } as PileRef,
          column: homeColumn(i),
          row: 'top' as const,
          ghost: suit,
        })),
        ...Array.from({ length: COLUMN_COUNT }, (_, i) => ({
          ref: { kind: 'tableau', index: i } as PileRef,
          column: i,
          row: 'tableau' as const,
        })),
      ];
    },

    // Every card face up, so the fan is the same gap all the way down: an
    // index and its margins.
    fanStep(ref: PileRef, _cards: readonly Card[], index: number): number {
      return ref.kind === 'tableau' && index > 0 ? CARD_PEEK_HEIGHT : 0;
    },

    fansUp: () => false,

    deal,
    dealsFaceDown: false,

    piles(state: SeahavenState): PileCards[] {
      return [
        ...state.cells.map((cards, i) => ({ ref: { kind: 'cell', index: i } as PileRef, cards })),
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<SeahavenState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    homeFor: (card: Card): PileRef => ({ kind: 'foundation', index: foundationIndexOf(card.suit) }),

    // The cells, which in this game are the whole of the room you have. Two
    // of the four are occupied before the first move, and watching that
    // number is watching how much game is left in the position.
    view(state: SeahavenState): GameView {
      return { free: freeCells(state) };
    },

    drops: true,
    showsMoves: true,

    // Out of the middle of the top row - there is no deck to deal from.
    dealOrigin() {
      return { x: columnCentre((COLUMN_COUNT - 1) / 2, WIDTH, COLUMN_COUNT), y: TOP_ROW_Y };
    },
  };
}
