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
/** The height the table was drawn for, and the one it is built at when the page's box is not known. */
export const NERTZ_HEIGHT = 900;

// The shortest the table is ever built: still room in each half for a work
// pile to show a few cards before it is squeezed. A screen squarer than this
// (a laptop, a phone on its side) is fitted by height instead.
export const NERTZ_MIN_HEIGHT = 740;
// And the tallest: past this the extra length only spreads the two players
// further apart for nothing, so a very long screen is fitted by width with
// felt to spare rather than stretched.
export const NERTZ_MAX_HEIGHT = 1100;

/**
 * The height a table should be built at to fill a box of the given shape
 * (height over width) edge to edge, within the limits above.
 */
export function nertzHeightFor(aspect: number | undefined): number {
  if (!aspect || !Number.isFinite(aspect)) return NERTZ_HEIGHT;
  return Math.round(Math.min(NERTZ_MAX_HEIGHT, Math.max(NERTZ_MIN_HEIGHT, NERTZ_WIDTH * aspect)));
}

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

// How far each of the waste's top three sits from the one under it.
export const WASTE_FAN = 17;
const WASTE_X = COLUMNS[1] - WASTE_FAN;

/** How big a Stuck chip is, as a radius. */
export const CHIP_RADIUS = 19;

export interface Spot {
  x: number;
  y: number;
  // Half a turn for the player at the top, so a card reads the right way up
  // to whoever owns it.
  angle: number;
}

export interface Rect { x: number; y: number; width: number; height: number }

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The table, at one height. The width is always 480 - four columns of
 * cards decide it - and the height is the page's: the board is built to the
 * shape of the box it is shown in, so it fills a phone edge to edge, and
 * whatever length a screen has beyond the shortest table goes to the work
 * piles, which are the only thing on it that grows.
 *
 * The middle stays the middle and the hand rows stay on their edges; only
 * the room between them changes.
 */
export class NertzLayout {
  readonly width = NERTZ_WIDTH;
  private readonly centreY: number;
  // The bottom player's rows. The work piles hang from just below the
  // foundations; the Nertz pile, the waste and the stock sit along the edge
  // nearest the player, under their thumbs.
  private readonly workTop: number;
  private readonly handY: number;
  private readonly workBottom: number;

  constructor(readonly height: number = NERTZ_HEIGHT) {
    this.centreY = height / 2;
    const foundationBottom = this.centreY + FOUNDATION_ROW_GAP / 2 + CARD_HEIGHT / 2;
    this.workTop = foundationBottom + 18;
    this.handY = height - EDGE - CARD_HEIGHT / 2;
    this.workBottom = this.handY - CARD_HEIGHT / 2 - 10;
  }

  /** A point on the bottom player's side as it appears from `seat`. */
  private seatPoint(seat: Seat, x: number, y: number): Spot {
    return seat === 0
      ? { x, y, angle: 0 }
      : { x: this.width - x, y: this.height - y, angle: 180 };
  }

  /** The centre of a foundation. Cards are laid on it upright; see foundationAngle. */
  foundationSpot(index: number): { x: number; y: number } {
    const row = Math.floor(index / 4);
    return {
      x: COLUMNS[index % 4],
      y: this.centreY + (row === 0 ? -1 : 1) * (FOUNDATION_ROW_GAP / 2),
    };
  }

  /** The centre of the first card of a work pile. */
  workBase(seat: Seat, index: number, workPiles: number): Spot {
    return this.seatPoint(seat, workColumns(workPiles)[index], this.workTop + CARD_HEIGHT / 2);
  }

  /** The Nertz pile, the stock and the waste's base. */
  handSpot(seat: Seat, kind: 'nertz' | 'waste' | 'stock'): Spot {
    const x = kind === 'nertz' ? COLUMNS[0] : kind === 'waste' ? WASTE_X : COLUMNS[3];
    return this.seatPoint(seat, x, this.handY);
  }

  /** Where a pile is printed, whoever's it is. */
  pileSpot(seat: Seat, pile: NertzPile, workPiles: number): Spot {
    switch (pile.kind) {
      case 'work':
        return this.workBase(seat, pile.index, workPiles);
      case 'foundation':
        return { ...this.foundationSpot(pile.index), angle: 0 };
      default:
        return this.handSpot(seat, pile.kind);
    }
  }

  /**
   * The gap between neighbours down a work pile of `count` cards: the index
   * of each card showing, squeezed when the pile would otherwise run into
   * the player's hand.
   */
  workStep(count: number): number {
    if (count < 2) return CARD_PEEK_HEIGHT;
    const room = this.workBottom - this.workTop - CARD_HEIGHT;
    return Math.min(CARD_PEEK_HEIGHT, room / (count - 1));
  }

  /** Where the card at `index` of a pile of `count` sits. */
  cardSpot(seat: Seat, pile: NertzPile, index: number, count: number, workPiles: number): Spot {
    const base = this.pileSpot(seat, pile, workPiles);
    const down = seat === 0 ? 1 : -1;
    const right = seat === 0 ? 1 : -1;
    if (pile.kind === 'work') {
      return { ...base, y: base.y + down * index * this.workStep(count) };
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
   * The area a drop on a work pile counts as being over: the cards already
   * in it, plus one card's worth below, so a card can be put on the end of a
   * long pile rather than only on its first card. Axis-aligned, board units.
   */
  workZone(seat: Seat, index: number, count: number, workPiles: number): Rect {
    const first = this.workBase(seat, index, workPiles);
    const lastY = this.cardSpot(seat, { kind: 'work', index }, Math.max(0, count - 1), count, workPiles).y;
    const top = Math.min(first.y, lastY);
    const bottom = Math.max(first.y, lastY);
    return {
      x: first.x - CARD_WIDTH / 2,
      y: top - CARD_HEIGHT / 2,
      width: CARD_WIDTH,
      height: bottom - top + CARD_HEIGHT,
    };
  }

  foundationZone(index: number): Rect {
    const at = this.foundationSpot(index);
    return { x: at.x - CARD_WIDTH / 2, y: at.y - CARD_HEIGHT / 2, width: CARD_WIDTH, height: CARD_HEIGHT };
  }

  // --- the Stuck chips --------------------------------------------------------

  /**
   * Where a player's Stuck chip waits: on their own edge, in the gap between
   * the waste's fan and the stock, under the thumb that turns the stock.
   */
  chipHome(seat: Seat): Spot {
    const wasteRight = WASTE_X + 2 * WASTE_FAN + CARD_WIDTH / 2;
    const stockLeft = COLUMNS[3] - CARD_WIDTH / 2;
    return this.seatPoint(seat, (wasteRight + stockLeft) / 2, this.handY);
  }

  /**
   * Where a chip sits once it is thrown in: the channel between the second
   * and third columns of foundations, which is the one place in the middle
   * that is not a card. Each player's on their own side of the centre line.
   */
  chipMiddle(seat: Seat): Spot {
    return this.seatPoint(seat, this.width / 2, this.centreY + CHIP_RADIUS + 8);
  }

  /** What counts as the middle when a chip is let go: the whole block of foundations. */
  middleZone(): Rect {
    const first = this.foundationZone(0);
    const last = this.foundationZone(FOUNDATIONS - 1);
    return { x: first.x, y: first.y, width: last.x + last.width - first.x, height: last.y + last.height - first.y };
  }
}

export const FOUNDATION_INDICES = Array.from({ length: FOUNDATIONS }, (_, i) => i);
export const workIndices = (workPiles: number): number[] => Array.from({ length: workPiles }, (_, i) => i);
