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
  DrawCount,
  GameState,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDrop,
  deal,
  foundationIndexOf,
  hasWon,
  isDeadEnd,
  liftable,
} from './klondike';

// Klondike, as the board sees it: its rules behind one interface, and where
// its seven piles and its six slots are printed.
//
// The rules themselves are in klondike.ts and know nothing about any of this.
// What is here is the join between them and a screen - the part that would
// otherwise live in the scene and make the scene a Klondike scene.

// How far apart the cards of a draw-three waste sit, and which way.
//
// Downward by the amount that reveals an index, which is the same step a
// tableau pile fans by. It was a sideways fan of fifteen units once, which
// looked like a fan and told you nothing: a card is indexed in its top-left
// corner only, so a pile fanned to the left shows you the right-hand edges of
// the cards underneath.
//
// Upward out of the slot, so the newest card - the one you can play - is
// always in the same place, lined up with the stock beside it, and each card
// is covered by the one below it, which leaves its index in view.
const WASTE_FAN = CARD_PEEK_HEIGHT;
const WASTE_FANNED = 3;

// The top row: stock, waste, a gap, then the four foundations. The gap is a
// whole column and is deliberately empty - it is the room a court card's
// shoulder needs, and it keeps the waste from crowding the first foundation.
const STOCK_COLUMN = 0;
const WASTE_COLUMN = 1;
const FIRST_FOUNDATION_COLUMN = 3;

export function klondikeTable(drawCount: DrawCount): TableGame<GameState> {
  return {
    id: 'klondike',
    label: 'Solitaire',
    width: 480,
    columns: TABLEAU_COUNT,

    // The stock is tapped more than everything else on this board put
    // together - a draw-three game is mostly taps on it - so it goes under
    // the thumb of whichever hand is holding the phone, and the foundations
    // take the other end.
    slots(handedness: Handedness): PileSlot[] {
      const right = handedness === 'right';
      const column = (n: number) => (right ? TABLEAU_COUNT - 1 - n : n);
      const foundation = (i: number) =>
        right ? FOUNDATION_COUNT - 1 - i : FIRST_FOUNDATION_COLUMN + i;

      return [
        { ref: { kind: 'stock', index: 0 }, column: column(STOCK_COLUMN), row: 'top', recycle: true },
        { ref: { kind: 'waste', index: 0 }, column: column(WASTE_COLUMN), row: 'top' },
        ...SUITS.map((suit, i) => ({
          ref: { kind: 'foundation', index: i } as PileRef,
          column: foundation(i),
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
      if (ref.kind === 'tableau') {
        // A face-down card shows a sliver and a face-up one shows its index,
        // so the step depends on the card *above* the gap rather than on a
        // fixed pitch.
        if (index === 0) return 0;
        return cards[index - 1].faceUp ? CARD_PEEK_HEIGHT : CARD_BACK_PEEK_HEIGHT;
      }
      if (ref.kind === 'waste') {
        // Only the last few are fanned, and only in draw-three: in draw-one
        // there is one card to look at and a fan of one is a card that has
        // wandered off its slot.
        //
        // This is the gap *before* card `index`, not that card's distance
        // from the slot - the board adds the gaps up. Getting that backwards
        // is what made a draw of three look like a draw of two: the last two
        // cards came out with the same total and landed on each other.
        const fanned = drawCount === 3 ? Math.min(WASTE_FANNED, cards.length) : 1;
        const firstFanned = cards.length - fanned;
        return index > firstFanned ? WASTE_FAN : 0;
      }
      return 0;
    },

    fansUp(ref: PileRef): boolean {
      return ref.kind === 'waste';
    },

    deal: (random?: () => number) => deal(drawCount, random),
    dealsFaceDown: true,

    piles(state: GameState): PileCards[] {
      return [
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        { ref: { kind: 'waste', index: 0 }, cards: state.waste },
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<GameState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    homeFor: (card: Card): PileRef => ({ kind: 'foundation', index: foundationIndexOf(card.suit) }),

    view(state: GameState): GameView {
      return { score: state.score, stock: state.stock.length, waste: state.waste.length };
    },

    drops: true,
    showsMoves: true,

    dealOrigin(handedness: Handedness) {
      // Off the stock, which is where a hand of Klondike comes from.
      const column = handedness === 'right' ? TABLEAU_COUNT - 1 - STOCK_COLUMN : STOCK_COLUMN;
      return { x: columnCentre(column, 480, TABLEAU_COUNT), y: TOP_ROW_Y };
    },
  };
}
