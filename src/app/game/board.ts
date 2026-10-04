import Phaser from 'phaser';
import { createBoard } from 'phaser-card-engine/phaser';
import { boardHeight } from './config';
import { FELT_CLEAR_COLOR } from './table';
import { BoardInit, SolitaireScene } from './solitaire-scene';
import { NERTZ_SCENE, NertzInit, NertzScene } from './nertz-scene';
import { markBooted, markBooting, renderScale } from './lite';
import { NERTZ_HEIGHT, NERTZ_WIDTH } from './nertz-layout';

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
  // for it, so the canvas is rasterised at renderScale() - devicePixelRatio, or 1 in lite
  // mode - times the logical size and the scene scales its root container back by the same factor.
  // Every card position in the game stays in the original 480-unit system;
  // only pixel density goes up.
  // If this page is killed before the board has been up for a few seconds, the
  // next load is lite - see lite.ts.
  markBooting();
  const game = createBoard({
    parent,
    width: init.table.width,
    // Scaled to the game's own width rather than the fixed GAME_HEIGHT - see
    // boardHeight's own note on why a wider game needs a taller canvas to
    // reach the same container edges a 480-wide one already does.
    height: boardHeight(init.table.width),
    backgroundColor: FELT_CLEAR_COLOR,
    pixelRatio: renderScale(),
    // Matter, for the one thing on this board that is a physical object
    // rather than a card: the score's chip stack (see chip.ts). Bounds are
    // set per-game once the scene knows its own width, not here - a fixed
    // world size here would be wrong for every table but Klondike's.
    // Sleeping so a settled pile of chips stops costing anything once it has
    // - the same handful of bodies otherwise gets re-simulated every frame
    // for the rest of the hand.
    config: {
      physics: { default: 'matter', matter: { gravity: { x: 0, y: 1 }, enableSleeping: true } },
    },
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

/**
 * The two-player Nertz table. Its own canvas and its own scene: the board
 * above is built around one hand and one pointer, and this one has two of
 * each. Same felt, same cards, same HiDPI arrangement.
 */
export function createNertzGame(parent: HTMLElement, init: NertzInit): Phaser.Game {
  markBooting();
  const game = createBoard({
    parent,
    width: NERTZ_WIDTH,
    height: NERTZ_HEIGHT,
    backgroundColor: FELT_CLEAR_COLOR,
    pixelRatio: renderScale(),
  });
  game.scene.add(NERTZ_SCENE, NertzScene, true, init);
  (window as unknown as { __game?: Phaser.Game }).__game = game;
  return game;
}
