// A promise that keeps until the first board has finished loading.
//
// This exists for one reason, and it is a timing problem rather than a game
// one: a freshly installed service worker answers no request at all until it
// has finished caching everything it was told to prefetch. That is ngsw's
// documented behaviour and it is the right one - a half-populated cache is
// worse than none - but it means whatever the page asks for during that
// window waits for a couple of megabytes of card art to be written to disk
// first.
//
// On a first visit that window landed exactly on the first deal: the worker
// took control, the board asked for its seventeen images, and every one of
// them hung until the cache was full. On a slow machine that was half a
// minute of empty felt.
//
// So registration waits for this. The board loads over the network like any
// other page, and the worker installs afterwards, by which time everything it
// wants to cache is already in the browser's own HTTP cache and the copy is
// nearly free. See app.config.ts.
let dealt: (() => void) | undefined;

export const firstBoard = new Promise<void>((resolve) => {
  dealt = resolve;
});

/** Called by the scene once its art has loaded and a hand is on the table. */
export function firstBoardDealt(): void {
  dealt?.();
  dealt = undefined;
}
