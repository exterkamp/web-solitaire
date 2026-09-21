import { Injectable, computed, signal } from '@angular/core';
import { DrawCount } from './game/klondike';
import { WinSummary } from './game/solitaire-scene';

// The record book.
//
// Every game ever played on this device, and nowhere else: no account, no
// server, no sync. That is a real limitation and worth stating plainly -
// clearing the browser's storage clears the record - and it is also the whole
// design. A solitaire record is a private thing, and the cost of making it
// portable is an account, a password and somewhere for both to live.
//
// Draw-one and draw-three are kept apart because they are not the same game:
// draw-one is won perhaps four times in five with care and draw-three perhaps
// one in ten, so a single win rate across both would say more about which one
// you felt like playing than about how you played it.

const STORAGE_KEY = 'solitaire.stats.v1';

export interface ModeRecord {
  played: number;
  won: number;
  // Of won games only. A best time from a game that was abandoned is not a
  // time at all, and the same goes for the fewest moves.
  bestScore: number;
  bestSeconds: number;
  fewestMoves: number;
  // Across won games, for the average.
  totalSeconds: number;
  currentStreak: number;
  bestStreak: number;
}

export interface StatsRecord {
  byDraw: Record<DrawCount, ModeRecord>;
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
  return { byDraw: { 1: emptyMode(), 3: emptyMode() } };
}

@Injectable({ providedIn: 'root' })
export class Stats {
  private readonly record = signal<StatsRecord>(load());

  readonly all = this.record.asReadonly();

  readonly totals = computed<ModeRecord & { winRate: number }>(() => {
    const modes = Object.values(this.record().byDraw);
    const sum = modes.reduce(
      (acc, mode) => ({
        played: acc.played + mode.played,
        won: acc.won + mode.won,
        // A best across two games that are scored the same way is still a
        // best; a streak across them is not, so it is not offered here.
        bestScore: Math.max(acc.bestScore, mode.bestScore),
        bestSeconds: bestTime(acc.bestSeconds, mode.bestSeconds),
        fewestMoves: bestTime(acc.fewestMoves, mode.fewestMoves),
        totalSeconds: acc.totalSeconds + mode.totalSeconds,
        currentStreak: 0,
        bestStreak: Math.max(acc.bestStreak, mode.bestStreak),
      }),
      emptyMode(),
    );
    return { ...sum, winRate: sum.played ? sum.won / sum.played : 0 };
  });

  mode(draw: DrawCount): ModeRecord {
    return this.record().byDraw[draw];
  }

  winRate(draw: DrawCount): number {
    const mode = this.mode(draw);
    return mode.played ? mode.won / mode.played : 0;
  }

  /** The average length of a won game, in seconds. Zero if there are none. */
  averageSeconds(draw: DrawCount): number {
    const mode = this.mode(draw);
    return mode.won ? Math.round(mode.totalSeconds / mode.won) : 0;
  }

  recordWin(summary: WinSummary): void {
    this.update(summary.drawCount, (mode) => {
      const streak = mode.currentStreak + 1;
      return {
        ...mode,
        played: mode.played + 1,
        won: mode.won + 1,
        bestScore: Math.max(mode.bestScore, summary.total),
        bestSeconds: bestTime(mode.bestSeconds, summary.seconds),
        fewestMoves: bestTime(mode.fewestMoves, summary.moves),
        totalSeconds: mode.totalSeconds + summary.seconds,
        currentStreak: streak,
        bestStreak: Math.max(mode.bestStreak, streak),
      };
    });
  }

  /**
   * A game given up on.
   *
   * Only called for a deal that was actually played - see the play page. A
   * game dealt, looked at and abandoned without a move is not a loss, because
   * counting it as one would make the record book punish curiosity.
   */
  recordLoss(draw: DrawCount): void {
    this.update(draw, (mode) => ({
      ...mode,
      played: mode.played + 1,
      currentStreak: 0,
    }));
  }

  /** Wipes the record. The only way back from a bad afternoon. */
  clear(): void {
    this.record.set(emptyStats());
    save(this.record());
  }

  private update(draw: DrawCount, change: (mode: ModeRecord) => ModeRecord): void {
    const next = this.record();
    const updated: StatsRecord = {
      byDraw: { ...next.byDraw, [draw]: change(next.byDraw[draw]) },
    };
    this.record.set(updated);
    save(updated);
  }
}

// Zero means "never", so it loses to any real answer. Without this the first
// win sets a best time of zero seconds and nothing ever beats it.
function bestTime(current: number, candidate: number): number {
  if (!candidate) return current;
  return current ? Math.min(current, candidate) : candidate;
}

function load(): StatsRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStats();
    const parsed = JSON.parse(raw) as Partial<StatsRecord>;
    // Field by field rather than trusting the shape. This is a file the user
    // can edit, a file an older version of this game wrote, and a file that
    // survives every rename in here - so a missing mode or a string where a
    // number should be is ordinary, not exceptional.
    return {
      byDraw: {
        1: mergeMode(parsed.byDraw?.[1]),
        3: mergeMode(parsed.byDraw?.[3]),
      },
    };
  } catch {
    return emptyStats();
  }
}

function mergeMode(stored: Partial<ModeRecord> | undefined): ModeRecord {
  const base = emptyMode();
  if (!stored) return base;
  const numbers = Object.keys(base) as (keyof ModeRecord)[];
  for (const key of numbers) {
    const value = stored[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      base[key] = Math.floor(value);
    }
  }
  return base;
}

function save(record: StatsRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Nothing to do and nothing worth saying: the game is still playable
    // without a record of it.
  }
}
