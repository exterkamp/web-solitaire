import { CARD_PEEK_HEIGHT, TOP_ROW_Y, columnCentre } from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  CalculationState,
  FOUNDATION_COUNT,
  PILE_COUNT,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDrop,
  cardsLeft,
  deal,
  foundationFor,
  hasWon,
  isDeadEnd,
  liftable,
} from './calculation';

const WIDTH = 480;
// Six across the top: the four foundations, the card turned, and the deck.
const COLUMNS = 6;

// Calculation, as the board sees it.
//
// The foundations always read one, two, three, four from the left, whichever
// hand the phone is in - they are the times tables this game is played
// against, and they should read like one. What moves with the hand is the
// deck and the card it turns, which are pressed and dragged from on every
// move and belong under the thumb.
//
// The four discard piles sit evenly across the full width below rather than
// under particular foundations, because they do not belong to any: a card on
// any of them can go up to any foundation. Further apart than the columns
// above, which leaves each one a wide target to drop the turned card on.
export function calculationTable(): TableGame<CalculationState> {
  return {
    id: 'calculation',
    label: 'Calculation',
    width: WIDTH,
    columns: COLUMNS,

    slots(handedness: Handedness): PileSlot[] {
      const right = handedness === 'right';
      const first = right ? 0 : 2;
      return [
        ...Array.from({ length: FOUNDATION_COUNT }, (_, i) => ({
          ref: { kind: 'foundation', index: i } as PileRef,
          column: first + i,
          row: 'top' as const,
        })),
        { ref: { kind: 'waste', index: 0 }, column: right ? 4 : 1, row: 'top' },
        { ref: { kind: 'stock', index: 0 }, column: right ? 5 : 0, row: 'top', recycle: false },
        ...Array.from({ length: PILE_COUNT }, (_, i) => ({
          ref: { kind: 'tableau', index: i } as PileRef,
          // Four spread over six columns' room: a column and a half apart.
          column: ((i + 0.5) * COLUMNS) / PILE_COUNT - 0.5,
          row: 'tableau' as const,
        })),
      ];
    },

    // A discard pile fans so every card in it can be read: what is under
    // what is the thing you are planning around.
    fanStep(ref: PileRef, _cards: readonly Card[], index: number): number {
      return ref.kind === 'tableau' && index > 0 ? CARD_PEEK_HEIGHT : 0;
    },

    fansUp: () => false,

    deal,
    dealsFaceDown: false,

    piles(state: CalculationState): PileCards[] {
      return [
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        { ref: { kind: 'waste', index: 0 }, cards: state.waste },
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<CalculationState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    // A flick goes to whichever foundation is counting to the card's rank;
    // the board checks it will take the card before it throws.
    homeFor: (card: Card, state: CalculationState): PileRef =>
      foundationFor(state, card) ?? { kind: 'foundation', index: 0 },

    // How many cards are still to go up, and how many are left to turn.
    view(state: CalculationState): GameView {
      return { left: cardsLeft(state), deck: state.stock.length, stock: state.stock.length };
    },

    drops: true,
    showsMoves: true,

    dealOrigin(handedness: Handedness) {
      return { x: columnCentre(handedness === 'right' ? 5 : 0, WIDTH, COLUMNS), y: TOP_ROW_Y };
    },
  };
}
