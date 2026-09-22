import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import {
  BOARD_SIZE,
  COVERED_BY,
  PEAK_BONUS,
  POSITIONS,
  TriPeaksState,
  apply,
  autoTarget,
  canDrop,
  cardsLeft,
  deal,
  hasWon,
  isDeadEnd,
  isNeighbour,
  isUncovered,
  legalMoves,
  liftable,
} from './tripeaks';
import { seeded } from './random';

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

// A board with only the positions named holding cards. Everything else is
// already taken, which is how a rigged TriPeaks position is written: the game
// is about what is still there.
function board(
  cards: Record<number, Card>, rest: Partial<TriPeaksState> = {},
): TriPeaksState {
  return {
    board: Array.from({ length: BOARD_SIZE }, (_, i) => (cards[i] ? [cards[i]] : [])),
    stock: [],
    waste: [card('7', 'spades')],
    score: 0,
    run: 0,
    moves: 0,
    ...rest,
  };
}

const at = (index: number): PileRef => ({ kind: 'tableau', index });
const waste: PileRef = { kind: 'waste', index: 0 };

describe('the shape of the board', () => {
  it('is twenty-eight cards in four rows', () => {
    expect(BOARD_SIZE).toBe(28);
    const rows = POSITIONS.reduce<number[]>((counts, p) => {
      counts[p.row] = (counts[p.row] ?? 0) + 1;
      return counts;
    }, []);
    expect(rows).toEqual([3, 6, 9, 10]);
  });

  it('covers every card but the base row with exactly two others', () => {
    POSITIONS.forEach((pos, i) => {
      expect(COVERED_BY[i]).toHaveLength(pos.row === 3 ? 0 : 2);
    });
  });

  it('covers each card with the two below it, half a card to either side', () => {
    // The three peaks are the first three positions, and each sits on the two
    // cards under it - which is the whole reason a peak takes three moves to
    // open rather than one.
    const covers = COVERED_BY[0].map((i) => POSITIONS[i]);
    expect(covers).toEqual([{ row: 1, x: 2 }, { row: 1, x: 4 }]);
  });
});

describe('deal', () => {
  it('lays twenty-eight on the peaks and leaves the rest as a deck', () => {
    const state = deal(seeded(4));
    expect(cardsLeft(state)).toBe(28);
    expect(state.stock).toHaveLength(23);
    expect(state.waste).toHaveLength(1);
    const all = [...state.board.flat(), ...state.stock, ...state.waste];
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });

  it('turns up the base row and nothing above it', () => {
    const state = deal(seeded(4));
    state.board.forEach((pile, i) => {
      expect(pile[0].faceUp).toBe(POSITIONS[i].row === 3);
    });
    expect(state.waste[0].faceUp).toBe(true);
    expect(state.stock.every((c) => !c.faceUp)).toBe(true);
  });

  it('deals the same game twice from the same seed', () => {
    const ids = (s: TriPeaksState) => s.board.flat().map((c) => c.id).join();
    expect(ids(deal(seeded(2)))).toBe(ids(deal(seeded(2))));
    expect(ids(deal(seeded(2)))).not.toBe(ids(deal(seeded(3))));
  });
});

describe('what can be taken', () => {
  it('takes a card one rank either side of the one face up', () => {
    const state = board({ 18: card('6', 'hearts'), 19: card('8', 'clubs') });
    expect(canDrop(state, [card('6', 'hearts')], waste)).toBe(true);
    expect(canDrop(state, [card('8', 'clubs')], waste)).toBe(true);
    expect(canDrop(state, [card('9', 'clubs')], waste)).toBe(false);
  });

  it('treats the ranks as a ring, so an ace follows a king', () => {
    expect(isNeighbour(card('A', 'spades'), card('K', 'hearts'))).toBe(true);
    expect(isNeighbour(card('K', 'spades'), card('A', 'hearts'))).toBe(true);
    expect(isNeighbour(card('A', 'spades'), card('2', 'hearts'))).toBe(true);
    expect(isNeighbour(card('A', 'spades'), card('3', 'hearts'))).toBe(false);
  });

  it('will not take a card that is still covered', () => {
    // Position 9 is in row two; the two base cards on top of it are still there.
    const covered = COVERED_BY[9];
    const state = board({
      9: card('6', 'hearts'),
      [covered[0]]: card('K', 'clubs'),
      [covered[1]]: card('K', 'diamonds'),
    });
    expect(isUncovered(state, 9)).toBe(false);
    expect(liftable(state, at(9), 1)).toBeUndefined();
  });

  it('takes it once both coverers have gone', () => {
    const state = board({ 9: card('6', 'hearts') });
    expect(isUncovered(state, 9)).toBe(true);
    expect(liftable(state, at(9), 1)?.map((c) => c.id)).toEqual(['hearts-6']);
  });

  it('will not take a card that is still face down', () => {
    const state = board({ 9: card('6', 'hearts', false) });
    expect(liftable(state, at(9), 1)).toBeUndefined();
  });

  it('cannot be played from the waste or the deck', () => {
    const state = board({ 18: card('6', 'hearts') }, { stock: [card('2', 'clubs', false)] });
    expect(liftable(state, waste, 1)).toBeUndefined();
    expect(liftable(state, { kind: 'stock', index: 0 }, 1)).toBeUndefined();
  });
});

describe('taking a card', () => {
  it('moves it to the waste and scores the run', () => {
    const state = board({ 18: card('6', 'hearts'), 19: card('5', 'clubs') });
    const first = apply(state, { kind: 'play', from: at(18), to: waste, count: 1 })!;
    expect(first.state.waste.at(-1)?.id).toBe('hearts-6');
    expect(first.state.board[18]).toEqual([]);
    expect(first.points).toBe(1);

    // The second card of a run is worth two, the third three.
    const second = apply(first.state, { kind: 'play', from: at(19), to: waste, count: 1 })!;
    expect(second.points).toBe(2);
    expect(second.state.score).toBe(3);
    expect(second.state.run).toBe(2);
  });

  it('turns over what it uncovers', () => {
    const covered = COVERED_BY[9];
    const state = board({
      9: card('6', 'hearts', false),
      [covered[0]]: card('8', 'clubs'),
    });
    // The other coverer is already gone, so taking this one exposes the six.
    const result = apply(state, { kind: 'play', from: at(covered[0]), to: waste, count: 1 })!;
    expect(result.flipped?.id).toBe('hearts-6');
    expect(result.state.board[9][0].faceUp).toBe(true);
  });

  it('pays a bonus for clearing a peak', () => {
    const state = board({ 0: card('6', 'hearts') });
    const result = apply(state, { kind: 'play', from: at(0), to: waste, count: 1 })!;
    expect(result.points).toBe(1 + PEAK_BONUS);
  });

  it('refuses a card that does not fit, and changes nothing', () => {
    const state = board({ 18: card('10', 'hearts') });
    expect(apply(state, { kind: 'play', from: at(18), to: waste, count: 1 })).toBeUndefined();
    expect(state.board[18]).toHaveLength(1);
  });
});

describe('turning the deck', () => {
  it('lays the next card face up and ends the run', () => {
    const state = board({ 18: card('6', 'hearts') }, { stock: [card('2', 'clubs', false)], run: 4 });
    const result = apply(state, { kind: 'draw' })!;
    expect(result.state.waste.at(-1)?.id).toBe('clubs-2');
    expect(result.state.waste.at(-1)?.faceUp).toBe(true);
    expect(result.state.run).toBe(0);
    expect(result.points).toBe(0);
  });

  it('refuses when the deck is done', () => {
    expect(apply(board({ 18: card('6', 'hearts') }), { kind: 'draw' })).toBeUndefined();
  });

  it('starts the next run from one again', () => {
    const state = board({ 18: card('3', 'clubs') }, { stock: [card('2', 'clubs', false)], run: 9 });
    const drawn = apply(state, { kind: 'draw' })!.state;
    const taken = apply(drawn, { kind: 'play', from: at(18), to: waste, count: 1 })!;
    expect(taken.points).toBe(1);
  });
});

describe('the end of a game', () => {
  it('is won when the peaks are bare', () => {
    expect(hasWon(board({}))).toBe(true);
    expect(hasWon(board({ 18: card('6', 'hearts') }))).toBe(false);
  });

  it('is over when nothing fits and the deck is empty', () => {
    const stuck = board({ 18: card('10', 'hearts'), 19: card('2', 'clubs') });
    expect(legalMoves(stuck)).toEqual([]);
    expect(isDeadEnd(stuck)).toBe(true);
  });

  it('is not over while there is a card left to turn', () => {
    const state = board({ 18: card('10', 'hearts') }, { stock: [card('9', 'clubs', false)] });
    expect(isDeadEnd(state)).toBe(false);
  });

  it('has no finish to play out, and says so', () => {
    const state = board({ 18: card('6', 'hearts') });
    expect(autoTarget(state, at(18))).toEqual(waste);
    expect(autoTarget(state, at(19))).toBeUndefined();
  });
});
