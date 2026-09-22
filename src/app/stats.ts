import { Injectable, signal } from '@angular/core';
import { DrawCount } from './game/klondike';
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

export type Variant = 'klondike-1' | 'klondike-3' | 'freecell';

export function variantOf(game: GameId, drawCount: DrawCount): Variant {
  if (game === 'freecell') return 'freecell';
  return drawCount === 3 ? 'klondike-3' : 'klondike-1';
}

export const VARIANT_LABELS: Record<Variant, string> = {
  'klondike-1': 'Draw one',
  'klondike-3': 'Draw three',
  freecell: 'FreeCell',
};

const VARIANTS: Variant[] = ['klondike-1', 'klondike-3', 'freecell'];

// v2 because the shape changed when the second game arrived: what used to be
// keyed by how many cards a draw turned is now keyed by which game was being
// played. A v1 record is read once and carried over - see load() - because
// somebody's win streak is not worth losing to a refactor.
const STORAGE_KEY = 'solitaire.stats.v2';
const LEGACY_KEY = 'solitaire.stats.v1';

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
  byVariant: Record<Variant, ModeRecord>;
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
  return {
    byVariant: {
      'klondike-1': emptyMode(),
      'klondike-3': emptyMode(),
      freecell: emptyMode(),
    },
  };
}

@Injectable({ providedIn: 'root' })
export class Stats {
  private readonly record = signal<StatsRecord>(load());

  readonly all = this.record.asReadonly();

  mode(variant: Variant): ModeRecord {
    return this.record().byVariant[variant];
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
    this.update(variant, (mode) => {
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
   * Only called for a deal that was actually played - see the play page. A
   * game dealt, looked at and abandoned without a move is not a loss, because
   * counting it as one would make the record book punish curiosity.
   */
  recordLoss(variant: Variant): void {
    this.update(variant, (mode) => ({
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

  private update(variant: Variant, change: (mode: ModeRecord) => ModeRecord): void {
    const next = this.record();
    const updated: StatsRecord = {
      byVariant: { ...next.byVariant, [variant]: change(next.byVariant[variant]) },
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

function save(record: StatsRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Nothing to do and nothing worth saying: the game is still playable
    // without a record of it.
  }
}
