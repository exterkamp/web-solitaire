import { Injectable, inject } from '@angular/core';
import { DrawCount } from './game/klondike';
import { SuitCount, asSuitCount } from './game/spider';
import { SessionSnapshot } from './game/session';
import { GameId } from './game/table-game';
import { Stats, variantOf } from './stats';

// Games in progress, kept on this device so a reload or a trip to the menu
// does not throw a hand away.
//
// One per game, each under its own key: a saved Klondike is rewritten on
// every move, and has no business rewriting a saved FreeCell alongside it.
// Written as each move lands rather than on the way out, because the way out
// of a phone browser is often the system killing the tab, and nothing runs
// then.
//
// A saved game is a game that has not ended, so it is not in the record book
// yet. It goes in as a loss only when somebody deals over it - the same rule
// as walking away from a board used to be, applied at the moment the hand is
// actually given up rather than the moment the page was left.

export interface SavedGame {
  game: GameId;
  // The rules it was dealt under. Klondike's draw can be changed on the setup
  // page while a game is saved, and the saved game keeps its own.
  drawCount: DrawCount;
  // And Spider's suits, the same way. Absent for every other game.
  suits?: SuitCount;
  savedAt: number;
  // For the setup page's "move 34 · 4:12", without reading the state.
  moves: number;
  // The hand was won and then undone back into play. Its win is in the
  // record book already, so dealing over it is not also a loss.
  counted?: boolean;
  snapshot: SessionSnapshot<unknown>;
}

/** What the menu needs to know of a saved game, without its states. */
export interface SavedSummary {
  moves: number;
}

/** Nertz is a match rather than a session, and keeps whatever its board says. */
export interface SavedNertz {
  savedAt: number;
  round: number;
  totals: [number, number];
  match: unknown;
}

const PREFIX = 'solitaire.saved.v1.';
// Alongside each saved game, the little the menu shows of it - so the menu
// draws its twelve tiles without reading and parsing twelve undo histories.
const SUMMARY = '.summary';

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function has(key: string): boolean {
  try {
    return localStorage.getItem(PREFIX + key) !== null;
  } catch {
    return false;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Storage that cannot be written cannot be holding anything stale either.
  }
}

@Injectable({ providedIn: 'root' })
export class SavedGames {
  private readonly stats = inject(Stats);

  get(game: GameId): SavedGame | undefined {
    const saved = read<SavedGame>(game);
    // Anything that is not recognisably a game of this one is not offered:
    // a half-written or older shape would deal a board that cannot be played.
    if (
      !saved || saved.game !== game || (saved.drawCount !== 1 && saved.drawCount !== 3) ||
      typeof saved.moves !== 'number' || typeof saved.snapshot?.state !== 'object' ||
      !saved.snapshot.state || !Array.isArray(saved.snapshot.history)
    ) {
      return undefined;
    }
    return saved;
  }

  /** The menu's view of a saved game: there is one, and how far in. */
  summary(game: GameId): SavedSummary | undefined {
    if (!has(game)) return undefined;
    const summary = read<SavedSummary>(game + SUMMARY);
    if (summary && typeof summary.moves === 'number') return summary;
    // Saved before summaries were kept: read it the long way, once, and
    // leave the summary behind for next time.
    const saved = this.get(game);
    if (!saved) return undefined;
    write(game + SUMMARY, { moves: saved.moves } satisfies SavedSummary);
    return { moves: saved.moves };
  }

  save(saved: SavedGame): void {
    // Out of room, the game is kept without its undo, which is the part
    // nobody misses if they never knew it was there. If even that will not
    // go, the older save comes off: a game that comes back is the game that
    // was left, or none at all - never a position from twenty moves ago.
    const kept = write(saved.game, saved) || write(saved.game, { ...saved, snapshot: { ...saved.snapshot, history: [] } });
    if (!kept) {
      this.clear(saved.game);
      return;
    }
    write(saved.game + SUMMARY, { moves: saved.moves } satisfies SavedSummary);
  }

  clear(game: GameId): void {
    remove(game);
    remove(game + SUMMARY);
  }

  /** Deals over a saved game: it goes in the record book as a loss. */
  abandon(game: GameId): void {
    const saved = this.get(game);
    if (saved && saved.moves > 0 && !saved.counted) this.stats.recordLoss(variantOf(game, saved.drawCount, asSuitCount(saved.suits)));
    this.clear(game);
  }

  getNertz(): SavedNertz | undefined {
    const saved = read<SavedNertz>('nertz');
    return saved && typeof saved.match === 'object' && saved.match ? saved : undefined;
  }

  saveNertz(saved: SavedNertz): void {
    if (!write('nertz', saved)) this.clearNertz();
  }

  clearNertz(): void {
    remove('nertz');
  }
}

/**
 * Keeps a game written down while it is played: a beat after each change,
 * and at once whenever the page is hidden or left. Hidden matters as much as
 * left - a phone's browser sent to the background may be killed there without
 * ever firing pagehide, so the last chance to save is the moment it is
 * hidden. One of these per play page; `save` decides what is worth keeping.
 */
export class Autosave {
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly save: () => void, private readonly delay = 250) {
    window.addEventListener('pagehide', this.now);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Something changed: save shortly, once things have settled. */
  soon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(this.now, this.delay);
  }

  /** Save now, and cancel any save that was waiting. */
  readonly now = (): void => {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.save();
  };

  /** A last save, and no more listening. */
  dispose(): void {
    window.removeEventListener('pagehide', this.now);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.now();
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.now();
  };
}
