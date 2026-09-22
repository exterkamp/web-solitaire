import {
  CARD_BACK_PEEK_HEIGHT,
  CARD_PEEK_HEIGHT,
  FOUNDATION_COUNT,
  SUITS,
  TABLEAU_COUNT,
  TOP_ROW_Y,
  columnCentre,
} from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  ScorpionState,
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
} from './scorpion';

const WIDTH = 480;

// Scorpion, as the board sees it.
//
// Spiderette's table with a shorter deck on it. Seven columns of seven means
// the fans here start deep and get deeper - a column can hold most of a suit
// by the end - so the board's fan squeezing does more work in this game than
// in any other on it.
//
// The stock slot holds three cards and is pressed once in a game. It is kept
// under the thumb anyway: three cards is not much, but it is the only thing
// in this game that arrives rather than being dug up.
export function scorpionTable(): TableGame<ScorpionState> {
  return {
    id: 'scorpion',
    label: 'Scorpion',
    width: WIDTH,
    columns: TABLEAU_COUNT,

    slots(handedness: Handedness): PileSlot[] {
      // The deck under the thumb holding the phone, as everywhere else.
      const right = handedness === 'right';
      return [
        {
          ref: { kind: 'stock', index: 0 },
          column: right ? TABLEAU_COUNT - 1 : 0,
          row: 'top',
          recycle: false,
        },
        ...SUITS.map((suit, i) => ({
          ref: { kind: 'foundation', index: i } as PileRef,
          column: right ? i : TABLEAU_COUNT - FOUNDATION_COUNT + i,
          row: 'top' as const,
          ghost: suit,
        })),
        ...Array.from({ length: TABLEAU_COUNT }, (_, i) => ({
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

    deal,
    dealsFaceDown: true,

    piles(state: ScorpionState): PileCards[] {
      return [
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<ScorpionState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // No homeFor, for Spiderette's reason: a suit goes home finished or not
    // at all, so no single card ever belongs on a foundation.

    // Twelve cards face down at the deal and three in hand, and those two
    // numbers are the whole of what is not yet decided.
    view(state: ScorpionState): GameView {
      return { deck: state.stock.length, hidden: hiddenCards(state), stock: state.stock.length };
    },

    drops: true,
    showsMoves: true,

    dealOrigin(handedness: Handedness) {
      const right = handedness === 'right';
      return {
        x: columnCentre(right ? TABLEAU_COUNT - 1 : 0, WIDTH, TABLEAU_COUNT),
        y: TOP_ROW_Y,
      };
    },
  };
}
