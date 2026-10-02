import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ChipSelect } from '../../shared/chip-select/chip-select';
import { NERTZ_TARGETS, Settings } from '../../settings';

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

  constructor() {
    inject(Title).setTitle('Nertz for Two Setup · Solitaire');
  }
}
