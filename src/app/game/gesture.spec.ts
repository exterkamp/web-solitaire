import { describe, expect, it } from 'vitest';
import {
  FLICK_SPEED,
  FLICK_WINDOW_MS,
  PointerSample,
  isUpwardFlick,
  pointerVelocity,
} from './gesture';

// A gesture as a list of places the pointer was, `step` milliseconds apart.
// Written this way because that is what a gesture is - the maths below only
// ever sees where a thumb was and when.
function gesture(points: [number, number][], step = 20): PointerSample[] {
  return points.map(([x, y], i) => ({ x, y, t: 1000 + i * step }));
}

function end(samples: PointerSample[], point: [number, number], after = 20): PointerSample {
  return { x: point[0], y: point[1], t: samples[samples.length - 1].t + after };
}

describe('pointer velocity', () => {
  it('measures the tail of a gesture, not the whole of it', () => {
    // Slowly across the board, then let go while still moving slowly. The
    // long journey must not make this look fast.
    const samples = gesture([[100, 500], [100, 460], [100, 430], [100, 420]], 120);
    const { vy } = pointerVelocity(samples, end(samples, [100, 415], 120));
    expect(Math.abs(vy)).toBeLessThan(FLICK_SPEED);
  });

  it('answers nothing for a pointer that never moved', () => {
    const samples = gesture([[100, 500]]);
    expect(pointerVelocity(samples, end(samples, [100, 500]))).toEqual({ vx: 0, vy: 0 });
  });

  it('answers nothing when the clock has not advanced', () => {
    // Two events stamped the same millisecond, which browsers do. Dividing by
    // that gap is how a gesture comes out infinitely fast.
    const samples: PointerSample[] = [{ x: 100, y: 500, t: 1000 }];
    expect(pointerVelocity(samples, { x: 100, y: 100, t: 1000 })).toEqual({ vx: 0, vy: 0 });
  });

  it('survives having no samples at all', () => {
    expect(pointerVelocity([], { x: 0, y: 0, t: 5 })).toEqual({ vx: 0, vy: 0 });
  });

  it('ignores samples older than the window', () => {
    // One ancient sample and two recent ones. Measured from the ancient one,
    // this gesture is slow; measured from inside the window, it is a throw.
    const samples: PointerSample[] = [
      { x: 100, y: 520, t: 0 },
      { x: 100, y: 500, t: 1000 },
      { x: 100, y: 440, t: 1040 },
    ];
    const { vy } = pointerVelocity(samples, { x: 100, y: 380, t: 1080 });
    expect(vy).toBeCloseTo((380 - 500) / 80, 5);
    expect(vy).toBeLessThan(-FLICK_SPEED);
  });

  it('measures from the oldest sample still inside the window', () => {
    const samples: PointerSample[] = [
      { x: 100, y: 500, t: 1000 },
      { x: 100, y: 450, t: 1000 + FLICK_WINDOW_MS - 10 },
    ];
    const { vy } = pointerVelocity(samples, { x: 100, y: 400, t: 1000 + FLICK_WINDOW_MS });
    expect(vy).toBeCloseTo((400 - 500) / FLICK_WINDOW_MS, 5);
  });
});

describe('what counts as a flick', () => {
  it('takes a quick throw up the board', () => {
    expect(isUpwardFlick({ vx: 0, vy: -1.2 })).toBe(true);
  });

  it('refuses a slow drag in the same direction', () => {
    expect(isUpwardFlick({ vx: 0, vy: -0.2 })).toBe(false);
  });

  it('refuses a throw downward, however fast', () => {
    // Nothing is below the tableau, so a flick down means nothing - and
    // sending a card home for a gesture pointing away from home would be the
    // most confusing possible reading of it.
    expect(isUpwardFlick({ vx: 0, vy: 3 })).toBe(false);
  });

  it('refuses a card carried sideways at speed', () => {
    expect(isUpwardFlick({ vx: -3, vy: -1 })).toBe(false);
  });

  it('allows a throw that leans, but not one that is mostly sideways', () => {
    expect(isUpwardFlick({ vx: 0.6, vy: -1.2 })).toBe(true);
    expect(isUpwardFlick({ vx: 1.2, vy: -1.2 })).toBe(false);
  });

  it('counts the threshold itself as a flick', () => {
    expect(isUpwardFlick({ vx: 0, vy: -FLICK_SPEED })).toBe(true);
    expect(isUpwardFlick({ vx: 0, vy: -FLICK_SPEED + 0.001 })).toBe(false);
  });
});
