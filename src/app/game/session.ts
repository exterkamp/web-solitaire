import {
  DrawCount,
  GameState,
  Move,
  MoveResult,
  apply,
  canAutoFinish,
  deal,
  hasWon,
  legalMoves,
} from './klondike';

// One game in progress, and everything that has happened in it.
//
// The rules module deliberately holds no history - every function there takes
// a state and answers with a new one. This is where that decision is spent:
// undo is the stack of states nobody threw away, and it is unlimited because
// keeping fifty-two cards fifty times over costs a few tens of kilobytes.
//
// Each of these is one deal. Starting a new game means a new Solitaire, which
// is what keeps "how long has this game taken" and "how many moves is that"
// from ever being asked of the wrong deal.
export class Solitaire {
  private history: GameState[] = [];
  private current: GameState;

  // Wall-clock, started by the first move rather than by the deal. A game
  // looked at and not played has not taken any time, and on a phone the gap
  // between the two can be a bus ride.
  private startedAt: number | undefined;
  private stoppedAt: number | undefined;

  // Counted for the record book. Not penalised: the score is a measure of the
  // game you played, and an undo means that game did not happen.
  undos = 0;

  constructor(
    readonly drawCount: DrawCount,
    random: () => number = Math.random,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.current = deal(drawCount, random);
  }

  get state(): GameState {
    return this.current;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get won(): boolean {
    return hasWon(this.current);
  }

  get canFinish(): boolean {
    return canAutoFinish(this.current);
  }

  /** True once there is nothing legal left to do. */
  get stuck(): boolean {
    return !this.won && legalMoves(this.current).length === 0;
  }

  /** Seconds since the first move, frozen once the game is won. */
  elapsed(): number {
    if (this.startedAt === undefined) return 0;
    return Math.max(0, Math.round(((this.stoppedAt ?? this.now()) - this.startedAt) / 1000));
  }

  /**
   * Plays a move if it is legal, and answers what happened. An illegal move
   * changes nothing at all - not the state, not the history, not the clock.
   */
  play(move: Move): MoveResult | undefined {
    const result = apply(this.current, move);
    if (!result) return undefined;

    this.history.push(this.current);
    this.current = result.state;
    if (this.startedAt === undefined) this.startedAt = this.now();
    // The clock stops the moment the last card goes home, not when the
    // player gets round to dismissing the win.
    if (hasWon(this.current)) this.stoppedAt = this.now();
    return result;
  }

  /** Steps back one move, and answers whether there was one to step back to. */
  undo(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.current = previous;
    this.undos++;
    // A game undone back past its win is running again, and the clock with
    // it. Reachable: the finish can be undone, which is worth allowing -
    // somebody who undoes a win generally wants to keep playing the deal.
    this.stoppedAt = undefined;
    return true;
  }
}
