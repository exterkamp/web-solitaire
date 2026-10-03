import { FLICK_SPEED, Velocity, isVerticalFlick } from './gesture';
import { NERTZ_HEIGHT } from './nertz-layout';
import { Seat } from './nertz';

// The same throw as gesture.ts, on the other board, for either seat.
//
// FLICK_SPEED is tuned for a board 720 units tall. This one is 900 and still
// has to fit the same screen, so a unit is smaller and the same thumb covers
// more of them per millisecond: the threshold grows with the height so it
// asks for the same physical speed.
const SINGLE_PLAYER_HEIGHT = 720;
export const NERTZ_FLICK_SPEED = FLICK_SPEED * (NERTZ_HEIGHT / SINGLE_PLAYER_HEIGHT);

/**
 * Whether that was a throw toward the middle of the table, which is where the
 * foundations are. Seat 0 sits at the bottom of the board and throws up the
 * screen; seat 1 sits at the top, and throws down it.
 */
export function isMiddleFlick(velocity: Velocity, seat: Seat): boolean {
  return isVerticalFlick(velocity, seat === 0 ? -1 : 1, NERTZ_FLICK_SPEED);
}
