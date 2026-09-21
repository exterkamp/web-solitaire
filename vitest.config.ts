import { defineConfig } from 'vitest/config';

// The rules are tested; the board is not.
//
// Everything under src/app/game that ends in .spec.ts is a pure-TypeScript
// test of the Klondike rules - no Angular, no Phaser, no DOM. That is the
// half of this game worth testing automatically: whether a run of cards may
// move onto a king is a fact about the game, while whether the card looks
// right while it flies there is a fact about the screen, and only one of
// those can be checked without eyes.
//
// So vitest runs directly rather than through `ng test`. The Angular test
// builder exists to stand components up in a browser-like environment, which
// nothing here needs.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
