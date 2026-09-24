// One card, and a deck of them.
//
// Moved into phaser-card-engine. The shapes are unchanged, down to the card
// ids: `spades-K` rather than a counter, which is what makes a failing test
// say which card went wrong - and which means a game saved before this change
// still loads.
//
// `faceUp` stays part of the card rather than of the pile holding it, because
// in Klondike it is genuinely per-card: a tableau pile is some number of
// face-down cards with some number of face-up ones on top, and the boundary
// between them moves as the pile is played off.
//
// The one thing that changed is `shuffle`, which no longer copies each card
// on its way through - it copies the array, like any other shuffle. Every
// caller here passed a freshly built deck, so there was nothing to protect -
// and every one of them says `shuffledDeck(random)` now, which is the same
// two calls with the seam taken out.
export { buildDeck, cardName, shuffle, shuffledDeck } from 'phaser-card-engine';
export type { Card } from 'phaser-card-engine';
