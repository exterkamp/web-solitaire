import { squaresTable } from './squares-table';
import { TableGame } from './table-game';
import {
  CribbageSquaresState,
  SIZE,
  TARGET,
  apply,
  canDrop,
  deal,
  hasWon,
  isDeadEnd,
  liftable,
  placeAt,
  score,
} from './cribbagesquares';

// Cribbage Squares, as the board sees it: sixteen cells and the card in hand,
// which once the grid is full is the starter. See squares-table.ts.
export function cribbageSquaresTable(): TableGame<CribbageSquaresState> {
  return squaresTable({
    id: 'cribbagesquares',
    label: 'Cribbage Squares',
    size: SIZE,
    target: TARGET,
    deal, liftable, canDrop, apply, placeAt, hasWon, isDeadEnd, score,
  });
}
