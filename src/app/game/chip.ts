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
  { value: 100, color: '#1c1a1d', spot: '#ffd166', ink: '#ffd166' },
  { value: 50, color: '#5b3a86', spot: '#f2ede2', ink: '#f2ede2' },
  { value: 10, color: '#2857a6', spot: '#f2ede2', ink: '#f2ede2' },
  { value: 5, color: '#b83a2e', spot: '#f2ede2', ink: '#f2ede2' },
  { value: 1, color: '#f2ede2', spot: '#8a7a5c', ink: '#3a3128' },
]);

// Logical size, the same units a card's width is measured in - about
// half a card across, so a whole stack of them still reads as something
// sitting beside the game rather than competing with it.
const CHIP_DIAMETER = 34;

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
    this.stack = this.pieces.stack({ id: 'score', x: this.x, y: this.y, chips, messy: 0.8 });
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

  destroy(): void {
    this.pieces.destroy();
  }
}
