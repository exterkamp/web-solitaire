import { describe, expect, it } from 'vitest';
import { FLICK_SPEED } from './gesture';
import { NERTZ_FLICK_SPEED, isMiddleFlick } from './nertz-gesture';

const fast = NERTZ_FLICK_SPEED * 1.5;

describe('a flick toward the middle of the Nertz table', () => {
  it('is up the screen for the bottom player', () => {
    expect(isMiddleFlick({ vx: 0, vy: -fast }, 0)).toBe(true);
    expect(isMiddleFlick({ vx: 0, vy: fast }, 0)).toBe(false);
  });

  it('is down the screen for the top player', () => {
    expect(isMiddleFlick({ vx: 0, vy: fast }, 1)).toBe(true);
    expect(isMiddleFlick({ vx: 0, vy: -fast }, 1)).toBe(false);
  });

  it('is not a slow drag', () => {
    expect(isMiddleFlick({ vx: 0, vy: -NERTZ_FLICK_SPEED * 0.9 }, 0)).toBe(false);
    expect(isMiddleFlick({ vx: 0, vy: NERTZ_FLICK_SPEED * 0.9 }, 1)).toBe(false);
  });

  it('is not a mostly sideways gesture', () => {
    expect(isMiddleFlick({ vx: fast * 2, vy: -fast }, 0)).toBe(false);
    expect(isMiddleFlick({ vx: -fast * 2, vy: fast }, 1)).toBe(false);
  });

  it('asks for more than the single-player board does, since the board is taller', () => {
    expect(NERTZ_FLICK_SPEED).toBeGreaterThan(FLICK_SPEED);
  });
});
