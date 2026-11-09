import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ChipSelect } from '../../shared/chip-select/chip-select';
import { WORK_PILE_CHOICES } from '../../game/nertz';
import { NERTZ_TARGETS, Settings } from '../../settings';
import { SavedGames } from '../../saved-games';

// The page between the menu and the two-player Nertz table.
//
// Not a GameSetup entry, because it is not a TableGame: that page is an
// introduction to one of twelve solitaires that share a board, and this is a
// different kind of thing on a board of its own. It keeps the same shape -
// what it is, the rules, the one thing to choose, and a button - and borrows
// that page's styles rather than inventing a second look for it.
@Component({
  imports: [RouterLink, ChipSelect],
  selector: 'app-nertz-setup',
  styleUrl: '../game-setup/game-setup.scss',
  templateUrl: './nertz-setup.html',
})
export class NertzSetup {
  protected readonly settings = inject(Settings);
  protected readonly targets = NERTZ_TARGETS;
  protected readonly workPileChoices = WORK_PILE_CHOICES;

  private readonly savedGames = inject(SavedGames);
  private readonly router = inject(Router);
  // A match left on the table, offered back before a new one is dealt.
  protected readonly saved = this.savedGames.getNertz();

  protected savedLine(): string {
    const saved = this.saved;
    return saved ? `Round ${saved.round} · ${saved.totals[0]} to ${saved.totals[1]}` : '';
  }

  /** Starts a new match over the saved one. Nertz keeps no record, so nothing is lost but the match. */
  protected newMatch(): void {
    this.savedGames.clearNertz();
    void this.router.navigateByUrl('/play/nertz');
  }

  constructor() {
    inject(Title).setTitle('Nertz for Two Setup · Solitaire');
  }
}
