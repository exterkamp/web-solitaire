import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { FELT_CLEAR_COLOR } from './table';
import { BoardInit, SolitaireScene } from './solitaire-scene';

// The name the scene is registered under, and the only string either side of
// this boundary has to agree on.
export const BOARD_SCENE = 'solitaire';

// The canvas the board is drawn on.
export function createBoardGame(parent: HTMLElement, init: BoardInit): Phaser.Game {
  // Phaser has no built-in HiDPI canvas support (the old `resolution` config
  // was removed years ago): a canvas rasterized at GAME_WIDTH x GAME_HEIGHT
  // and then CSS-stretched to fill a high-density phone screen looks soft.
  // Instead the canvas is rasterized at devicePixelRatio x the logical size,
  // and the scene scales its root container by the same factor so world
  // coordinates - every card position in the game - stay in the original
  // 480x900 unit system untouched; only pixel density goes up.
  const pixelRatio = window.devicePixelRatio || 1;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH * pixelRatio,
    height: GAME_HEIGHT * pixelRatio,
    backgroundColor: FELT_CLEAR_COLOR,
    scale: {
      mode: Phaser.Scale.FIT,
      // Centred by the page, not by Phaser. autoCenter sets a margin on the
      // canvas equal to half the room left over in its parent - which, in a
      // parent that is already centring its child, is added to the centring
      // the page has done and puts the board half a gap off to the right.
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    // Let Phaser preventDefault the touches it handles, so a fast flick isn't
    // also delivered to the browser as a navigation gesture. windowEvents
    // stays on: without it a drag released outside the canvas never fires its
    // end event and the card sticks to the pointer.
    input: {
      touch: { capture: true },
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
