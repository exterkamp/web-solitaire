import '@angular/compiler';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedGame, SavedGames } from './saved-games';
import { Stats } from './stats';

// A storage that can be told it is full, which is the case that matters: a
// save that cannot be written must not leave an older one to be resumed.
function fakeStorage(): Storage & { full: boolean } {
  const items = new Map<string, string>();
  return {
    full: false,
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem(key, value) {
      if (this.full) throw new DOMException('full', 'QuotaExceededError');
      items.set(key, value);
    },
  };
}

function saved(moves: number, extra: Partial<SavedGame> = {}): SavedGame {
  return {
    game: 'klondike', drawCount: 1, savedAt: 0, moves,
    snapshot: { state: { moves }, history: [{ moves: moves - 1 }], undos: 0 },
    ...extra,
  };
}

describe('saved games', () => {
  let storage: ReturnType<typeof fakeStorage>;
  let losses: string[];
  let games: SavedGames;

  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    losses = [];
    const stats = { recordLoss: (variant: string) => losses.push(variant) } as unknown as Stats;
    games = Injector.create({ providers: [{ provide: Stats, useValue: stats }, SavedGames] }).get(SavedGames);
  });

  it('keeps a game, and a summary the menu can read without the game', () => {
    games.save(saved(12));
    expect(games.get('klondike')?.moves).toBe(12);
    expect(games.summary('klondike')).toEqual({ moves: 12 });
    games.clear('klondike');
    expect(games.get('klondike')).toBeUndefined();
    expect(games.summary('klondike')).toBeUndefined();
  });

  it('gives up the undo before the game when space runs short', () => {
    games.save(saved(12));
    // Fails once, for the full save, and then lets the smaller one through.
    const setItem = storage.setItem.bind(storage);
    let first = true;
    storage.setItem = (key, value) => {
      if (first) { first = false; throw new DOMException('full', 'QuotaExceededError'); }
      setItem(key, value);
    };
    games.save(saved(13));
    expect(games.get('klondike')?.moves).toBe(13);
    expect(games.get('klondike')?.snapshot.history).toEqual([]);
  });

  it('drops an older save rather than leave it to be resumed', () => {
    games.save(saved(40));
    storage.full = true;
    games.save(saved(41));
    expect(games.get('klondike')).toBeUndefined();
    expect(games.summary('klondike')).toBeUndefined();
  });

  it('counts a hand dealt over as a loss, but not one already counted as a win', () => {
    games.save(saved(30));
    games.abandon('klondike');
    expect(losses).toEqual(['klondike-1']);
    games.save(saved(30, { counted: true }));
    games.abandon('klondike');
    expect(losses).toEqual(['klondike-1']);
    expect(games.get('klondike')).toBeUndefined();
  });

  it('refuses a save it cannot deal from', () => {
    storage.setItem('solitaire.saved.v1.klondike', JSON.stringify({ ...saved(5), drawCount: 'three' }));
    expect(games.get('klondike')).toBeUndefined();
    storage.setItem('solitaire.saved.v1.klondike', JSON.stringify({ ...saved(5), moves: undefined }));
    expect(games.get('klondike')).toBeUndefined();
    storage.setItem('solitaire.saved.v1.klondike', '{ not json');
    expect(games.get('klondike')).toBeUndefined();
  });

  it('fills in the summary of a game saved before summaries were kept', () => {
    storage.setItem('solitaire.saved.v1.klondike', JSON.stringify(saved(7)));
    expect(games.summary('klondike')).toEqual({ moves: 7 });
    expect(storage.getItem('solitaire.saved.v1.klondike.summary')).not.toBeNull();
  });
});
