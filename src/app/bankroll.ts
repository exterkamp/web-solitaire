// Blackjack's chips, from one shoe to the next.
//
// The only thing on this table that outlives a hand. Kept apart from the
// saved game, which is the shoe in progress, and from the record book, which
// is how shoes went: this is just what you have in front of you when you sit
// down again. Losing it - a private window, cleared site data - costs nothing
// but a fresh hundred.
const KEY = 'solitaire.blackjackBank';

export function loadBank(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export function saveBank(chips: number): void {
  try {
    localStorage.setItem(KEY, String(Math.max(0, Math.floor(chips))));
  } catch {
    // Nothing to do: the next shoe starts from a hundred.
  }
}
