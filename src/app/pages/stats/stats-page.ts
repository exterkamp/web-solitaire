import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DrawCount } from '../../game/klondike';
import { formatBest, formatBestTime, formatPercent } from '../../format';
import { ModeRecord, Stats } from '../../stats';

// One row of the book. The label is the question, and each mode answers it in
// its own column - which is the whole reason this is a table rather than two
// stacked lists: a best time is only interesting next to the other one.
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
  protected readonly draws: DrawCount[] = [1, 3];
  protected readonly confirming = signal(false);

  protected readonly rows: Row[] = [
    { label: 'Played', value: (m) => String(m.played) },
    { label: 'Won', value: (m) => String(m.won) },
    { label: 'Win rate', value: (m) => (m.played ? formatPercent(m.won / m.played) : '—') },
    { label: 'Best score', value: (m) => formatBest(m.bestScore) },
    { label: 'Best time', value: (m) => formatBestTime(m.bestSeconds) },
    { label: 'Fewest moves', value: (m) => formatBest(m.fewestMoves) },
    {
      label: 'Average win',
      value: (m) => formatBestTime(m.won ? Math.round(m.totalSeconds / m.won) : 0),
    },
    { label: 'Streak', value: (m) => String(m.currentStreak) },
    { label: 'Best streak', value: (m) => String(m.bestStreak) },
  ];

  protected mode(draw: DrawCount): ModeRecord {
    return this.stats.mode(draw);
  }

  protected clear(): void {
    this.stats.clear();
    this.confirming.set(false);
  }
}
