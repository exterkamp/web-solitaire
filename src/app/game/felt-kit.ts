import { Board, Node, Tween } from '@exterkamp/felt';

// The handful of things a Phaser scene gave both boards for nothing, and felt
// leaves to the game: an order to draw in, timers, a pause, and a group of
// markings that moves as one. Each is a few lines, and both boards need all
// of them, so they live here rather than twice.

/**
 * Draw order, as "put this on top". felt sorts by depth; a counter that only
 * goes up is what Phaser's bringToTop amounted to.
 */
export class Stacking {
  private top = 0;

  bringToTop(node: Node): void {
    node.depth = ++this.top;
  }
}

/**
 * Runs `run` after `ms`, on the board's clock - so a paused board's timers
 * wait with it (see pausable). `stop()` the answer to call it off.
 */
export function after(board: Board, ms: number, run: () => void): Tween {
  return board.tweens.add({ targets: {}, duration: ms, onComplete: () => run() });
}

/**
 * Lets a board be paused: its tweens, timers and tickers hold where they are
 * and the board sleeps, drawing nothing, until it is resumed.
 *
 * Done at the tweens rather than the engine because the engine is the page's
 * - the deck preview on the settings page shares it - and pausing a hand
 * should not pause anything else.
 *
 * `timeScale` speeds the same clock up, for the smoke test: a board in a
 * browser with no GPU still has to finish a game in a sensible time.
 */
export function pausable(board: Board, timeScale: () => number = () => 1): (paused: boolean) => void {
  const tweens = board.tweens;
  const step = tweens.update.bind(tweens);
  let paused = false;
  tweens.update = (ms: number) => (paused ? false : step(ms * timeScale()));
  return (next: boolean) => {
    if (next === paused) return;
    paused = next;
    if (!paused) tweens.onWake?.();
  };
}

/**
 * The printing on the felt, which moves as one when the layout slides down
 * the board - the job a Phaser container did. Each mark keeps the y it was
 * printed at; the group's offset is added to all of them.
 */
export class Markings {
  private readonly marks: { node: Node; y: number }[] = [];
  private offset = 0;
  private moving?: Tween;

  constructor(private readonly board: Board) {}

  add(node: Node): Node {
    this.marks.push({ node, y: node.y });
    node.y += this.offset;
    return node;
  }

  get y(): number {
    return this.offset;
  }

  setY(y: number): void {
    this.moving?.stop();
    this.place(y);
  }

  tweenY(y: number, duration: number, ease: string): void {
    this.moving?.stop();
    const at = { y: this.offset };
    this.moving = this.board.tweens.add({
      targets: at, y, duration, ease,
      onUpdate: () => this.place(at.y),
    });
  }

  destroy(): void {
    this.moving?.stop();
    for (const { node } of this.marks) node.destroy();
    this.marks.length = 0;
  }

  private place(y: number): void {
    this.offset = y;
    for (const mark of this.marks) mark.node.y = mark.y + y;
  }
}
