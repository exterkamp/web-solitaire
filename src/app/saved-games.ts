import { Injectable, inject } from '@angular/core';
import { DrawCount } from './game/klondike';
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
  savedAt: number;
  // For the setup page's "move 34 · 4:12", without reading the state.
  moves: number;
  snapshot: SessionSnapshot<unknown>;
}

/** Nertz is a match rather than a session, and keeps whatever its board says. */
export interface SavedNertz {
  savedAt: number;
  round: number;
  totals: [number, number];
  match: unknown;
}

const PREFIX = 'solitaire.saved.v1.';

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
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
    if (!saved || saved.game !== game || typeof saved.snapshot?.state !== 'object' || !Array.isArray(saved.snapshot.history)) {
      return undefined;
    }
    return saved;
  }

  save(saved: SavedGame): void {
    if (write(saved.game, saved)) return;
    // Out of room: keep the game and give up its undo, which is the part
    // nobody misses if they never knew it was there.
    write(saved.game, { ...saved, snapshot: { ...saved.snapshot, history: [] } });
  }

  clear(game: GameId): void {
    remove(game);
  }

  /** Deals over a saved game: it goes in the record book as a loss. */
  abandon(game: GameId): void {
    const saved = this.get(game);
    if (saved && saved.moves > 0) this.stats.recordLoss(variantOf(game, saved.drawCount));
    this.clear(game);
  }

  getNertz(): SavedNertz | undefined {
    const saved = read<SavedNertz>('nertz');
    return saved && typeof saved.match === 'object' && saved.match ? saved : undefined;
  }

  saveNertz(saved: SavedNertz): void {
    write('nertz', saved);
  }

  clearNertz(): void {
    remove('nertz');
  }
}
