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
  SpideretteState,
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
} from './spiderette';

const WIDTH = 480;

// Spiderette, as the board sees it.
//
// Klondike's seven columns and Klondike's fans, with the waste taken out of
// the top row: there is nowhere for a single card to be turned to, because
// the deck deals a whole row at once. The four foundations are there to hold
// finished suits and are never aimed at, which is why nothing here answers
// homeFor - a flick would be a gesture with nothing to do.
export function spideretteTable(): TableGame<SpideretteState> {
  return {
    id: 'spiderette',
    label: 'Spiderette',
    width: WIDTH,
    columns: TABLEAU_COUNT,

    slots(handedness: Handedness): PileSlot[] {
      // The deck under the thumb holding the phone. It is pressed more often
      // here than in Klondike - four times a game, but each press changes
      // every column, so it is the press worth reaching.
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

    piles(state: SpideretteState): PileCards[] {
      return [
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<SpideretteState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // No homeFor. A suit goes home finished or not at all, so there is no
    // such thing here as a card that belongs on a foundation right now.

    // Two numbers, and between them they are the whole state of a hand: how
    // many rows the deck can still deal, and how much of the table you have
    // not seen. Neither is a score, because this game has never had one.
    view(state: SpideretteState): GameView {
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
