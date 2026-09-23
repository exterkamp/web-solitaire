import {
  CARD_BACK_PEEK_HEIGHT,
  CARD_PEEK_HEIGHT,
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
// Seven columns of seven and nothing else - the only board here with no
// foundations printed on it, because this game never sends a card anywhere.
// The four suits are assembled in the columns and left lying there, so the
// fans start deep and end deeper: a finished column is thirteen cards long
// and the board's fan squeezing does more work here than anywhere else.
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
    // No homeFor, and nothing to give it: there are no foundations on this
    // board at all.

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
