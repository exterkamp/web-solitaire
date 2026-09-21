// Telling a flick from a drag.
//
// Its own module, with no Phaser in it, for the same reason the rules are:
// this is arithmetic over a few numbers, it decides something the player will
// argue with, and it can be checked in a millisecond if it never has to be
// performed by a thumb.

/** Where the pointer was, and when. Board units, and browser milliseconds. */
export interface PointerSample {
  x: number;
  y: number;
  t: number;
}

// How fast upward counts as a throw, in board units per millisecond.
//
// The board is 720 units tall and fills most of a phone screen, so a unit is
// roughly two physical pixels and this is about a thousand pixels a second -
// the low end of what interface guidelines call a flick, and deliberately
// forgiving. Being too eager here is cheap: the card goes to its foundation,
// which is where a tap would have sent it anyway. Being too strict means a
// gesture that silently does nothing, which is the kind of thing people stop
// trying.
export const FLICK_SPEED = 0.55;

// How much of the gesture's end is measured. The tail, not the whole journey:
// a drag that crosses the board and parks over a pile is slow at the moment
// it is let go, and a flick is not - which is the entire difference between
// them, and it is invisible in an average taken over the whole gesture.
export const FLICK_WINDOW_MS = 140;

// How much straighter than sideways an upward gesture has to be. A card
// carried across the board and released while still moving is not a throw at
// the foundations, however quick it was.
const FLICK_STRAIGHTNESS = 1.2;

export interface Velocity {
  vx: number;
  vy: number;
}

/**
 * How fast the pointer was moving when it was let go.
 *
 * Timed by the browser's clock rather than the game's, which matters on a
 * struggling device: a velocity derived from frames says how fast the machine
 * is drawing, and this needs to know how fast the thumb was moving.
 */
export function pointerVelocity(
  samples: readonly PointerSample[],
  end: PointerSample,
): Velocity {
  // The oldest sample still inside the window, which is the one that makes
  // the longest measurement of the gesture's tail. Falling back to the newest
  // sample means a gesture with nothing in the window measures zero rather
  // than measuring the whole drag.
  const from = samples.find((sample) => end.t - sample.t <= FLICK_WINDOW_MS)
    ?? samples[samples.length - 1];
  if (!from) return { vx: 0, vy: 0 };

  const dt = end.t - from.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (end.x - from.x) / dt, vy: (end.y - from.y) / dt };
}

/** Whether that was a throw toward the top of the board. */
export function isUpwardFlick({ vx, vy }: Velocity): boolean {
  // Up is negative: the board's origin is its top-left corner.
  if (vy > -FLICK_SPEED) return false;
  return Math.abs(vy) > Math.abs(vx) * FLICK_STRAIGHTNESS;
}
