import {
  CARD_BACK_PEEK_HEIGHT,
  CARD_PEEK_HEIGHT,
  FOUNDATION_COUNT,
  SUITS,
  TABLEAU_COUNT,
} from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import { foundationIndexOf } from './card-rules';
import {
  YukonState,
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
} from './yukon';

// Yukon, as the board sees it.
//
// The cheapest game to add so far, and that is the point of it: seven columns
// at Klondike's width, the same fans, the same kings-only empty columns. What
// it does not have is a stock, a waste, or any reason to turn anything - so
// the top row is four foundations and three columns of bare felt, and the
// board never asks it to draw.
export function yukonTable(): TableGame<YukonState> {
  return {
    id: 'yukon',
    label: 'Yukon',
    width: 480,
    columns: TABLEAU_COUNT,

    // Foundations under the thumb of whichever hand is holding the phone.
    //
    // Klondike puts the stock there because the stock is what gets pressed;
    // here nothing is pressed repeatedly, so the row goes to the pile you
    // aim at instead. Everything ends up on a foundation eventually.
    slots(handedness: Handedness): PileSlot[] {
      const right = handedness === 'right';
      return [
        ...SUITS.map((suit, i) => ({
          ref: { kind: 'foundation', index: i } as PileRef,
          column: right ? TABLEAU_COUNT - FOUNDATION_COUNT + i : i,
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

    // The same fan Klondike uses, for the same reason: a face-down card shows
    // a sliver and a face-up one shows its index, so the gap depends on the
    // card above it. Columns here run longer than Klondike's - eleven at the
    // deal and more once you start piling - and the board squeezes the fan
    // when one outgrows its room. See fanOffsets in solitaire-scene.ts.
    fanStep(ref: PileRef, cards: readonly Card[], index: number): number {
      if (ref.kind !== 'tableau' || index === 0) return 0;
      return cards[index - 1].faceUp ? CARD_PEEK_HEIGHT : CARD_BACK_PEEK_HEIGHT;
    },

    fansUp: () => false,

    deal,
    dealsFaceDown: true,

    piles(state: YukonState): PileCards[] {
      return [
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<YukonState> | undefined => apply(state, move),
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    homeFor: (card: Card): PileRef => ({ kind: 'foundation', index: foundationIndexOf(card.suit) }),

    // No score - Yukon has never had one - and no stock to count. What it has
    // instead is how many cards are still face down, which is the only number
    // in the game that measures progress: twenty-one at the deal, nothing at
    // the end, and every one of them turned by a move you found.
    view(state: YukonState): GameView {
      return { hidden: hiddenCards(state) };
    },

    // Out of the middle of the top row. There is no stock to deal from, and
    // the foundations are somebody's destination rather than a dealer's hand.
    dealOrigin() {
      return { column: (TABLEAU_COUNT - 1) / 2, row: 'top' as const };
    },
  };
}
