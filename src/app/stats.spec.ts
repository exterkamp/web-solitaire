import { describe, expect, it } from 'vitest';
import { ALL_VARIANTS, VARIANT_GROUPS, VARIANT_LABELS, Variant, variantOf } from './stats';
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
