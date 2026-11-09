import { CARD_HEIGHT } from './config';
import { Card } from './deck';
import { Move, PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameId, GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';

// The board for the squares games: a grid of printed cells and the card
// waiting to go into one. Poker Squares and Cribbage Squares differ in the
// size of the grid, where a card may go and how it is counted, and not at all
// in how the board is laid out or how a card is put down - so that part is
// written once, here.
//
// Press a cell and the card goes there; or carry it there, which is the same
// move made slower. Nothing else on the board moves, so there is nothing to
// flick, nothing to tap a card for, and nothing to take back: the next card
// is turned the moment this one lands, and an undo would be a look at it.

/** The shape both squares games keep their hand in. */
export interface SquaresState {
  // The grid, row by row. Each cell is empty or holds one card.
  tableau: Card[][];
  stock: Card[];
  // The card in hand.
  waste: Card[];
  moves: number;
}

export interface SquaresRules<S extends SquaresState> {
  id: GameId;
  label: string;
  // Cells along a side.
  size: number;
  target: number;
  deal(random?: () => number): S;
  liftable(state: S, from: PileRef, count: number): readonly Card[] | undefined;
  canDrop(state: S, cards: readonly Card[], to: PileRef): boolean;
  apply(state: S, move: Move): TableMoveResult<S> | undefined;
  placeAt(state: S, at: PileRef): Move | undefined;
  hasWon(state: S): boolean;
  isDeadEnd(state: S): boolean;
  score(state: S): number;
}

// Narrower than the 480 every column game is laid out on, which is the point:
// the board is fitted to the screen's width, so a few columns on a narrower
// table are bigger cards. Every card on the grid is part of every decision,
// and all of them have to be read at a glance.
const SIDE = 10;
const CELL_GAP = 16;
const ROW_GAP = 12;
// Five across in four hundred units; four across in proportion.
const widthFor = (size: number) => Math.round(2 * SIDE + size * (60 + CELL_GAP));

// The top edge of the grid: below the printed lettering, which sits at
// TABLEAU_TOP_Y - 23 on every board.
const GRID_TOP = 172;
const STOCK_OFFSET = 120;

export function squaresTable<S extends SquaresState>(rules: SquaresRules<S>): TableGame<S> {
  const { size } = rules;
  const width = widthFor(size);
  const pitchX = (width - 2 * SIDE) / size;
  const pitchY = CARD_HEIGHT + ROW_GAP;
  const cellX = (column: number) => SIDE + pitchX / 2 + column * pitchX;
  const cellY = (row: number) => GRID_TOP + CARD_HEIGHT / 2 + row * pitchY;
  // The card in hand, centred under the grid, with the deck it came off to
  // one side. Low on the board, where every turn starts.
  const handY = GRID_TOP + pitchY * size + 24 + CARD_HEIGHT / 2;
  const stockX = (handedness: Handedness) => width / 2 + (handedness === 'right' ? -STOCK_OFFSET : STOCK_OFFSET);

  return {
    id: rules.id,
    label: rules.label,
    width,
    columns: size,
    drops: false,
    // The same number every hand. Not a number anybody plays against.
    showsMoves: false,
    target: rules.target,
    undoable: false,

    slots(handedness: Handedness): PileSlot[] {
      return [
        ...Array.from({ length: size * size }, (_, i) => ({
          ref: { kind: 'tableau', index: i } as PileRef,
          column: i % size,
          row: 'tableau' as const,
          x: cellX(i % size),
          y: cellY(Math.floor(i / size)),
        })),
        { ref: { kind: 'waste', index: 0 }, column: 0, row: 'top', x: width / 2, y: handY },
        {
          // Away from the thumb: it is never pressed. It is only there to
          // say the card in hand came from somewhere.
          ref: { kind: 'stock', index: 0 },
          column: 0,
          row: 'top',
          x: stockX(handedness),
          y: handY,
          recycle: false,
        },
      ];
    },

    fanStep: () => 0,
    fansUp: () => false,

    deal: rules.deal,
    dealsFaceDown: false,

    piles(state: S): PileCards[] {
      return [
        ...state.tableau.map((cards, i) => ({ ref: { kind: 'tableau', index: i } as PileRef, cards })),
        { ref: { kind: 'stock', index: 0 }, cards: state.stock },
        { ref: { kind: 'waste', index: 0 }, cards: state.waste },
      ];
    },

    moveCount: (state) => state.moves,
    liftable: rules.liftable,
    canDrop: rules.canDrop,
    apply: rules.apply,
    // A tap on the card in hand has no answer: where it goes is the whole
    // game. A tap on the cell is the answer instead - see placeAt.
    autoTarget: () => undefined,
    placeAt: rules.placeAt,
    autoFinishMove: () => undefined,
    canAutoFinish: () => false,
    hasWon: rules.hasWon,
    isDeadEnd: rules.isDeadEnd,

    // The score so far, and how many cells are still to fill.
    view(state: S): GameView {
      return { score: rules.score(state), left: state.tableau.filter((cell) => !cell.length).length };
    },

    dealOrigin: (handedness: Handedness) => ({ x: stockX(handedness), y: handY }),
  };
}
