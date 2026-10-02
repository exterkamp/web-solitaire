import { CARD_HEIGHT, CARD_PEEK_HEIGHT, CARD_WIDTH } from './config';
import { DEFAULT_WORK_PILES, FOUNDATIONS, NertzPile, Seat } from './nertz';

// Where everything sits on a Nertz table for two, in board units.
//
// Written out for the player at the bottom and mirrored for the one at the
// top, so there is exactly one description of a player's half and the other
// is that description turned half a turn - which is what sitting on the other
// side of a table is. A point at (x, y) for seat 0 is at (WIDTH - x,
// HEIGHT - y) for seat 1, and a card there is upside down.
//
// Pure arithmetic with no Phaser in it, for the same reason the rules have
// none: the layout is something the tests can ask about.

export const NERTZ_WIDTH = 480;
export const NERTZ_HEIGHT = 900;

const CENTRE_Y = NERTZ_HEIGHT / 2;
// The rail is 14 units deep; a card clear of it.
const EDGE = 20;

// Four columns for the foundations and the hand row. The work piles use the
// same four when there are four of them, and are spread across the board
// instead when there are more, so a longer row still fits.
const COLUMNS = [75, 185, 295, 405];

// How far apart the outermost work piles' centres sit when there are more
// than four: as much of the 480 as a card allows, which at 78 between six
// centres still leaves each card a gap.
const WIDE_WORK_SPAN = 390;

/** The x of each of `workPiles` work-pile columns, left to right. */
export function workColumns(workPiles: number = DEFAULT_WORK_PILES): number[] {
  if (workPiles === DEFAULT_WORK_PILES) return COLUMNS;
  const pitch = WIDE_WORK_SPAN / (workPiles - 1);
  return Array.from({ length: workPiles }, (_, i) => NERTZ_WIDTH / 2 + (i - (workPiles - 1) / 2) * pitch);
}

// Two rows of four, in the middle, where both players can reach.
const FOUNDATION_ROW_GAP = CARD_HEIGHT + 10;

// The bottom player's rows. The work piles hang from just below the
// foundations; the Nertz pile, the waste and the stock sit along the edge
// nearest the player, under their thumbs.
const FOUNDATION_BOTTOM = CENTRE_Y + FOUNDATION_ROW_GAP / 2 + CARD_HEIGHT / 2;
const WORK_TOP = FOUNDATION_BOTTOM + 18;
const HAND_Y = NERTZ_HEIGHT - EDGE - CARD_HEIGHT / 2;
const WORK_BOTTOM = HAND_Y - CARD_HEIGHT / 2 - 10;

// How far each of the waste's top three sits from the one under it.
export const WASTE_FAN = 17;
const WASTE_X = COLUMNS[1] - WASTE_FAN;

export interface Spot {
  x: number;
  y: number;
  // Half a turn for the player at the top, so a card reads the right way up
  // to whoever owns it.
  angle: number;
}

/** A point on the bottom player's side as it appears from `seat`. */
function seatPoint(seat: Seat, x: number, y: number): Spot {
  return seat === 0
    ? { x, y, angle: 0 }
    : { x: NERTZ_WIDTH - x, y: NERTZ_HEIGHT - y, angle: 180 };
}

/** The centre of a foundation. Cards are laid on it upright; see foundationAngle. */
export function foundationSpot(index: number): { x: number; y: number } {
  const row = Math.floor(index / 4);
  return {
    x: COLUMNS[index % 4],
    y: CENTRE_Y + (row === 0 ? -1 : 1) * (FOUNDATION_ROW_GAP / 2),
  };
}

/** The centre of the first card of a work pile. */
export function workBase(seat: Seat, index: number, workPiles: number): Spot {
  return seatPoint(seat, workColumns(workPiles)[index], WORK_TOP + CARD_HEIGHT / 2);
}

/** The Nertz pile, the stock and the waste's base. */
export function handSpot(seat: Seat, kind: 'nertz' | 'waste' | 'stock'): Spot {
  const x = kind === 'nertz' ? COLUMNS[0] : kind === 'waste' ? WASTE_X : COLUMNS[3];
  return seatPoint(seat, x, HAND_Y);
}

/** Where a pile is printed, whoever's it is. */
export function pileSpot(seat: Seat, pile: NertzPile, workPiles: number): Spot {
  switch (pile.kind) {
    case 'work':
      return workBase(seat, pile.index, workPiles);
    case 'foundation':
      return { ...foundationSpot(pile.index), angle: 0 };
    default:
      return handSpot(seat, pile.kind);
  }
}

/**
 * The gap between neighbours down a work pile of `count` cards: the index of
 * each card showing, squeezed when the pile would otherwise run into the
 * player's hand.
 */
export function workStep(count: number): number {
  if (count < 2) return CARD_PEEK_HEIGHT;
  const room = WORK_BOTTOM - WORK_TOP - CARD_HEIGHT;
  return Math.min(CARD_PEEK_HEIGHT, room / (count - 1));
}

/** Where the card at `index` of a pile of `count` sits. */
export function cardSpot(
  seat: Seat, pile: NertzPile, index: number, count: number, workPiles: number,
): Spot {
  const base = pileSpot(seat, pile, workPiles);
  const down = seat === 0 ? 1 : -1;
  const right = seat === 0 ? 1 : -1;
  if (pile.kind === 'work') {
    return { ...base, y: base.y + down * index * workStep(count) };
  }
  if (pile.kind === 'waste') {
    // Only the last three show; the rest are under them.
    const fromTop = count - 1 - index;
    const shown = Math.max(0, 2 - fromTop);
    return { ...base, x: base.x + right * shown * WASTE_FAN };
  }
  return base;
}

/**
 * The area a drop on a work pile counts as being over: the cards already in
 * it, plus one card's worth below, so a card can be put on the end of a long
 * pile rather than only on its first card. Axis-aligned and in board units.
 */
export function workZone(seat: Seat, index: number, count: number, workPiles: number): Rect {
  const first = workBase(seat, index, workPiles);
  const lastY = cardSpot(seat, { kind: 'work', index }, Math.max(0, count - 1), count, workPiles).y;
  const top = Math.min(first.y, lastY);
  const bottom = Math.max(first.y, lastY);
  return {
    x: first.x - CARD_WIDTH / 2,
    y: top - CARD_HEIGHT / 2,
    width: CARD_WIDTH,
    height: bottom - top + CARD_HEIGHT,
  };
}

export function foundationZone(index: number): Rect {
  const at = foundationSpot(index);
  return { x: at.x - CARD_WIDTH / 2, y: at.y - CARD_HEIGHT / 2, width: CARD_WIDTH, height: CARD_HEIGHT };
}

export interface Rect { x: number; y: number; width: number; height: number }

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export const FOUNDATION_INDICES = Array.from({ length: FOUNDATIONS }, (_, i) => i);
export const workIndices = (workPiles: number): number[] => Array.from({ length: workPiles }, (_, i) => i);
