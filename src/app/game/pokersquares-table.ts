import { squaresTable } from './squares-table';
import { TableGame } from './table-game';
import {
  PokerSquaresState,
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
} from './pokersquares';

// Poker Squares, as the board sees it: twenty-five cells and the card in
// hand. See squares-table.ts, which it shares with Cribbage Squares.
export function pokerSquaresTable(): TableGame<PokerSquaresState> {
  return squaresTable({
    id: 'pokersquares',
    label: 'Poker Squares',
    size: SIZE,
    target: TARGET,
    deal, liftable, canDrop, apply, placeAt, hasWon, isDeadEnd, score,
  });
}
