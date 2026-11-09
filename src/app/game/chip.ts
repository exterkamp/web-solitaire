import { Board, ChipSet, ChipStack, Pieces, createPieces, makeChange } from '@exterkamp/felt';
import { after } from './felt-kit';

// A score, in chips, the way a table actually keeps one - not a number in
// the bar but a stack sitting on the felt, the way the felt itself is
// generated rather than shipped as an image (see table.ts). Five
// denominations, each its own colour, the same convention a real casino
// uses so a stack can be read at a glance without counting: white, red,
// blue and purple climbing in value, and the highest one in black with a
// gold edge - the one colour this app otherwise reserves for "this is
// selected", borrowed here because a $100 chip earns it the same way a
// real one does.
//
// Drawn by felt's pieces, in the same draw as the cards: each chip is a
// node, each look painted once. The pile used to be a Matter world, chips
// poured in and left to topple; felt has no physics, and a stack that is
// squared up a little untidily - felt's own `messy` - reads as a score just
// as well, for a great deal less running every frame.

export const CHIP_VALUES: readonly number[] = [100, 50, 10, 5, 1];

/** The chips, in this table's colours: body, edge spots and ring, and ink. */
export const CHIP_SET = new ChipSet([
  // The value is printed on the cream inlay, so it is inked in the chip's
  // own colour - cream ink there is a chip with no number on it.
  { value: 100, color: '#1c1a1d', spot: '#ffd166', ink: '#1c1a1d' },
  { value: 50, color: '#5b3a86', spot: '#f2ede2', ink: '#5b3a86' },
  { value: 10, color: '#2857a6', spot: '#f2ede2', ink: '#2857a6' },
  { value: 5, color: '#b83a2e', spot: '#f2ede2', ink: '#b83a2e' },
  { value: 1, color: '#f2ede2', spot: '#8a7a5c', ink: '#3a3128' },
]);

// Logical size, the same units a card's width is measured in - a little under
// half a card across, so a whole stack of them still reads as something
// sitting beside the game rather than competing with it.
export const CHIP_DIAMETER = 28;

// Six to a column, then a new column to the right: short enough that the
// stack never climbs into the top row's cards, and three columns - eighteen
// chips, a score past 1,500 - fit between the game's name and the rail.
const PER_COLUMN = 6;
const COLUMNS = 3;

/** How wide the stack can get, from the middle of its first column to the far edge of its last. */
export const CHIP_STACK_REACH = (COLUMNS - 1) * CHIP_DIAMETER * 1.12 + CHIP_DIAMETER / 2;

// How far above its place a new chip starts, and how long it takes to land.
const DROP_HEIGHT = 46;
const DROP_MS = 260;
const DROP_STAGGER_MS = 28;

// A chip landing: down, and two small bounces off the one under it. Penner's
// bounce, which felt does not carry by name.
function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

/** How many of each chip a score is, largest first. */
export function chipCounts(score: number): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const value of makeChange(Math.max(0, Math.floor(score)), CHIP_VALUES)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return CHIP_VALUES.filter((v) => counts.has(v)).map((value) => ({ value, count: counts.get(value)! }));
}

/**
 * The score's stack, on the felt. `show(score)` makes it that many chips,
 * largest at the bottom; chips a score gained drop on from above, and chips
 * it lost simply go.
 */
export class ScoreChips {
  private readonly pieces: Pieces;
  private stack?: ChipStack;
  private shown: number[] = [];
  private drop = 0;

  constructor(private readonly board: Board, private readonly x: number, private readonly y: number) {
    this.pieces = createPieces(board, { set: CHIP_SET, diameter: CHIP_DIAMETER });
  }

  show(score: number | undefined): void {
    const chips = score === undefined
      ? []
      : chipCounts(score).flatMap(({ value, count }) => Array<number>(count).fill(value));
    if (chips.length === this.shown.length && chips.every((v, i) => v === this.shown[i])) return;
    // How much of the old stack is still the bottom of the new one: those
    // chips stay where they are, and only the rest arrive.
    let kept = 0;
    while (kept < chips.length && chips[kept] === this.shown[kept]) kept++;

    if (this.stack) this.pieces.removeStack(this.stack);
    this.stack = undefined;
    this.shown = chips;
    if (!chips.length) return;
    this.stack = this.pieces.stack({ id: 'score', x: this.x, y: this.y + this.drop, chips, messy: 0.8, perColumn: PER_COLUMN });
    this.stack.chips.forEach((chip, i) => {
      if (i < kept) return;
      const to = chip.y;
      chip.y = to - DROP_HEIGHT;
      chip.visible = false;
      after(this.board, (i - kept) * DROP_STAGGER_MS, () => {
        if (chip.isDestroyed) return;
        chip.visible = true;
        this.board.tweens.add({ targets: chip, y: to, duration: DROP_MS, ease: bounceOut });
      });
    });
  }

  /**
   * Slides the stack with the board, which sits lower when the tableau is
   * not using its height (see updateDrop): it lives in the band beside the
   * game's name, and that band moves.
   */
  setDrop(drop: number, duration = 0): void {
    this.drop = drop;
    this.stack?.moveTo(this.x, this.y + drop, duration);
  }

  destroy(): void {
    this.pieces.destroy();
  }
}

/** Where a blackjack seat's chips live: your stack, the circle, the house. */
export interface ChipSeat {
  bank: { x: number; y: number };
  bet: { x: number; y: number };
  house: { x: number; y: number };
}

// How long a tossed chip waits behind the one before it.
const TOSS_STAGGER_MS = 90;

/**
 * A seat at a table played for chips: your stack in front of you and your
 * bet in the circle, kept apart the way a real table keeps them.
 *
 * Told only the two numbers - what you have and what is bet - and works out
 * what a dealer's hands would have done between one and the next. A bet is
 * taken off your stack and tossed up into the circle, chip by chip, end over
 * end; a win is paid into the circle from the house and the circle swept
 * back to you; a loss is swept away to the house; a push comes straight
 * back. Anything it cannot explain that way - a hand picked up from a save,
 * a new shoe - is simply set out as it is.
 *
 * felt does the chip work: making change, the toss, the flights. This only
 * decides which of them happened.
 */
export class ChipTable {
  private readonly pieces: Pieces;
  private bank: ChipStack;
  private bet: ChipStack;
  private drop = 0;
  private shown?: { bank: number; bet: number };
  // Transitions play one after another, never over each other.
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly board: Board, private readonly seat: ChipSeat) {
    this.pieces = createPieces(board, { set: CHIP_SET, diameter: CHIP_DIAMETER });
    this.bank = this.pieces.stack({ id: 'bank', x: seat.bank.x, y: seat.bank.y, chips: [], messy: 0.8, perColumn: PER_COLUMN });
    this.bet = this.pieces.stack({ id: 'bet', x: seat.bet.x, y: seat.bet.y, chips: [], messy: 0.5, perColumn: 12 });
  }

  show(bank: number, bet: number): void {
    const before = this.shown;
    this.shown = { bank, bet };
    if (before && before.bank === bank && before.bet === bet) return;
    this.queue = this.queue.then(() => this.change(before, bank, bet)).catch(() => this.setOut(bank, bet));
  }

  private async change(before: { bank: number; bet: number } | undefined, bank: number, bet: number): Promise<void> {
    if (!before || this.board.isDestroyed) return this.setOut(bank, bet);
    const staked = bet - before.bet;
    // A bet, or a double, or a split: taken off your stack and tossed in.
    if (staked > 0 && before.bank - bank === staked) return this.toss(staked);
    // The hand settled: what came back to you is what your stack grew by.
    if (before.bet > 0 && bet === 0 && bank >= before.bank) return this.settle(before.bet, bank - before.bank);
    // Settled the moment it was dealt - a blackjack either side - so the
    // bet never sat in the circle: the difference simply comes or goes.
    if (before.bet === 0 && bet === 0) return this.house(bank - before.bank);
    this.setOut(bank, bet);
  }

  private async toss(amount: number): Promise<void> {
    const lifted = this.pieces.split(this.bank, { value: amount }, this.at(this.seat.bank), { instant: true });
    // Each toss takes its chip off the lifted stack at once, so the stack is
    // empty - and safe to clear away, which would take its chips with it -
    // only after every toss has started.
    const tosses = [...lifted.chips].map((chip, i) =>
      this.pieces.toss(chip, this.bet, { delay: i * TOSS_STAGGER_MS, twirl: 25 }));
    this.pieces.removeStack(lifted);
    await Promise.all(tosses);
  }

  private async settle(stake: number, paid: number): Promise<void> {
    if (paid > stake) {
      // Paid into the circle beside the bet, then the lot comes back.
      await this.fromHouse(this.bet, paid - stake);
    } else if (paid < stake) {
      // Lost, or partly: the house sweeps its share out of the circle.
      await this.toHouse(this.bet, stake - paid);
    }
    if (this.bet.count) await this.pieces.move(this.bet, this.bank);
  }

  private async house(change: number): Promise<void> {
    if (change > 0) await this.fromHouse(this.bank, change);
    if (change < 0) await this.toHouse(this.bank, -change);
  }

  private async fromHouse(to: ChipStack, amount: number): Promise<void> {
    const rack = this.pieces.stack({ x: this.at(this.seat.house).x, y: this.at(this.seat.house).y, chips: makeChange(amount, CHIP_VALUES) });
    await this.pieces.move(rack, to);
    this.pieces.removeStack(rack);
  }

  private async toHouse(from: ChipStack, amount: number): Promise<void> {
    const rack = this.pieces.stack({ x: this.at(this.seat.house).x, y: this.at(this.seat.house).y, chips: [] });
    await this.pieces.pay(from, rack, amount);
    this.pieces.removeStack(rack);
  }

  /** Both stacks exactly as they are, with no ceremony. */
  private setOut(bank: number, bet: number): void {
    if (this.board.isDestroyed) return;
    const fill = (stack: ChipStack, value: number) => {
      const chips = value > 0 ? makeChange(value, CHIP_VALUES) : [];
      this.pieces.removeStack(stack);
      return this.pieces.stack({ id: stack.id, x: stack.x, y: stack.y, chips, messy: stack.layoutOptions.messy, perColumn: stack.layoutOptions.perColumn });
    };
    this.bank = fill(this.bank, bank);
    this.bet = fill(this.bet, bet);
  }

  private at(place: { x: number; y: number }): { x: number; y: number } {
    return { x: place.x, y: place.y + this.drop };
  }

  /** Slides the seat with the layout. */
  setDrop(drop: number, duration = 0): void {
    this.drop = drop;
    this.bank.moveTo(this.seat.bank.x, this.seat.bank.y + drop, duration);
    this.bet.moveTo(this.seat.bet.x, this.seat.bet.y + drop, duration);
  }

  destroy(): void {
    this.pieces.destroy();
  }
}
