import { describe, expect, it } from 'vitest';
import {
  ALL_VARIANTS, GameResult, RECENT_WINDOW, VARIANT_GROUPS, VARIANT_LABELS, Variant,
  mergeRecent, pushResult, summarize, variantOf,
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
      'klondike', 'freecell', 'yukon', 'canfield', 'spiderette', 'scorpion', 'seahaven',
      'tripeaks', 'pyramid', 'golf', 'acesup',
    ];
    for (const game of games) {
      expect(ALL_VARIANTS).toContain(variantOf(game, 1));
      expect(ALL_VARIANTS).toContain(variantOf(game, 3));
    }
  });

  // Klondike is two games and is recorded as two; everything else is one.
  it('keeps draw-one and draw-three apart, and only those', () => {
    expect(variantOf('klondike', 1)).toBe('klondike-1');
    expect(variantOf('klondike', 3)).toBe('klondike-3');
    expect(variantOf('golf', 3)).toBe('golf');
    expect(VARIANT_GROUPS.filter((g) => g.variants.length > 1).map((g) => g.title))
      .toEqual(['Klondike']);
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
