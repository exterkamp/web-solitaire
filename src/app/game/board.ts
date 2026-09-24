import Phaser from 'phaser';
import { createBoard } from 'phaser-card-engine/phaser';
import { GAME_HEIGHT } from './config';
import { FELT_CLEAR_COLOR } from './table';
import { BoardInit, SolitaireScene } from './solitaire-scene';

// The name the scene is registered under, and the only string either side of
// this boundary has to agree on.
export const BOARD_SCENE = 'solitaire';

// The canvas the board is drawn on.
export function createBoardGame(parent: HTMLElement, init: BoardInit): Phaser.Game {
  // As wide as the game being dealt. Seven columns fit in 480 units and eight
  // do not, so FreeCell brings a wider table rather than smaller cards - see
  // freecell-table.ts.
  //
  // The HiDPI arrangement is the package's: Phaser has no built-in support
  // for it, so the canvas is rasterised at devicePixelRatio times the logical
  // size and the scene scales its root container back by the same factor.
  // Every card position in the game stays in the original 480-unit system;
  // only pixel density goes up.
  const game = createBoard({
    parent,
    width: init.table.width,
    height: GAME_HEIGHT,
    backgroundColor: FELT_CLEAR_COLOR,
  });

  // Added rather than listed in the config above, because the scene needs its
  // settings - which deck, which hand, how many cards a draw turns - and a
  // scene in the config is started by the engine with nothing to go on.
  game.scene.add(BOARD_SCENE, SolitaireScene, true, init);

  // The handle a console session drives the board through, and the only way
  // to reach it from outside the page.
  (window as unknown as { __game?: Phaser.Game }).__game = game;
  return game;
}
