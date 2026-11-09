import { describe, expect, it } from 'vitest';
import {
  ALL_VARIANTS, GameResult, RECENT_WINDOW, VARIANT_GROUPS, VARIANT_LABELS, Variant,
  ModeRecord, mergeRecent, pushResult, rollingRecord, summarize, variantOf,
} from './stats';
import { GameId } from './game/table-game';

// The record book's shape, checked rather than trusted.
//
// Every one of these held once and stopped holding when a game was added:
// seven games were being recorded and shown nowhere, because the page named
// its four by hand. A list that has to be complete should be checked by
// something that fails.
describe('the record book', () => {
  it('shows every variant it keeps, in exactly one place', () => {
    const shown = VARIANT_GROUPS.flatMap((group) => group.variants);
    expect([...shown].sort()).toEqual([...ALL_VARIANTS].sort());
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('has a label for every variant', () => {
    for (const variant of ALL_VARIANTS) {
      expect(VARIANT_LABELS[variant as Variant]).toBeTruthy();
    }
  });

  it('files every game under a variant it keeps', () => {
    const games: GameId[] = [
      'klondike', 'freecell', 'yukon', 'canfield', 'spider', 'spiderette', 'scorpion', 'seahaven',
      'tripeaks', 'pyramid', 'golf', 'acesup',
    ];
    for (const game of games) {
      expect(ALL_VARIANTS).toContain(variantOf(game, 1));
      expect(ALL_VARIANTS).toContain(variantOf(game, 3));
    }
  });

  it('keeps Spider\'s suits apart, and Spiderette out of Spider', () => {
    expect([1, 2, 4].map((n) => variantOf('spider', 1, n as 1 | 2 | 4))).toEqual(['spider-1', 'spider-2', 'spider-4']);
    expect(variantOf('spiderette', 1, 4)).toBe('spiderette');
  });

  // Klondike is two games and Spider three; everything else is one.
  it('keeps draw-one and draw-three apart, and only those', () => {
    expect(variantOf('klondike', 1)).toBe('klondike-1');
    expect(variantOf('klondike', 3)).toBe('klondike-3');
    expect(variantOf('golf', 3)).toBe('golf');
    expect(VARIANT_GROUPS.filter((g) => g.variants.length > 1).map((g) => g.title))
      .toEqual(['Klondike', 'Spider']);
  });

  // Only the two games that have a score get a row for one.
  it('marks exactly the two scored games as scored', () => {
    expect(VARIANT_GROUPS.filter((g) => g.scored).map((g) => g.title))
      .toEqual(['Klondike', 'Tri Peaks']);
  });
});

describe('the rolling record', () => {
  const win = (seconds: number, moves = 50, score = 0): GameResult =>
    ({ won: true, seconds, moves, score });
  const loss: GameResult = { won: false, seconds: 0, moves: 0, score: 0 };

  it('keeps only the newest hundred games', () => {
    let window: GameResult[] = [];
    for (let i = 1; i <= RECENT_WINDOW + 5; i++) window = pushResult(window, win(i));
    expect(window).toHaveLength(RECENT_WINDOW);
    expect(window[0].seconds).toBe(6);
    expect(window.at(-1)!.seconds).toBe(RECENT_WINDOW + 5);
  });

  it('adds a window up the same way the totals are kept', () => {
    const mode = summarize([win(120, 80, 500), loss, win(90, 100, 300), win(150, 60, 700), loss, win(100)]);
    expect(mode.played).toBe(6);
    expect(mode.won).toBe(4);
    expect(mode.bestSeconds).toBe(90);
    expect(mode.fewestMoves).toBe(50);
    expect(mode.bestScore).toBe(700);
    expect(mode.totalSeconds).toBe(460);
    expect(mode.bestStreak).toBe(2);
    expect(mode.currentStreak).toBe(1);
  });

  it('forgets a best once it falls out of the window', () => {
    let window = pushResult([], win(30));
    for (let i = 0; i < RECENT_WINDOW; i++) window = pushResult(window, win(200));
    expect(summarize(window).bestSeconds).toBe(200);
  });

  it('reads back only what looks like a game', () => {
    expect(mergeRecent(undefined)).toEqual([]);
    expect(mergeRecent('nope')).toEqual([]);
    expect(mergeRecent([null, { won: 'yes' }, { won: true, seconds: -4, moves: 'x', score: 9.7 }]))
      .toEqual([{ won: true, seconds: 0, moves: 0, score: 9 }]);
    expect(mergeRecent(Array.from({ length: 150 }, () => loss))).toHaveLength(RECENT_WINDOW);
  });
});

describe('the rolling record, before it is full', () => {
  const lifetime = (extra: Partial<ModeRecord>): ModeRecord => ({
    played: 0, won: 0, bestScore: 0, bestSeconds: 0, fewestMoves: 0,
    totalSeconds: 0, currentStreak: 0, bestStreak: 0, ...extra,
  });

  it('fills an empty window from the totals rather than showing zeros', () => {
    const mode = rollingRecord(
      lifetime({ played: 300, won: 120, totalSeconds: 120 * 200, bestSeconds: 95,
        fewestMoves: 70, bestScore: 900, currentStreak: 3, bestStreak: 8 }),
      [],
    );
    expect(mode).toEqual({ played: 100, won: 40, totalSeconds: 8000, bestSeconds: 95,
      fewestMoves: 70, bestScore: 900, currentStreak: 3, bestStreak: 8 });
  });

  it('uses every old game when there are fewer than a hundred', () => {
    const mode = rollingRecord(lifetime({ played: 10, won: 5, totalSeconds: 500 }), []);
    expect(mode.played).toBe(10);
    expect(mode.won).toBe(5);
  });

  it('mixes real games with the older averages', () => {
    // 200 old games at 50%, then 20 real ones all lost: 80 filler games at 50%.
    const recent: GameResult[] = Array.from({ length: 20 }, () =>
      ({ won: false, seconds: 0, moves: 0, score: 0 }));
    const mode = rollingRecord(lifetime({ played: 220, won: 100 }), recent);
    expect(mode.played).toBe(100);
    expect(mode.won).toBe(40);
  });

  it('is only the window once the window is full', () => {
    const recent = Array.from({ length: RECENT_WINDOW }, (_, i) =>
      ({ won: i % 2 === 0, seconds: 100, moves: 90, score: 0 }));
    const mode = rollingRecord(lifetime({ played: 500, won: 500, bestSeconds: 10 }), recent);
    expect(mode).toEqual(summarize(recent));
  });
});

describe('the rolling record never contradicts itself', () => {
  const lifetime = (extra: Partial<ModeRecord>): ModeRecord => ({
    played: 0, won: 0, bestScore: 0, bestSeconds: 0, fewestMoves: 0,
    totalSeconds: 0, currentStreak: 0, bestStreak: 0, ...extra,
  });
  const loss: GameResult = { won: false, seconds: 0, moves: 0, score: 0 };

  it('takes no bests or streak from filler that rounds to no wins', () => {
    const recent = Array.from({ length: 95 }, () => loss);
    const mode = rollingRecord(
      lifetime({ played: 295, won: 10, totalSeconds: 1000, bestSeconds: 60, fewestMoves: 40, bestStreak: 8 }),
      recent,
    );
    expect(mode.won).toBe(0);
    expect(mode.bestStreak).toBe(0);
    expect(mode.bestSeconds).toBe(0);
    expect(mode.fewestMoves).toBe(0);
  });

  it('counts the wins a running streak proves are in the filler', () => {
    const mode = rollingRecord(lifetime({ played: 300, won: 3, totalSeconds: 300, currentStreak: 3, bestStreak: 3 }), []);
    expect(mode.currentStreak).toBe(3);
    expect(mode.won).toBeGreaterThanOrEqual(3);
    expect(mode.bestStreak).toBeLessThanOrEqual(mode.won);
  });

  it('caps a best streak at the wins shown', () => {
    const mode = rollingRecord(lifetime({ played: 1000, won: 100, totalSeconds: 10000, bestStreak: 40 }), []);
    expect(mode.won).toBe(10);
    expect(mode.bestStreak).toBe(10);
  });
});
