import { describe, expect, it } from 'vitest';
import { Card } from './deck';
import { seeded } from './random';
import {
  Hand, Match, NertzState, addRound, apply, autoTarget, agreeToEnd, bothAgreed, canCallNertz, carryOn, drawRefused, canDrop,
  canPlayOnFoundation, canPlayOnWork, deal, finishRound, foundationFor, liftable,
  matchWinner, newMatch, newTalk, promptShowing, roundScores, tableStuck, talkAfter,
} from './nertz';

let serial = 0;
function card(rank: Card['rank'], suit: Card['suit'], faceUp = true): Card {
  return { id: `t${serial++}-${suit}-${rank}`, rank, suit, faceUp };
}

function hand(partial: Partial<Hand> = {}): Hand {
  return { nertz: [], work: [[], [], [], []], stock: [], waste: [], ...partial };
}

function state(h0: Partial<Hand> = {}, h1: Partial<Hand> = {}, foundations: Card[][] = []): NertzState {
  return {
    hands: [hand(h0), hand(h1)],
    foundations: [...foundations, ...Array.from({ length: 8 - foundations.length }, () => [] as Card[])],
    up: [0, 0],
  };
}

describe('deal', () => {
  const s = deal(4, seeded(1));

  it('gives each player thirteen, four work piles of one, and thirty-five in the stock', () => {
    for (const h of s.hands) {
      expect(h.nertz).toHaveLength(13);
      expect(h.work.map((p) => p.length)).toEqual([1, 1, 1, 1]);
      expect(h.stock).toHaveLength(35);
      expect(h.waste).toHaveLength(0);
    }
    expect(s.foundations).toHaveLength(8);
  });

  it('turns over only the top of the Nertz pile and the work cards', () => {
    const h = s.hands[0];
    expect(h.nertz.map((c) => c.faceUp)).toEqual([...Array(12).fill(false), true]);
    expect(h.work.every((p) => p[0].faceUp)).toBe(true);
    expect(h.stock.some((c) => c.faceUp)).toBe(false);
  });

  it('uses two full decks with no id twice', () => {
    const all = s.hands.flatMap((h) => [...h.nertz, ...h.work.flat(), ...h.stock]);
    expect(all).toHaveLength(104);
    expect(new Set(all.map((c) => c.id)).size).toBe(104);
  });
});

describe.each([[4, 35], [5, 34], [6, 33]])('deal with %i work piles', (workPiles, stock) => {
  const s = deal(workPiles, seeded(2));

  it('gives each player that many work piles of one and the rest in the stock', () => {
    for (const h of s.hands) {
      expect(h.nertz).toHaveLength(13);
      expect(h.work.map((p) => p.length)).toEqual(Array(workPiles).fill(1));
      expect(h.stock).toHaveLength(stock);
    }
  });

  it('accounts for every card', () => {
    const all = s.hands.flatMap((h) => [...h.nertz, ...h.work.flat(), ...h.stock, ...h.waste]);
    expect(all).toHaveLength(104);
    expect(new Set(all.map((c) => c.id)).size).toBe(104);
  });

  it('uses the last work pile as a real pile', () => {
    const last = workPiles - 1;
    const seven = card('7', 'spades');
    const six = card('6', 'hearts');
    const work = Array.from({ length: workPiles }, (_, i) => (i === last ? [seven] : i === 0 ? [six] : []));
    const t = { ...s, hands: [{ ...s.hands[0], work, waste: [], stock: [] }, s.hands[1]] as [Hand, Hand] };
    // The six lands on the seven in the new last pile ...
    expect(autoTarget(t, 0, { kind: 'work', index: 0 }, 1)).toEqual({ kind: 'work', index: last });
    const played = apply(t, { kind: 'play', seat: 0, from: { kind: 'work', index: 0 }, to: { kind: 'work', index: last }, count: 1 });
    expect(played?.state.hands[0].work[last].map((c) => c.rank)).toEqual(['7', '6']);
    // ... and can be lifted from it again.
    expect(liftable(played!.state, 0, { kind: 'work', index: last }, 1)).toEqual([six]);
  });

  it('refuses a work pile the hand does not have', () => {
    expect(liftable(s, 0, { kind: 'work', index: workPiles }, 1)).toBeUndefined();
    expect(canDrop(s, 0, [first(s)], { kind: 'work', index: workPiles })).toBe(false);
  });
});

function first(s: NertzState): Card {
  return s.hands[0].work[0][0];
}

describe('placement', () => {
  it('builds work piles down in alternating colours', () => {
    expect(canPlayOnWork(card('6', 'hearts'), [card('7', 'spades')])).toBe(true);
    expect(canPlayOnWork(card('6', 'hearts'), [card('7', 'diamonds')])).toBe(false);
    expect(canPlayOnWork(card('5', 'hearts'), [card('7', 'spades')])).toBe(false);
    expect(canPlayOnWork(card('K', 'hearts'), [])).toBe(true);
    expect(canPlayOnWork(card('2', 'clubs'), [])).toBe(true);
  });

  it('builds foundations up by suit from the ace', () => {
    expect(canPlayOnFoundation(card('A', 'hearts'), [])).toBe(true);
    expect(canPlayOnFoundation(card('2', 'hearts'), [])).toBe(false);
    expect(canPlayOnFoundation(card('2', 'hearts'), [card('A', 'hearts')])).toBe(true);
    expect(canPlayOnFoundation(card('2', 'spades'), [card('A', 'hearts')])).toBe(false);
    expect(canPlayOnFoundation(card('3', 'hearts'), [card('A', 'hearts')])).toBe(false);
  });

  it('will not lift from a foundation or the stock', () => {
    const s = state({ stock: [card('2', 'clubs', false)] }, {}, [[card('A', 'clubs')]]);
    expect(liftable(s, 0, { kind: 'foundation', index: 0 }, 1)).toBeUndefined();
    expect(liftable(s, 0, { kind: 'stock' }, 1)).toBeUndefined();
  });
});

describe('play', () => {
  it('moves a Nertz card to a foundation, turns the next one over and scores it', () => {
    const ace = card('A', 'spades');
    const s = state({ nertz: [card('9', 'clubs', false), ace] });
    const r = apply(s, { kind: 'play', seat: 0, from: { kind: 'nertz' }, to: { kind: 'foundation', index: 3 }, count: 1 })!;
    expect(r.state.foundations[3]).toEqual([ace]);
    expect(r.state.hands[0].nertz[0].faceUp).toBe(true);
    expect(r.state.up).toEqual([1, 0]);
    // Pure: the old state is untouched.
    expect(s.foundations[3]).toEqual([]);
    expect(s.hands[0].nertz).toHaveLength(2);
  });

  it('moves a run between work piles', () => {
    const s = state({ work: [[card('7', 'spades')], [card('9', 'hearts'), card('8', 'clubs'), card('7', 'diamonds')], [], []] });
    const r = apply(s, { kind: 'play', seat: 0, from: { kind: 'work', index: 1 }, to: { kind: 'work', index: 0 }, count: 1 });
    expect(r).toBeUndefined();
    const ok = apply(
      state({ work: [[card('9', 'spades')], [card('8', 'hearts'), card('7', 'clubs')], [], []] }),
      { kind: 'play', seat: 0, from: { kind: 'work', index: 1 }, to: { kind: 'work', index: 0 }, count: 2 },
    )!;
    expect(ok.state.hands[0].work[0]).toHaveLength(3);
    expect(ok.state.hands[0].work[1]).toHaveLength(0);
    expect(ok.state.up).toEqual([0, 0]);
  });

  it('refuses a run to a foundation, and an illegal drop', () => {
    const s = state({ work: [[card('A', 'hearts'), card('2', 'hearts')], [], [], []] });
    expect(apply(s, { kind: 'play', seat: 0, from: { kind: 'work', index: 0 }, to: { kind: 'foundation', index: 0 }, count: 2 })).toBeUndefined();
    expect(canDrop(s, 0, [card('5', 'hearts')], { kind: 'foundation', index: 0 })).toBe(false);
  });

  it('keeps the two players apart: a seat only touches its own piles', () => {
    const s = state({}, { work: [[card('7', 'spades')], [], [], []] });
    // Seat 0's work pile 0 is empty, so there is nothing for it to lift.
    expect(liftable(s, 0, { kind: 'work', index: 0 }, 1)).toBeUndefined();
    expect(liftable(s, 1, { kind: 'work', index: 0 }, 1)).toHaveLength(1);
  });

  it('settles a race for a foundation: the second card finds it taken', () => {
    const a = card('A', 'hearts');
    const b = card('A', 'hearts');
    let s = state({ waste: [a] }, { waste: [b] });
    // Both want the one open place; the first lands there.
    const first = apply(s, { kind: 'play', seat: 0, from: { kind: 'waste' }, to: { kind: 'foundation', index: 0 }, count: 1 })!;
    s = first.state;
    expect(apply(s, { kind: 'play', seat: 1, from: { kind: 'waste' }, to: { kind: 'foundation', index: 0 }, count: 1 })).toBeUndefined();
    // And the ace finds somewhere else to go.
    expect(foundationFor(s, b)).toBe(1);
  });

  it('does not wedge a card onto a foundation of a different suit or an occupied place', () => {
    const s = state({ waste: [card('A', 'clubs')] }, {}, [[card('A', 'hearts')]]);
    expect(foundationFor(s, s.hands[0].waste[0])).toBe(1);
  });
});

describe('the hand', () => {
  const stock = ['2', '3', '4', '5', '6'].map((r) => card(r as Card['rank'], 'clubs', false));

  it('turns three at a time onto the waste', () => {
    const r = apply(state({ stock }), { kind: 'draw', seat: 0 })!;
    expect(r.state.hands[0].stock).toHaveLength(2);
    expect(r.state.hands[0].waste.map((c) => c.rank)).toEqual(['6', '5', '4']);
    expect(r.state.hands[0].waste.every((c) => c.faceUp)).toBe(true);
  });

  it('turns what is left when fewer than three remain', () => {
    const s = apply(apply(state({ stock }), { kind: 'draw', seat: 0 })!.state, { kind: 'draw', seat: 0 })!.state;
    expect(s.hands[0].stock).toHaveLength(0);
    expect(s.hands[0].waste).toHaveLength(5);
  });

  it('turns the waste over when the stock is gone, in the order it was drawn', () => {
    let s = state({ stock });
    s = apply(s, { kind: 'draw', seat: 0 })!.state;
    s = apply(s, { kind: 'draw', seat: 0 })!.state;
    const r = apply(s, { kind: 'draw', seat: 0 })!;
    expect(r.recycled).toBe(true);
    expect(r.state.hands[0].waste).toHaveLength(0);
    const again = apply(r.state, { kind: 'draw', seat: 0 })!;
    expect(again.state.hands[0].waste.map((c) => c.rank)).toEqual(['6', '5', '4']);
  });

  it('has nothing to draw when both are empty', () => {
    expect(apply(state(), { kind: 'draw', seat: 0 })).toBeUndefined();
  });
});

describe('auto target', () => {
  it('prefers a foundation, then a started work pile, never an empty one', () => {
    const s = state({
      waste: [card('6', 'hearts')],
      work: [[card('7', 'spades')], [], [], []],
    });
    expect(autoTarget(s, 0, { kind: 'waste' }, 1)).toEqual({ kind: 'work', index: 0 });
    const lone = state({ waste: [card('6', 'hearts')], work: [[], [], [], []] });
    expect(autoTarget(lone, 0, { kind: 'waste' }, 1)).toBeUndefined();
    const ace = state({ waste: [card('A', 'hearts')] });
    expect(autoTarget(ace, 0, { kind: 'waste' }, 1)).toEqual({ kind: 'foundation', index: 0 });
  });
});

describe('stuck', () => {
  const blocked = (extra: Partial<Hand> = {}) => ({
    nertz: [card('Q', 'clubs')],
    work: [[card('9', 'hearts')], [card('9', 'diamonds')], [card('9', 'clubs')], [card('9', 'spades')]],
    ...extra,
  });
  const turn = (seat: 0 | 1) => ({ kind: 'draw', seat }) as const;

  it('is stuck with nothing that fits among the cards showing', () => {
    expect(tableStuck(state(blocked(), blocked()))).toBe(true);
  });

  it('is not stuck while either player has a move showing', () => {
    expect(tableStuck(state(blocked({ waste: [card('8', 'clubs')] }), blocked()))).toBe(false);
    expect(tableStuck(state(blocked(), blocked({ waste: [card('8', 'clubs')] })))).toBe(false);
  });

  it('is not stuck with a gap to fill', () => {
    const gap = blocked({ work: [[], [card('9', 'diamonds')], [card('9', 'clubs')], [card('9', 'spades')]] });
    expect(tableStuck(state(gap, blocked()))).toBe(false);
  });

  it('prompts once each hand has been turned through, and not before', () => {
    const hands = () => blocked({ stock: [card('K', 'clubs', false), card('K', 'hearts', false), card('K', 'spades', false)] });
    let s = state(hands(), hands());
    let talk = newTalk();
    expect(promptShowing(s, talk)).toBe(false);
    for (const seat of [0, 1] as const) {
      const r = apply(s, turn(seat))!;
      s = r.state;
      talk = talkAfter(talk, s, turn(seat), r.recycled === true);
    }
    // Both stocks are now empty: three cards turned, none left to draw.
    expect(promptShowing(s, talk)).toBe(true);
  });

  it('carry on hides the prompt, and turning a hand over brings it back', () => {
    const hands = () => blocked({ stock: [card('K', 'clubs', false)] });
    let s = state(hands(), hands());
    let talk = newTalk();
    for (const seat of [0, 1] as const) {
      const r = apply(s, turn(seat))!;
      s = r.state;
      talk = talkAfter(talk, s, turn(seat), r.recycled === true);
    }
    expect(promptShowing(s, talk)).toBe(true);
    talk = carryOn();
    expect(promptShowing(s, talk)).toBe(false);
    // A draw with an empty stock recycles the waste: the round is not stranded.
    const r = apply(s, turn(0))!;
    expect(r.recycled).toBe(true);
    talk = talkAfter(talk, r.state, turn(0), true);
    expect(promptShowing(r.state, talk)).toBe(true);
  });

  it('carry on with both hands empty: reaching for the hand brings the prompt back', () => {
    const s = state(blocked(), blocked());
    expect(apply(s, turn(0))).toBeUndefined();
    let talk = carryOn();
    expect(promptShowing(s, talk)).toBe(false);
    talk = drawRefused(talk);
    expect(promptShowing(s, talk)).toBe(true);
  });

  it('a played card starts the conversation over', () => {
    const talk = carryOn();
    const after = talkAfter(talk, state(), { kind: 'play', seat: 0, from: { kind: 'waste' }, to: { kind: 'foundation', index: 0 }, count: 1 }, false);
    expect(after).toEqual(newTalk());
  });

  it('ends the round only when both agree', () => {
    let talk = agreeToEnd(newTalk(), 0);
    expect(bothAgreed(talk)).toBe(false);
    talk = agreeToEnd(talk, 1);
    expect(bothAgreed(talk)).toBe(true);
    expect(bothAgreed(carryOn())).toBe(false);
  });
});

describe('rounds and the match', () => {
  it('scores a point a card up and two off each card left in the Nertz pile', () => {
    const s = state({ nertz: [card('2', 'clubs'), card('3', 'clubs')] });
    s.up = [9, 12];
    expect(roundScores(s)).toEqual([5, 12]);
  });

  it('can be called only when the Nertz pile is empty', () => {
    expect(canCallNertz(state({ nertz: [card('2', 'clubs')] }), 0)).toBe(false);
    expect(canCallNertz(state(), 0)).toBe(true);
  });

  it('carries totals across rounds and ends at the target', () => {
    let m: Match = newMatch(100);
    const s = state({ nertz: [card('2', 'clubs')] });
    s.up = [60, 30];
    m = addRound(m, finishRound(s, 1));
    expect(m.totals).toEqual([58, 30]);
    expect(matchWinner(m)).toBeUndefined();
    m = addRound(m, finishRound(s, 1));
    expect(m.totals).toEqual([116, 60]);
    expect(matchWinner(m)).toBe(0);
  });

  it('gives it to the higher total when both cross in one round, and goes on at a dead heat', () => {
    expect(matchWinner({ target: 100, totals: [104, 110], rounds: [] })).toBe(1);
    expect(matchWinner({ target: 100, totals: [105, 105], rounds: [] })).toBeUndefined();
  });

  it('records who called Nertz without letting it decide the round', () => {
    const s = state();
    s.up = [3, 20];
    const r = finishRound(s, 0);
    expect(r.nertz).toBe(0);
    expect(r.scores).toEqual([3, 20]);
  });
});
