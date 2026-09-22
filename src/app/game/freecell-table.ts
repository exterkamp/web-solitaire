import { CARD_PEEK_HEIGHT, COLUMN_PITCH, SUITS } from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import {
  CELL_COUNT,
  COLUMN_COUNT,
  FreeCellState,
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
} from './freecell';
import { foundationIndexOf } from './card-rules';

// FreeCell, as the board sees it.
//
// The board is eight columns rather than seven, and that is the one thing
// here with a consequence elsewhere: eight cards of the same size need a
// wider table. Rather than shrink the cards - which would mean new corner
// measurements, a new court crop, and a second set of everything in
// card-sprite.ts - the board itself gets wider by one column and Phaser fits
// it to the screen as it does anything else. The cards come out about a
// tenth smaller on a phone and are drawn from exactly the same textures.
const WIDTH = Math.round(COLUMN_PITCH * COLUMN_COUNT + 20);

export function freecellTable(): TableGame<FreeCellState> {
  return {
    id: 'freecell',
    label: 'FreeCell',
    width: WIDTH,
    columns: COLUMN_COUNT,

    // Cells on the left, foundations on the right, which is where FreeCell
    // has always put them.
    //
    // Handedness is ignored here, and that is not an oversight: it exists to
    // put the pile you press constantly under your thumb, and this game has
    // no such pile. Every move is a card going somewhere specific.
    slots(_handedness: Handedness): PileSlot[] {
      return [
        ...Array.from({ length: CELL_COUNT }, (_, i) => ({
          ref: { kind: 'cell', index: i } as PileRef,
          column: i,
          row: 'top' as const,
        })),
        ...SUITS.map((suit, i) => ({
          ref: { kind: 'foundation', index: i } as PileRef,
          column: COLUMN_COUNT - SUITS.length + i,
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

    // Every card in this game is face up from the first move, so every gap
    // down a column is an index's worth. There is no equivalent of Klondike's
    // sliver of a face-down card, and no pile here fans but the tableau: a
    // cell holds one card and a foundation is a stack you never read.
    fanStep(ref: PileRef, _cards: readonly Card[], index: number): number {
      if (ref.kind !== 'tableau') return 0;
      return index === 0 ? 0 : CARD_PEEK_HEIGHT;
    },

    fansUp: () => false,

    deal,
    // Nothing is hidden in this game, not even for the length of a deal.
    dealsFaceDown: false,

    piles(state: FreeCellState): PileCards[] {
      return [
        ...state.cells.map((cards, i) => ({ ref: { kind: 'cell', index: i } as PileRef, cards })),
        ...state.foundations.map((cards, i) => ({ ref: { kind: 'foundation', index: i } as PileRef, cards })),
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
      ];
    },

    moveCount: (state) => state.moves,
    liftable,
    canDrop,
    apply: (state, move: Move): TableMoveResult<FreeCellState> | undefined => {
      // A game with no deck, handed a move that turns one. Answering
      // "undefined" is the same thing this says about any other move it does
      // not have.
      if (move.kind !== 'play') return undefined;
      return apply(state, move);
    },
    autoTarget,
    autoFinishMove,
    canAutoFinish,
    hasWon,
    isDeadEnd,
    homeFor: (card: Card): PileRef => ({ kind: 'foundation', index: foundationIndexOf(card.suit) }),

    // No score. FreeCell has never had one and inventing a number for it
    // would be inventing a way to play it badly. What the board shows instead
    // is how many cells are still free, which is the thing a player actually
    // watches - it is the whole of your room to manoeuvre, and the game is
    // usually lost some moves before you notice it reached zero.
    view(state: FreeCellState): GameView {
      return { free: freeCells(state) };
    },

    // Out of the middle of the top row: there is no stock to deal from, so
    // the cards arrive from the dealer's hand rather than off a pile.
    dealOrigin() {
      return { column: (COLUMN_COUNT - 1) / 2, row: 'top' as const };
    },
  };
}
