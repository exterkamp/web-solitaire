import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatBest, formatBestTime, formatPercent } from '../../format';
import { ModeRecord, Stats, VARIANT_LABELS, Variant } from '../../stats';

// One row of the book. The label is the question, and each variant answers it
// in its own column - which is the whole reason this is a table rather than a
// stack of lists: a best time is only interesting next to another one.
interface Row {
  label: string;
  value: (mode: ModeRecord) => string;
}

@Component({
  imports: [RouterLink],
  selector: 'app-stats-page',
  styleUrl: './stats-page.scss',
  templateUrl: './stats-page.html',
})
export class StatsPage {
  protected readonly stats = inject(Stats);
  protected readonly confirming = signal(false);

  // Two tables rather than three columns of one. Klondike's two variants
  // belong beside each other; FreeCell is a different game and comparing its
  // win rate with theirs would be comparing a puzzle with a gamble.
  protected readonly klondike: Variant[] = ['klondike-1', 'klondike-3'];
  protected readonly freecell: Variant[] = ['freecell'];
  protected readonly labels = VARIANT_LABELS;

  private readonly common: Row[] = [
    { label: 'Played', value: (m) => String(m.played) },
    { label: 'Won', value: (m) => String(m.won) },
    { label: 'Win rate', value: (m) => (m.played ? formatPercent(m.won / m.played) : '—') },
  ];

  private readonly tail: Row[] = [
    { label: 'Best time', value: (m) => formatBestTime(m.bestSeconds) },
    { label: 'Fewest moves', value: (m) => formatBest(m.fewestMoves) },
    {
      label: 'Average win',
      value: (m) => formatBestTime(m.won ? Math.round(m.totalSeconds / m.won) : 0),
    },
    { label: 'Streak', value: (m) => String(m.currentStreak) },
    { label: 'Best streak', value: (m) => String(m.bestStreak) },
  ];

  // Klondike keeps a score; FreeCell has never had one, so that row would be
  // a column of dashes rather than a fact about the game.
  protected readonly klondikeRows: Row[] = [
    ...this.common,
    { label: 'Best score', value: (m) => formatBest(m.bestScore) },
    ...this.tail,
  ];
  protected readonly freecellRows: Row[] = [...this.common, ...this.tail];

  protected mode(variant: Variant): ModeRecord {
    return this.stats.mode(variant);
  }

  protected clear(): void {
    this.stats.clear();
    this.confirming.set(false);
  }
}
