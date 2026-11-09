import { Injectable, signal } from '@angular/core';
import { DrawCount } from './game/klondike';
import { SuitCount } from './game/spider';
import { GameId } from './game/table-game';
import { WinSummary } from './game/solitaire-scene';

// The record book.
//
// Every game ever played on this device, and nowhere else: no account, no
// server, no sync. That is a real limitation and worth stating plainly -
// clearing the browser's storage clears the record - and it is also the whole
// design. A solitaire record is a private thing, and the cost of making it
// portable is an account, a password and somewhere for both to live.
//
// Kept per *variant* rather than per game, because a variant is the unit
// somebody actually compares themselves against. Draw-one Klondike is won
// perhaps four times in five with care and draw-three perhaps one in ten; a
// single rate across both would say more about which one you felt like
// playing than about how you played it. FreeCell is a third thing again:
// almost every deal is winnable, so a loss there is a loss rather than a bad
// hand.

export type Variant =
  | 'klondike-1'
  | 'klondike-3'
  | 'freecell'
  | 'yukon'
  | 'canfield'
  | 'spider-1'
  | 'spider-2'
  | 'spider-4'
  | 'spiderette'
  | 'scorpion'
  | 'seahaven'
  | 'calculation'
  | 'lucie'
  | 'tripeaks'
  | 'pyramid'
  | 'golf'
  | 'blackhole'
  | 'acesup'
  | 'pokersquares'
  | 'cribbagesquares'
  | 'blackjack';

export function variantOf(game: GameId, drawCount: DrawCount, suits: SuitCount = 1): Variant {
  // Klondike is the only game here that is two games. Everything else is
  // recorded under its own name, which is also its game id - the menu leans
  // on that when it adds a game's variants together.
  if (game === 'klondike') return drawCount === 3 ? 'klondike-3' : 'klondike-1';
  // And Spider, three: one suit, two or four, each a different game to win.
  if (game === 'spider') return `spider-${suits}`;
  return game;
}

export const VARIANT_LABELS: Record<Variant, string> = {
  'klondike-1': 'Draw one',
  'klondike-3': 'Draw three',
  freecell: 'FreeCell',
  yukon: 'Yukon',
  canfield: 'Canfield',
  'spider-1': 'One suit',
  'spider-2': 'Two suits',
  'spider-4': 'Four suits',
  spiderette: 'Spiderette',
  scorpion: 'Scorpion',
  seahaven: 'Seahaven Towers',
  calculation: 'Calculation',
  lucie: 'La Belle Lucie',
  tripeaks: 'Tri Peaks',
  pyramid: 'Pyramid',
  golf: 'Golf',
  blackhole: 'Black Hole',
  acesup: 'Aces Up',
  pokersquares: 'Poker Squares',
  cribbagesquares: 'Cribbage Squares',
  blackjack: 'Blackjack',
};

const VARIANTS: Variant[] = [
  'klondike-1', 'klondike-3', 'freecell', 'yukon', 'canfield', 'spider-1', 'spider-2', 'spider-4', 'spiderette', 'scorpion',
  'seahaven', 'calculation', 'lucie', 'tripeaks', 'pyramid', 'golf', 'blackhole', 'acesup', 'pokersquares', 'cribbagesquares', 'blackjack',
];

/**
 * How the record book is laid out: one block per game, in the order the menu
 * lists them, with Klondike's two ways of playing side by side.
 *
 * Here rather than in the page because this is the list that has to be
 * complete. The page used to name four games by hand and seven were being
 * recorded and never shown - the numbers were all there in storage, and there
 * was simply nowhere on the screen that said so. A spec now checks that every
 * variant appears in exactly one group, so the next game to arrive cannot go
 * missing the same way.
 */
export interface VariantGroup {
  title: string;
  variants: Variant[];
  // Whether this game keeps a score. Only a few do, and for the rest that row
  // would be a column of dashes pretending to be a fact about the game.
  scored: boolean;
}

export const VARIANT_GROUPS: readonly VariantGroup[] = [
  { title: 'Klondike', variants: ['klondike-1', 'klondike-3'], scored: true },
  { title: 'FreeCell', variants: ['freecell'], scored: false },
  { title: 'Yukon', variants: ['yukon'], scored: false },
  { title: 'Canfield', variants: ['canfield'], scored: false },
  { title: 'Spider', variants: ['spider-1', 'spider-2', 'spider-4'], scored: false },
  { title: 'Spiderette', variants: ['spiderette'], scored: false },
  { title: 'Scorpion', variants: ['scorpion'], scored: false },
  { title: 'Seahaven Towers', variants: ['seahaven'], scored: false },
  { title: 'Calculation', variants: ['calculation'], scored: false },
  { title: 'La Belle Lucie', variants: ['lucie'], scored: false },
  { title: 'Tri Peaks', variants: ['tripeaks'], scored: true },
  { title: 'Pyramid', variants: ['pyramid'], scored: false },
  { title: 'Golf', variants: ['golf'], scored: false },
  { title: 'Black Hole', variants: ['blackhole'], scored: false },
  { title: 'Aces Up', variants: ['acesup'], scored: false },
  { title: 'Poker Squares', variants: ['pokersquares'], scored: true },
  { title: 'Cribbage Squares', variants: ['cribbagesquares'], scored: true },
  { title: 'Blackjack', variants: ['blackjack'], scored: true },
];

/** Every variant the book keeps, in order. For the spec, and for `game`. */
export const ALL_VARIANTS: readonly Variant[] = VARIANTS;

// v2 because the shape changed when the second game arrived: what used to be
// keyed by how many cards a draw turned is now keyed by which game was being
// played. A v1 record is read once and carried over - see load() - because
// somebody's win streak is not worth losing to a refactor.
const STORAGE_KEY = 'solitaire.stats.v2';
const LEGACY_KEY = 'solitaire.stats.v1';

export interface ModeRecord {
  played: number;
  won: number;
  // Of won games only - except the best score, which in the game played for
  // points is the best of every hand. A best time from a game that was
  // abandoned is not a time at all, and the same goes for the fewest moves.
  bestScore: number;
  bestSeconds: number;
  fewestMoves: number;
  // Across won games, for the average.
  totalSeconds: number;
  currentStreak: number;
  bestStreak: number;
}

export interface StatsRecord {
  byVariant: Record<Variant, ModeRecord>;
  // The last RECENT_WINDOW games of each variant, oldest first. The totals
  // above say how somebody has played over years; these say how they are
  // playing now, which a thousand old games would otherwise drown out.
  //
  // Started fresh when this arrived: the totals never kept one game apart
  // from another, so there is no way to rebuild the window from them.
  recent: Record<Variant, GameResult[]>;
}

/** How many games the rolling record looks back over. */
export const RECENT_WINDOW = 100;

/** One finished game, as the rolling record keeps it. A loss is all zeros. */
export interface GameResult {
  won: boolean;
  seconds: number;
  moves: number;
  score: number;
}

/** Adds a game to a window, dropping the oldest once it is full. */
export function pushResult(window: readonly GameResult[], result: GameResult): GameResult[] {
  const next = [...window, result];
  return next.length > RECENT_WINDOW ? next.slice(next.length - RECENT_WINDOW) : next;
}

// How many of the window's slots have to come from before it began: games
// counted in the totals but never kept one by one.
function fillerGames(lifetime: ModeRecord, recent: readonly GameResult[]): number {
  const older = lifetime.played - recent.length;
  return Math.max(0, Math.min(RECENT_WINDOW - recent.length, older));
}

/**
 * The last RECENT_WINDOW games, with the gap filled from the totals.
 *
 * The window only started being kept when it arrived, and the totals never
 * kept one game apart from another - so somebody with three hundred games
 * behind them would otherwise open it to a page of zeros. Until the window
 * is full, its empty slots are filled with the older games' averages: their
 * win rate, their average winning time. The bests come from the totals
 * while the filler has any wins in it, since one of those older games may
 * be the best; filler with no wins in it cannot hold a best. The current
 * streak is always the real one - the totals keep it exactly - and the
 * filler is given at least the wins that streak proves are in it, so the
 * table never says a streak of three next to one game won. It is an
 * estimate, and it shrinks a game at a time: after a hundred new games none
 * of it is left.
 */
export function rollingRecord(lifetime: ModeRecord, recent: readonly GameResult[]): ModeRecord {
  const window = summarize(recent);
  const filler = fillerGames(lifetime, recent);
  if (!filler) return window;

  const olderPlayed = lifetime.played - window.played;
  const olderWon = Math.max(0, lifetime.won - window.won);
  const olderSeconds = Math.max(0, lifetime.totalSeconds - window.totalSeconds);
  const played = window.played + filler;
  // The totals' streak is exact. If every kept game was a win, the streak
  // runs back into the filler, and those wins are known rather than guessed.
  const currentStreak = Math.min(lifetime.currentStreak, played);
  const streakIntoFiller = window.currentStreak === window.played
    ? Math.min(filler, Math.max(0, currentStreak - window.played))
    : 0;
  const fillerWon = Math.max(streakIntoFiller, Math.round((olderWon / olderPlayed) * filler));
  const fillerSeconds = olderWon ? Math.round((olderSeconds / olderWon) * fillerWon) : 0;
  const won = window.won + fillerWon;
  const olderBests = fillerWon > 0;

  return {
    played,
    won,
    totalSeconds: window.totalSeconds + fillerSeconds,
    bestScore: olderBests ? Math.max(window.bestScore, lifetime.bestScore) : window.bestScore,
    bestSeconds: olderBests ? bestOf(window.bestSeconds, lifetime.bestSeconds) : window.bestSeconds,
    fewestMoves: olderBests ? bestOf(window.fewestMoves, lifetime.fewestMoves) : window.fewestMoves,
    currentStreak,
    // No longer than the wins the table shows, and never shorter than the
    // streak that is running now.
    bestStreak: Math.max(
      window.bestStreak,
      currentStreak,
      olderBests ? Math.min(lifetime.bestStreak, won) : 0,
    ),
  };
}

/**
 * A window of games, added up into the same shape as the all-time record -
 * so the record book can show either without knowing which it has.
 */
export function summarize(results: readonly GameResult[]): ModeRecord {
  const mode = emptyMode();
  let run = 0;
  for (const result of results) {
    mode.played += 1;
    // Of every game: a loss scores nothing, except in the game played for
    // points, where its score is as real as a win's.
    mode.bestScore = Math.max(mode.bestScore, result.score);
    if (result.won) {
      mode.won += 1;
      mode.bestSeconds = bestOf(mode.bestSeconds, result.seconds);
      mode.fewestMoves = bestOf(mode.fewestMoves, result.moves);
      mode.totalSeconds += result.seconds;
      run += 1;
      mode.bestStreak = Math.max(mode.bestStreak, run);
    } else {
      run = 0;
    }
  }
  mode.currentStreak = run;
  return mode;
}

function emptyMode(): ModeRecord {
  return {
    played: 0,
    won: 0,
    bestScore: 0,
    bestSeconds: 0,
    fewestMoves: 0,
    totalSeconds: 0,
    currentStreak: 0,
    bestStreak: 0,
  };
}

function emptyStats(): StatsRecord {
  const byVariant = {} as Record<Variant, ModeRecord>;
  const recent = {} as Record<Variant, GameResult[]>;
  for (const variant of VARIANTS) {
    byVariant[variant] = emptyMode();
    recent[variant] = [];
  }
  return { byVariant, recent };
}

@Injectable({ providedIn: 'root' })
export class Stats {
  private readonly record = signal<StatsRecord>(load());

  readonly all = this.record.asReadonly();

  mode(variant: Variant): ModeRecord {
    return this.record().byVariant[variant];
  }

  /** The same numbers as mode(), over only the last RECENT_WINDOW games. */
  recentMode(variant: Variant): ModeRecord {
    return rollingRecord(this.mode(variant), this.record().recent[variant]);
  }

  /** Whether recentMode() is partly made up from the all-time totals. */
  recentIsEstimated(variant: Variant): boolean {
    return fillerGames(this.mode(variant), this.record().recent[variant]) > 0;
  }

  /**
   * A whole game's record, with its variants added together.
   *
   * For the menu, where one line under one button should say how a game has
   * gone rather than how one way of playing it has. The record book itself
   * still keeps the variants apart, because that is the comparison worth
   * having once you are choosing between them.
   */
  game(game: GameId): { played: number; won: number } {
    // By name and dash, not by prefix alone: Spider's variants are not
    // Spiderette's, whatever the letters say.
    const variants = VARIANTS.filter((v) => v === game || v.startsWith(`${game}-`));
    return variants.reduce(
      (total, variant) => {
        const mode = this.mode(variant);
        return { played: total.played + mode.played, won: total.won + mode.won };
      },
      { played: 0, won: 0 },
    );
  }

  winRate(variant: Variant): number {
    const mode = this.mode(variant);
    return mode.played ? mode.won / mode.played : 0;
  }

  /** The average length of a won game, in seconds. Zero if there are none. */
  averageSeconds(variant: Variant): number {
    const mode = this.mode(variant);
    return mode.won ? Math.round(mode.totalSeconds / mode.won) : 0;
  }

  recordWin(variant: Variant, summary: WinSummary): void {
    // Normalised the way mergeRecent() reads it back, so the window says the
    // same thing before a reload as after one.
    const count = (value: number) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
    const result = {
      won: true, seconds: count(summary.seconds), moves: count(summary.moves), score: count(summary.total),
    };
    this.update(variant, result, (mode) => {
      const streak = mode.currentStreak + 1;
      return {
        ...mode,
        played: mode.played + 1,
        won: mode.won + 1,
        bestScore: Math.max(mode.bestScore, summary.total),
        bestSeconds: bestOf(mode.bestSeconds, summary.seconds),
        fewestMoves: bestOf(mode.fewestMoves, summary.moves),
        totalSeconds: mode.totalSeconds + summary.seconds,
        currentStreak: streak,
        bestStreak: Math.max(mode.bestStreak, streak),
      };
    });
  }

  /**
   * A game given up on.
   *
   * Only called for a deal that was actually played and then dealt over -
   * see the play page and SavedGames.abandon. Leaving the board does not
   * call it: the hand is saved and can be continued. A
   * game dealt, looked at and abandoned without a move is not a loss, because
   * counting it as one would make the record book punish curiosity.
   */
  recordLoss(variant: Variant, score = 0): void {
    // With a score only in the game played for points, where a hand that
    // ends short of its target still ended on a number worth keeping. Every
    // other loss is all zeros.
    const points = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
    this.update(variant, { won: false, seconds: 0, moves: 0, score: points }, (mode) => ({
      ...mode,
      played: mode.played + 1,
      bestScore: Math.max(mode.bestScore, points),
      currentStreak: 0,
    }));
  }

  /** Wipes the record. The only way back from a bad afternoon. */
  clear(): void {
    this.record.set(emptyStats());
    save(this.record());
  }

  private update(
    variant: Variant,
    result: GameResult,
    change: (mode: ModeRecord) => ModeRecord,
  ): void {
    const next = this.record();
    const updated: StatsRecord = {
      byVariant: { ...next.byVariant, [variant]: change(next.byVariant[variant]) },
      recent: { ...next.recent, [variant]: pushResult(next.recent[variant], result) },
    };
    this.record.set(updated);
    save(updated);
  }
}

// Zero means "never", so it loses to any real answer. Without this the first
// win sets a best time of zero seconds and nothing ever beats it.
function bestOf(current: number, candidate: number): number {
  if (!candidate) return current;
  return current ? Math.min(current, candidate) : candidate;
}

function load(): StatsRecord {
  const stats = emptyStats();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StatsRecord>;
      for (const variant of VARIANTS) {
        stats.byVariant[variant] = mergeMode(parsed.byVariant?.[variant]);
        stats.recent[variant] = mergeRecent(parsed.recent?.[variant]);
      }
      return stats;
    }

    // Nothing under v2, so this may be somebody who played before FreeCell
    // arrived. Their draw-one and draw-three records are the same games under
    // different names and come across as they are.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as { byDraw?: Record<string, Partial<ModeRecord>> };
      stats.byVariant['klondike-1'] = mergeMode(old.byDraw?.['1']);
      stats.byVariant['klondike-3'] = mergeMode(old.byDraw?.['3']);
      save(stats);
    }
    return stats;
  } catch {
    return emptyStats();
  }
}

function mergeMode(stored: Partial<ModeRecord> | undefined): ModeRecord {
  const base = emptyMode();
  if (!stored) return base;
  // Field by field rather than trusting the shape. This is a file the user
  // can edit, a file an older version of this game wrote, and a file that
  // survives every rename in here - so a missing mode or a string where a
  // number should be is ordinary, not exceptional.
  const numbers = Object.keys(base) as (keyof ModeRecord)[];
  for (const key of numbers) {
    const value = stored[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      base[key] = Math.floor(value);
    }
  }
  return base;
}

// Same distrust as mergeMode, one game at a time: anything that is not a
// plausible game is dropped rather than repaired, and a window somebody has
// padded past its length is cut back to the newest games.
export function mergeRecent(stored: unknown): GameResult[] {
  if (!Array.isArray(stored)) return [];
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  return stored
    .filter((entry): entry is Partial<Record<keyof GameResult, unknown>> =>
      typeof entry === 'object' && entry !== null && typeof entry.won === 'boolean')
    .map((entry) => ({
      won: entry.won as boolean,
      seconds: count(entry.seconds),
      moves: count(entry.moves),
      score: count(entry.score),
    }))
    .slice(-RECENT_WINDOW);
}

function save(record: StatsRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Nothing to do and nothing worth saying: the game is still playable
    // without a record of it.
  }
}
