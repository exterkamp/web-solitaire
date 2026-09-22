import { Move } from './piles';
import { TableGame, TableMoveResult } from './table-game';

// One game in progress, and everything that has happened in it.
//
// Generic over which game, because none of what is here is about the rules:
// it is a stack of old states, a clock, and a count of how often somebody
// changed their mind. The rules module it was written for holds no history -
// every function there takes a state and answers with a new one - and this is
// where that decision is spent. Undo is the states nobody threw away rather
// than a second implementation of every move running backwards, which is
// where undo bugs come from.
//
// Each of these is one deal. Starting a new game means a new session, which
// is what keeps "how long has this game taken" from ever being asked of the
// wrong one.
export class GameSession<S> {
  private history: S[] = [];
  private current: S;

  // Wall-clock, started by the first move rather than by the deal. A game
  // looked at and not played has not taken any time, and on a phone the gap
  // between the two can be a bus ride.
  private startedAt: number | undefined;
  private stoppedAt: number | undefined;

  // Time spent with the game paused, which the clock does not count.
  //
  // A pause menu that ran the clock would be a pause menu nobody could
  // afford to open: best time is in the record book, and putting the phone
  // down to answer the door is not part of how long a hand took.
  private pausedAt: number | undefined;
  private pausedFor = 0;

  // Counted for the record book. Not penalised: a score is a measure of the
  // game you played, and an undo means that game did not happen.
  undos = 0;

  constructor(
    private readonly game: TableGame<S>,
    random: () => number = Math.random,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.current = game.deal(random);
  }

  get state(): S {
    return this.current;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get won(): boolean {
    return this.game.hasWon(this.current);
  }

  get canFinish(): boolean {
    return this.game.canAutoFinish(this.current);
  }

  get moves(): number {
    return this.game.moveCount(this.current);
  }

  /**
   * True once the game is over: nothing to play here, and - in a game with a
   * deck - nothing to play anywhere in it either. Each game answers this for
   * itself, because "stuck" means something different when there is a deck to
   * turn than when every card is already on the table.
   */
  get stuck(): boolean {
    return this.game.isDeadEnd(this.current);
  }

  /**
   * Stops and starts the clock, for the pause menu.
   *
   * Idempotent in both directions: the board can say "paused" twice - the
   * back gesture and the Menu button both arrive here - without the second
   * one moving the mark.
   */
  setPaused(paused: boolean): void {
    if (paused) {
      if (this.pausedAt === undefined) this.pausedAt = this.now();
      return;
    }
    if (this.pausedAt === undefined) return;
    this.pausedFor += this.now() - this.pausedAt;
    this.pausedAt = undefined;
  }

  /**
   * Seconds since the first move, frozen once the game is won - and frozen
   * again, without stopping, while the game is paused.
   *
   * Three readings in one expression: a won game reads to the moment it was
   * won, a paused game to the moment it was paused, and a game in progress to
   * now. Whichever it is, the time spent in earlier pauses comes off.
   */
  elapsed(): number {
    if (this.startedAt === undefined) return 0;
    const until = this.stoppedAt ?? this.pausedAt ?? this.now();
    return Math.max(0, Math.round((until - this.startedAt - this.pausedFor) / 1000));
  }

  /**
   * Plays a move if it is legal, and answers what happened. An illegal move
   * changes nothing at all - not the state, not the history, not the clock.
   */
  play(move: Move): TableMoveResult<S> | undefined {
    const result = this.game.apply(this.current, move);
    if (!result) return undefined;

    this.history.push(this.current);
    this.current = result.state;
    if (this.startedAt === undefined) this.startedAt = this.now();
    // The clock stops the moment the last card goes home, not when the player
    // gets round to dismissing the win.
    if (this.won) this.stoppedAt = this.now();
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
