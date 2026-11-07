import { BoardInit, SolitaireScene } from './solitaire-scene';
import { NertzInit, NertzScene } from './nertz-scene';
import { markBooting } from './lite';

// The canvas the board is drawn on.
//
// As wide as the game being dealt. Seven columns fit in 480 units and eight
// do not, so FreeCell brings a wider table rather than smaller cards - see
// freecell-table.ts. felt draws at renderScale() - devicePixelRatio, or 1 in
// lite mode - and every position in the game stays in the 480-unit system;
// only pixel density goes up.
//
// If this page is killed before the board has been up for a few seconds, the
// next load is lite - see lite.ts.
export function createBoardGame(parent: HTMLElement, init: BoardInit): SolitaireScene {
  markBooting();
  const board = new SolitaireScene(parent, init);
  // The handle a console session drives the board through, and the only way
  // to reach it from outside the page.
  (window as unknown as { __game?: unknown }).__game = board;
  return board;
}

/**
 * The two-player Nertz table. Its own board: the one above is built around
 * one hand and one pointer, and this one has two of each. Same felt, same
 * cards, same density.
 */
export function createNertzGame(parent: HTMLElement, init: NertzInit): NertzScene {
  markBooting();
  const board = new NertzScene(parent, init);
  (window as unknown as { __game?: unknown }).__game = board;
  return board;
}
