import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import {
  FREE_PASSES_DRAW_THREE,
  GameState,
  PileRef,
  SCORE_FOUNDATION_TO_TABLEAU,
  SCORE_RECYCLE_DRAW_ONE,
  SCORE_RECYCLE_DRAW_THREE,
  SCORE_TO_FOUNDATION,
  SCORE_TURN_OVER,
  SCORE_WASTE_TO_TABLEAU,
  apply,
  autoFinishMove,
  autoTarget,
  canAutoFinish,
  canDrop,
  canPlaceOnFoundation,
  canPlaceOnTableau,
  deal,
  hasWon,
  isMovableRun,
  legalMoves,
  liftable,
  timeBonus,
} from './klondike';
import { seeded } from './random';
import { Solitaire } from './session';

// A card by name, face up unless said otherwise. The tests read as positions
// on a table rather than as object literals, which is the only way a rules
// test stays checkable by eye.
function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

// An empty board to put cards onto. Every test here starts from a rigged
// position rather than from a deal: a deal is the one thing that cannot be
// arranged, so testing the rules through one would mean testing whatever
// this week's shuffle happened to produce.
function board(partial: Partial<GameState> = {}): GameState {
  return {
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    score: 0,
    moves: 0,
    passes: 0,
    drawCount: 1,
    ...partial,
  };
}

const tableau = (index: number): PileRef => ({ kind: 'tableau', index });
const foundation = (index: number): PileRef => ({ kind: 'foundation', index });
const waste: PileRef = { kind: 'waste', index: 0 };

describe('deal', () => {
  it('lays seven piles with only their top cards turned up', () => {
    const state = deal(1, seeded(7));
    expect(state.tableau.map((pile) => pile.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const pile of state.tableau) {
      expect(pile.filter((c) => c.faceUp)).toHaveLength(1);
      expect(pile[pile.length - 1].faceUp).toBe(true);
    }
  });

  it('leaves the rest of the deck as a face-down stock', () => {
    const state = deal(3, seeded(7));
    expect(state.stock).toHaveLength(24);
    expect(state.stock.every((c) => !c.faceUp)).toBe(true);
    expect(state.waste).toEqual([]);
  });

  it('deals all fifty-two cards exactly once', () => {
    const state = deal(1, seeded(99));
    const ids = [...state.stock, ...state.tableau.flat()].map((c) => c.id);
    expect(new Set(ids).size).toBe(52);
  });

  it('deals the same game twice from the same seed', () => {
    const ids = (state: GameState) => state.tableau.flat().map((c) => c.id).join();
    expect(ids(deal(1, seeded(4)))).toBe(ids(deal(1, seeded(4))));
    expect(ids(deal(1, seeded(4)))).not.toBe(ids(deal(1, seeded(5))));
  });
});

describe('placement', () => {
  it('starts a foundation with an ace and continues it in suit', () => {
    expect(canPlaceOnFoundation(card('A', 'hearts'), [])).toBe(true);
    expect(canPlaceOnFoundation(card('2', 'hearts'), [])).toBe(false);
    expect(canPlaceOnFoundation(card('2', 'hearts'), [card('A', 'hearts')])).toBe(true);
    expect(canPlaceOnFoundation(card('2', 'diamonds'), [card('A', 'hearts')])).toBe(false);
    expect(canPlaceOnFoundation(card('3', 'hearts'), [card('A', 'hearts')])).toBe(false);
  });

  it('starts a tableau pile with a king and continues it in alternating colour', () => {
    expect(canPlaceOnTableau(card('K', 'spades'), [])).toBe(true);
    expect(canPlaceOnTableau(card('Q', 'spades'), [])).toBe(false);
    expect(canPlaceOnTableau(card('Q', 'hearts'), [card('K', 'spades')])).toBe(true);
    expect(canPlaceOnTableau(card('Q', 'spades'), [card('K', 'clubs')])).toBe(false);
    expect(canPlaceOnTableau(card('J', 'hearts'), [card('K', 'spades')])).toBe(false);
  });

  it('refuses to build on a card that is still face down', () => {
    expect(canPlaceOnTableau(card('Q', 'hearts'), [card('K', 'spades', false)])).toBe(false);
  });
});

describe('lifting a run', () => {
  const run = [card('9', 'hearts'), card('8', 'spades'), card('7', 'diamonds')];

  it('accepts a descending alternating run', () => {
    expect(isMovableRun(run, 0)).toBe(true);
    expect(isMovableRun(run, 1)).toBe(true);
  });

  it('rejects a run that repeats a colour or skips a rank', () => {
    expect(isMovableRun([card('9', 'hearts'), card('8', 'diamonds')], 0)).toBe(false);
    expect(isMovableRun([card('9', 'hearts'), card('7', 'spades')], 0)).toBe(false);
  });

  it('rejects anything reaching into the face-down part of a pile', () => {
    const pile = [card('K', 'clubs', false), ...run];
    expect(isMovableRun(pile, 0)).toBe(false);
    expect(isMovableRun(pile, 1)).toBe(true);
  });

  it('gives up only the top card of the waste and of a foundation', () => {
    const state = board({
      waste: [card('3', 'clubs'), card('4', 'hearts')],
      foundations: [[card('A', 'spades'), card('2', 'spades')], [], [], []],
    });
    expect(liftable(state, waste, 1)?.map((c) => c.id)).toEqual(['hearts-4']);
    expect(liftable(state, waste, 2)).toBeUndefined();
    expect(liftable(state, foundation(0), 1)?.map((c) => c.id)).toEqual(['spades-2']);
    expect(liftable(state, foundation(0), 2)).toBeUndefined();
  });

  it('never gives up a card from the stock', () => {
    const state = board({ stock: [card('5', 'clubs', false)] });
    expect(liftable(state, { kind: 'stock', index: 0 }, 1)).toBeUndefined();
  });
});

describe('dropping', () => {
  it('sends a card only to its own suit’s foundation', () => {
    const state = board();
    expect(canDrop(state, [card('A', 'hearts')], foundation(1))).toBe(true);
    expect(canDrop(state, [card('A', 'hearts')], foundation(2))).toBe(false);
  });

  it('refuses a run on a foundation, however well it fits', () => {
    const state = board({ foundations: [[card('A', 'spades')], [], [], []] });
    expect(canDrop(state, [card('2', 'spades'), card('3', 'spades')], foundation(0))).toBe(false);
  });

  it('refuses the stock and the waste as destinations', () => {
    const state = board();
    expect(canDrop(state, [card('A', 'hearts')], { kind: 'stock', index: 0 })).toBe(false);
    expect(canDrop(state, [card('A', 'hearts')], waste)).toBe(false);
  });
});

describe('drawing', () => {
  it('turns one card at a time in draw-one', () => {
    const state = board({ stock: [card('2', 'clubs', false), card('3', 'clubs', false)] });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.drawn?.map((c) => c.id)).toEqual(['clubs-3']);
    expect(result.state.waste.at(-1)?.faceUp).toBe(true);
    expect(result.state.stock).toHaveLength(1);
  });

  it('turns three at a time in draw-three, and fewer when fewer are left', () => {
    const three = [card('2', 'clubs', false), card('3', 'clubs', false), card('4', 'clubs', false)];
    expect(apply(board({ stock: three, drawCount: 3 }), { kind: 'draw' })!.drawn).toHaveLength(3);
    // The last turn of a pass is short rather than refused - a stock of two
    // is two cards, not an illegal draw.
    const two = [card('2', 'clubs', false), card('3', 'clubs', false)];
    const short = apply(board({ stock: two, drawCount: 3 }), { kind: 'draw' })!;
    expect(short.drawn?.map((c) => c.id)).toEqual(['clubs-3', 'clubs-2']);
    expect(short.state.stock).toEqual([]);
  });

  it('turns the waste back into a stock in the order it was laid down', () => {
    const state = board({
      waste: [card('2', 'clubs'), card('3', 'clubs'), card('4', 'clubs')],
    });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.recycled).toBe(true);
    expect(result.state.waste).toEqual([]);
    expect(result.state.stock.every((c) => !c.faceUp)).toBe(true);
    // Drawing again has to hand back the card that was on the bottom of the
    // waste, or the deck comes round in a different order every pass.
    const next = apply(result.state, { kind: 'draw' })!;
    expect(next.drawn?.map((c) => c.id)).toEqual(['clubs-2']);
  });

  it('refuses to draw when there is nothing anywhere', () => {
    expect(apply(board(), { kind: 'draw' })).toBeUndefined();
  });
});

describe('scoring', () => {
  it('pays for a card sent home and for one turned over', () => {
    const state = board({
      tableau: [[card('5', 'hearts', false), card('A', 'spades')], [], [], [], [], [], []],
    });
    const result = apply(state, { kind: 'play', from: tableau(0), to: foundation(0), count: 1 })!;
    expect(result.points).toBe(SCORE_TO_FOUNDATION + SCORE_TURN_OVER);
    expect(result.flipped?.id).toBe('hearts-5');
    expect(result.state.score).toBe(SCORE_TO_FOUNDATION + SCORE_TURN_OVER);
  });

  it('pays less for the waste to the tableau, and charges for a card coming back', () => {
    const state = board({
      waste: [card('Q', 'hearts')],
      tableau: [[card('K', 'spades')], [], [], [], [], [], []],
      foundations: [[card('A', 'spades'), card('2', 'spades')], [], [], []],
      score: 100,
    });
    const placed = apply(state, { kind: 'play', from: waste, to: tableau(0), count: 1 })!;
    expect(placed.points).toBe(SCORE_WASTE_TO_TABLEAU);

    const pulled = apply(
      { ...placed.state, tableau: [[card('3', 'hearts')], [], [], [], [], [], []] },
      { kind: 'play', from: foundation(0), to: tableau(0), count: 1 },
    )!;
    expect(pulled.points).toBe(SCORE_FOUNDATION_TO_TABLEAU);
  });

  it('charges every recycle in draw-one and spares the first two in draw-three', () => {
    const one = board({ waste: [card('2', 'clubs')], score: 500 });
    expect(apply(one, { kind: 'draw' })!.points).toBe(SCORE_RECYCLE_DRAW_ONE);

    const three = board({ waste: [card('2', 'clubs')], score: 500, drawCount: 3 });
    expect(apply(three, { kind: 'draw' })!.points).toBe(0);
    const late = { ...three, passes: FREE_PASSES_DRAW_THREE };
    expect(apply(late, { kind: 'draw' })!.points).toBe(SCORE_RECYCLE_DRAW_THREE);
  });

  it('never drops the score below zero', () => {
    const state = board({ waste: [card('2', 'clubs')], score: 30 });
    expect(apply(state, { kind: 'draw' })!.state.score).toBe(0);
  });

  it('pays a time bonus only for a game that took half a minute', () => {
    expect(timeBonus(20)).toBe(0);
    expect(timeBonus(120)).toBe(5833);
    expect(timeBonus(600)).toBe(1166);
  });
});

describe('illegal moves', () => {
  it('change nothing and answer undefined', () => {
    const state = board({ tableau: [[card('K', 'spades')], [card('9', 'hearts')], [], [], [], [], []] });
    expect(apply(state, { kind: 'play', from: tableau(1), to: tableau(0), count: 1 })).toBeUndefined();
    expect(state.tableau[1]).toHaveLength(1);
  });

  it('include dropping a pile back onto itself', () => {
    const state = board({ tableau: [[card('K', 'spades')], [], [], [], [], [], []] });
    expect(apply(state, { kind: 'play', from: tableau(0), to: tableau(0), count: 1 })).toBeUndefined();
  });
});

describe('tapping a card', () => {
  it('sends it home when it can go home', () => {
    const state = board({ waste: [card('A', 'hearts')] });
    expect(autoTarget(state, waste)).toEqual(foundation(1));
  });

  it('prefers an occupied pile to an empty one', () => {
    const state = board({
      waste: [card('Q', 'hearts')],
      tableau: [[], [card('K', 'spades')], [], [], [], [], []],
    });
    expect(autoTarget(state, waste)).toEqual(tableau(1));
  });

  it('will not move a whole pile to an empty column', () => {
    const state = board({ tableau: [[card('K', 'spades')], [], [], [], [], [], []] });
    expect(autoTarget(state, tableau(0), 1)).toBeUndefined();
  });

  it('answers nothing when there is nowhere to go', () => {
    const state = board({ waste: [card('9', 'hearts')] });
    expect(autoTarget(state, waste)).toBeUndefined();
  });
});

describe('the end of a game', () => {
  const full = (suit: Suit): Card[] =>
    (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as Rank[]).map((r) =>
      card(r, suit),
    );

  it('is won when all four foundations are complete', () => {
    const state = board({
      foundations: [full('spades'), full('hearts'), full('diamonds'), full('clubs')],
    });
    expect(hasWon(state)).toBe(true);
  });

  it('can be finished automatically once nothing is face down', () => {
    const open = board({ tableau: [[card('A', 'spades')], [], [], [], [], [], []] });
    expect(canAutoFinish(open)).toBe(true);
    const hidden = board({
      tableau: [[card('K', 'clubs', false), card('A', 'spades')], [], [], [], [], [], []],
    });
    expect(canAutoFinish(hidden)).toBe(false);
  });

  it('plays the finish one card at a time, and turns the deck when it must', () => {
    const state = board({
      waste: [card('A', 'hearts')],
      tableau: [[card('A', 'spades')], [], [], [], [], [], []],
    });
    const first = autoFinishMove(state)!;
    expect(first).toEqual({ kind: 'play', from: tableau(0), to: foundation(0), count: 1 });

    const stockOnly = board({ stock: [card('A', 'hearts', false)] });
    expect(autoFinishMove(stockOnly)).toEqual({ kind: 'draw' });
    expect(autoFinishMove(board())).toBeUndefined();
  });

  it('knows when there is nothing left to do', () => {
    // Every card face up, nothing that fits anywhere, and no deck to turn.
    const dead = board({
      tableau: [[card('9', 'hearts')], [card('7', 'spades')], [], [], [], [], []],
    });
    expect(legalMoves(dead).filter((m) => m.kind === 'play')).toEqual([]);
  });
});

describe('a game in progress', () => {
  it('does not start its clock until the first move', () => {
    let now = 1000;
    const game = new Solitaire(1, seeded(3), () => now);
    now += 60_000;
    expect(game.elapsed()).toBe(0);
    game.play({ kind: 'draw' });
    now += 30_000;
    expect(game.elapsed()).toBe(30);
  });

  it('steps back exactly one move at a time, cards turned over included', () => {
    const game = new Solitaire(1, seeded(11));
    const before = JSON.stringify(game.state);
    expect(game.canUndo).toBe(false);

    game.play({ kind: 'draw' });
    expect(game.canUndo).toBe(true);
    expect(game.undo()).toBe(true);
    expect(JSON.stringify(game.state)).toBe(before);
    expect(game.undos).toBe(1);
    expect(game.undo()).toBe(false);
  });

  it('keeps an illegal move out of the history', () => {
    const game = new Solitaire(1, seeded(12));
    expect(game.play({ kind: 'play', from: foundation(0), to: tableau(0), count: 1 })).toBeUndefined();
    expect(game.canUndo).toBe(false);
  });
});
