import {
  CARD_PEEK_HEIGHT,
  TOP_ROW_Y,
  columnCentre,
} from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  AcesUpState,
  COLUMN_COUNT,
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
} from './acesup';

// The same 480 the seven-column games use, with four columns laid across it.
//
// A narrower table would make the cards bigger, and was tried: at four
// columns' worth of width the board is taller than it is wide by more than a
// phone is, so Phaser fits it by height instead and the cards come out
// smaller than they started, with bare felt down both sides. The width is set
// by the screen, not by the number of piles standing on it.
const WIDTH = 480;

// Aces Up, as the board sees it.
//
// Four columns, a deck and a heap - the shortest layout here, and the only
// one where the piles are further apart than a card is wide. That spacing is
// what the game does with the room rather than a failure to fill it: four
// piles, four big targets, and a hand you can play with one thumb while
// standing up.
export function acesUpTable(): TableGame<AcesUpState> {
  return {
    id: 'acesup',
    label: 'Aces Up',
    width: WIDTH,
    columns: COLUMN_COUNT,

    slots(handedness: Handedness): PileSlot[] {
      // The deck under the thumb holding the phone, and the heap at the far
      // end. The deck is pressed thirteen times a hand and the heap is only
      // ever landed on, so they want opposite corners.
      const right = handedness === 'right';
      return [
        {
          ref: { kind: 'stock', index: 0 },
          column: right ? COLUMN_COUNT - 1 : 0,
          row: 'top',
          // Nothing comes back. Four cards at a time until there are none.
          recycle: false,
        },
        {
          ref: { kind: 'foundation', index: 0 },
          column: right ? 0 : COLUMN_COUNT - 1,
          row: 'top',
        },
        ...Array.from({ length: COLUMN_COUNT }, (_, i) => ({
          ref: { kind: 'tableau', index: i } as PileRef,
          column: i,
          row: 'tableau' as const,
        })),
      ];
    },

    // Every card in a column is face up, and a column can reach thirteen
    // cards if nothing is ever thrown away - which is exactly the hand where
    // you need to read all of them.
    fanStep(ref: PileRef, _cards: readonly Card[], index: number): number {
      return ref.kind === 'tableau' && index > 0 ? CARD_PEEK_HEIGHT : 0;
    },

    fansUp: () => false,

    deal,
    dealsFaceDown: false,

    piles(state: AcesUpState): PileCards[] {
      return [
        { ref: { kind: 'foundation', index: 0 }, cards: state.discard },
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<AcesUpState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // A flick throws a card on the heap, if something of its suit beats it.
    // The board checks that before it accepts the throw, so a card nothing
    // beats simply lands where it was let go.
    homeFor: (): PileRef => ({ kind: 'foundation', index: 0 }),

    // How many cards are still on the table, counting down towards the four
    // that win, and how many are left to come. There is no score: this game
    // is won or it is not, and it usually is not.
    view(state: AcesUpState): GameView {
      return { left: cardsLeft(state), deck: state.stock.length, stock: state.stock.length };
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
