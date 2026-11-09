import { CARD_BACK_PEEK_HEIGHT, CARD_PEEK_HEIGHT, COLUMN_PITCH, TOP_ROW_Y, columnCentre } from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  COLUMN_COUNT,
  FOUNDATION_COUNT,
  SpiderState,
  SuitCount,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDrop,
  deal,
  hasWon,
  hiddenCards,
  isDeadEnd,
  liftable,
} from './spider';

// Ten columns, at Seahaven's width and for Seahaven's reason: the screen is
// as wide as it is, and ten piles have to fit across it. Spiderette was the
// answer to that for a long time, and it is still here; this is the game it
// was cut down from, for anybody who wants the real one at the smaller card.
const WIDTH = Math.round(COLUMN_PITCH * COLUMN_COUNT + 20);

// Spider, as the board sees it.
//
// The top row is the deck and the eight places a finished suit goes - nine
// of the ten columns, with the gap between them. The foundations carry no
// suit: there are two of every suit, or eight of one, and they fill in the
// order the suits are finished.
export function spiderTable(suits: SuitCount): TableGame<SpiderState> {
  return {
    id: 'spider',
    label: 'Spider',
    width: WIDTH,
    columns: COLUMN_COUNT,

    slots(handedness: Handedness): PileSlot[] {
      // The deck under the thumb, as in Spiderette: it is the press that
      // changes every column.
      const right = handedness === 'right';
      return [
        {
          ref: { kind: 'stock', index: 0 },
          column: right ? COLUMN_COUNT - 1 : 0,
          row: 'top',
          recycle: false,
        },
        ...Array.from({ length: FOUNDATION_COUNT }, (_, i) => ({
          ref: { kind: 'foundation', index: i } as PileRef,
          column: right ? i : COLUMN_COUNT - FOUNDATION_COUNT + i,
          row: 'top' as const,
        })),
        ...Array.from({ length: COLUMN_COUNT }, (_, i) => ({
          ref: { kind: 'tableau', index: i } as PileRef,
          column: i,
          row: 'tableau' as const,
        })),
      ];
    },

    fanStep(ref: PileRef, cards: readonly Card[], index: number): number {
      if (ref.kind !== 'tableau' || index === 0) return 0;
      return cards[index - 1].faceUp ? CARD_PEEK_HEIGHT : CARD_BACK_PEEK_HEIGHT;
    },

    fansUp: () => false,

    deal: (random) => deal(suits, random),
    dealsFaceDown: true,

    piles(state: SpiderState): PileCards[] {
      return [
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<SpiderState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // No homeFor, for Spiderette's reason: a suit goes home finished or not
    // at all.

    view(state: SpiderState): GameView {
      return { deck: state.stock.length, hidden: hiddenCards(state), stock: state.stock.length };
    },

    drops: true,
    showsMoves: true,

    dealOrigin(handedness: Handedness) {
      const right = handedness === 'right';
      return {
        x: columnCentre(right ? COLUMN_COUNT - 1 : 0, WIDTH, COLUMN_COUNT),
        y: TOP_ROW_Y,
      };
    },
  };
}
