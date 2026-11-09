import { describe, expect, it } from 'vitest';
import { Rank, Suit } from './config';
import { Card } from './deck';
import { seeded } from './random';
import {
  BlackjackState,
  CUT,
  STARTING_BANK,
  act,
  actions,
  deal,
  hasWon,
  isDeadEnd,
  shoe,
  status,
  total,
} from './blackjack';

let serial = 0;
function named(name: string, faceUp = true): Card {
  const suits: Record<string, Suit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
  const suit = suits[name.slice(-1)];
  return { id: `${suit}-${name.slice(0, -1)}-${serial++}`, suit, rank: name.slice(0, -1) as Rank, faceUp };
}
const cards = (...names: string[]) => names.map((n) => named(n));

/**
 * A shoe stacked so the next cards out are `next`, in order - player,
 * dealer up, player, dealer down, then hits - over enough filler to stay
 * clear of the cut card.
 */
function stacked(next: string[], bank = 100): BlackjackState {
  const filler = Array.from({ length: CUT + 10 }, () => named('2c', false));
  const top = next.map((n) => named(n, false)).reverse();
  return { ...deal(bank, seeded(1)), stock: [...filler, ...top] };
}

const run = (state: BlackjackState, ...steps: string[]) =>
  steps.reduce((s, step) => {
    const result = act(s, step);
    if (!result) throw new Error(`refused: ${step} in phase ${s.phase}`);
    return result.state;
  }, state);

describe('the count', () => {
  it('counts an ace eleven until that would bust', () => {
    expect(total(cards('As', '6h'))).toEqual({ value: 17, soft: true });
    expect(total(cards('As', '6h', '9c'))).toEqual({ value: 16, soft: false });
    expect(total(cards('As', 'Ah', 'Kc'))).toEqual({ value: 12, soft: false });
    expect(total(cards('Ks', 'Qh'))).toEqual({ value: 20, soft: false });
  });
});

describe('the shoe', () => {
  it('is two decks, every card told apart', () => {
    const cards = shoe(seeded(3));
    expect(cards).toHaveLength(104);
    expect(new Set(cards.map((c) => c.id)).size).toBe(104);
  });

  it('starts from the chips carried over, or a hundred when there are none to bet', () => {
    expect(deal(340).bank).toBe(340);
    expect(deal(0).bank).toBe(STARTING_BANK);
    expect(deal(5).bank).toBe(STARTING_BANK);
  });
});

describe('a hand', () => {
  it('pays even money on a win, and the dealer stands on soft seventeen', () => {
    // You 10 + 9 = 19; dealer 6 + A = soft 17, stands.
    const end = run(stacked(['10s', '6h', '9d', 'Ac']), 'bet-20', 'stand');
    expect(end.phase).toBe('bet');
    expect(end.bank).toBe(120);
    expect(end.last).toContain('win');
  });

  it('draws the dealer to seventeen', () => {
    // You 10 + 8 = 18; dealer 5 + 6 = 11, draws 3 (14), then 5 (19).
    const end = run(stacked(['10s', '5h', '8d', '6c', '3s', '5d']), 'bet-10', 'stand');
    expect(end.dealer.map((c) => c.rank)).toEqual(['5', '6', '3', '5']);
    expect(end.bank).toBe(90);
  });

  it('pays three to two on a blackjack, settled at once', () => {
    const end = run(stacked(['As', '9h', 'Kd', '7c']), 'bet-20');
    expect(end.phase).toBe('bet');
    expect(end.bank).toBe(130);
    expect(end.dealer[1].faceUp).toBe(true);
  });

  it('peeks under an ace, and a dealer blackjack takes the bet before you play', () => {
    const end = run(stacked(['10s', 'Ah', '9d', 'Kc']), 'bet-10');
    expect(end.phase).toBe('bet');
    expect(end.bank).toBe(90);
  });

  it('loses a bust without the dealer drawing', () => {
    const end = run(stacked(['10s', '6h', '6d', '10c', 'Kd']), 'bet-10', 'hit');
    expect(end.bank).toBe(90);
    expect(end.dealer).toHaveLength(2);
  });

  it('doubles for exactly one card', () => {
    // 6 + 5 = 11, doubled, draws a 10: 21 against the dealer's 10 + 7.
    const end = run(stacked(['6s', '10h', '5d', '7c', '10d']), 'bet-20', 'double');
    expect(end.hands[0].cards).toHaveLength(3);
    expect(end.bank).toBe(140);
  });

  it('splits a pair once into two hands', () => {
    // 8 8 against a 6; each eight gets a ten; the dealer 6 + 10 draws a 10.
    const mid = run(stacked(['8s', '6h', '8d', '10c', '10s', '10d', '10h']), 'bet-10', 'split');
    expect(mid.hands.map((h) => h.cards.map((c) => c.rank))).toEqual([['8', '10'], ['8', '10']]);
    expect(actions(mid).find((a) => a.id === 'split')!.enabled).toBe(false);
    expect(status(mid)).toContain('hand 1');
    const end = run(mid, 'stand', 'stand');
    // Dealer 6 + 10 + 10 = 26, bust: both hands win.
    expect(end.bank).toBe(120);
  });

  it('will not bet what you do not have', () => {
    const state = stacked([], 15);
    expect(actions(state).map((a) => a.enabled)).toEqual([true, false, false]);
    expect(act(state, 'bet-20')).toBeUndefined();
    expect(act(state, 'hit')).toBeUndefined();
  });
});

describe('the end of a shoe', () => {
  it('comes at the cut card, won if you are ahead', () => {
    const state = { ...stacked(['10s', '6h', '9d', 'Ac']), stock: [] as Card[] };
    // Just enough for one hand, so it ends below the cut.
    state.stock = cards('2c', '2c', '2c', '2c', '2c', '2c').map((c) => ({ ...c, faceUp: false }))
      .concat(cards('Ac', '9d', '6h', '10s').map((c) => ({ ...c, faceUp: false })));
    const end = run(state, 'bet-50', 'stand');
    expect(end.phase).toBe('over');
    expect(end.bank).toBe(150);
    expect(hasWon(end)).toBe(true);
    expect(isDeadEnd(end)).toBe(false);
  });

  it('comes when there is not enough left for a bet, and is lost', () => {
    const end = run(stacked(['10s', '10h', '6d', '9c', 'Kd'], 10), 'bet-10', 'hit');
    expect(end.bank).toBe(0);
    expect(end.phase).toBe('over');
    expect(isDeadEnd(end)).toBe(true);
  });
});
