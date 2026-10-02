import { describe, expect, it } from 'vitest';
import { CARD_WIDTH } from './config';
import {
  NERTZ_HEIGHT, NERTZ_WIDTH, cardSpot, foundationZone, handSpot, overlap, workBase, workColumns, workIndices,
  workZone,
} from './nertz-layout';
import { SEATS } from './nertz';

describe.each([4, 5, 6])('layout with %i work piles', (n) => {
  const zones = (seat: 0 | 1, count = 1) => workIndices(n).map((i) => workZone(seat, i, count, n));

  it('keeps the four-column layout for four', () => {
    if (n === 4) expect(workColumns(4)).toEqual([75, 185, 295, 405]);
  });

  it('keeps every column on the board', () => {
    for (const x of workColumns(n)) {
      expect(x - CARD_WIDTH / 2).toBeGreaterThanOrEqual(0);
      expect(x + CARD_WIDTH / 2).toBeLessThanOrEqual(NERTZ_WIDTH);
    }
  });

  it('does not put work piles on each other, the foundations or the hand row', () => {
    for (const seat of SEATS) {
      const z = zones(seat, 8);
      for (let i = 0; i < z.length; i++) {
        for (let j = i + 1; j < z.length; j++) expect(overlap(z[i], z[j])).toBe(0);
        for (let f = 0; f < 8; f++) expect(overlap(z[i], foundationZone(f))).toBe(0);
        for (const kind of ['nertz', 'waste', 'stock'] as const) {
          const at = handSpot(seat, kind);
          const hand = { x: at.x - CARD_WIDTH / 2, y: at.y - 45, width: CARD_WIDTH, height: 90 };
          expect(overlap(z[i], hand)).toBe(0);
        }
      }
    }
    // And the two players' piles stay out of each other's way.
    for (const a of zones(0, 8)) for (const b of zones(1, 8)) expect(overlap(a, b)).toBe(0);
  });

  it('seats the second player as a half-turn of the first', () => {
    for (const i of workIndices(n)) {
      const a = workBase(0, i, n);
      const b = workBase(1, i, n);
      expect(b.x).toBeCloseTo(NERTZ_WIDTH - a.x);
      expect(b.y).toBeCloseTo(NERTZ_HEIGHT - a.y);
      const c = cardSpot(0, { kind: 'work', index: i }, 3, 5, n);
      const d = cardSpot(1, { kind: 'work', index: i }, 3, 5, n);
      expect(d.x).toBeCloseTo(NERTZ_WIDTH - c.x);
      expect(d.y).toBeCloseTo(NERTZ_HEIGHT - c.y);
    }
  });
});
