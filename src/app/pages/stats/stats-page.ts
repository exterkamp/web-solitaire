import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatBest, formatBestTime, formatPercent } from '../../format';
import { ModeRecord, Stats, VARIANT_GROUPS, VARIANT_LABELS, Variant, VariantGroup } from '../../stats';

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

  // A table per game rather than one table of eleven columns. Klondike's two
  // variants belong beside each other because they are the same game played
  // two ways; the rest are different games, and putting their win rates in
  // one row would invite a comparison between a puzzle and a gamble.
  //
  // The list comes from stats.ts, which is the one place that knows every
  // variant there is. This page used to keep its own and fell four games
  // behind.
  protected readonly groups = VARIANT_GROUPS;
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

  // Klondike and Tri Peaks keep a score; the other nine never have, so that
  // row would be a line of dashes rather than a fact about the game.
  private readonly scoredRows: Row[] = [
    ...this.common,
    { label: 'Best score', value: (m) => formatBest(m.bestScore) },
    ...this.tail,
  ];
  private readonly scorelessRows: Row[] = [...this.common, ...this.tail];

  protected rows(group: VariantGroup): Row[] {
    return group.scored ? this.scoredRows : this.scorelessRows;
  }

  protected mode(variant: Variant): ModeRecord {
    return this.stats.mode(variant);
  }

  /**
   * Whether this game has anything to show.
   *
   * A game nobody has played is a heading and a line saying so, rather than
   * eight rows of dashes. With eleven games the difference is most of the
   * page: an empty book should be a list of games to try, and a full one
   * should be the numbers.
   */
  protected played(group: VariantGroup): boolean {
    return group.variants.some((variant) => this.mode(variant).played > 0);
  }

  protected clear(): void {
    this.stats.clear();
    this.confirming.set(false);
  }
}
