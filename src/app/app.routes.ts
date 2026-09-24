import { Routes } from '@angular/router';
import { MainMenu } from './pages/main-menu/main-menu';
import { GameSetup } from './pages/game-setup/game-setup';
import { Play } from './pages/play/play';
import { SettingsPage } from './pages/settings/settings-page';
import { StatsPage } from './pages/stats/stats-page';

export const routes: Routes = [
  { path: '', component: MainMenu, title: 'Solitaire' },

  // Every game gets a page between the menu and the board, where it says
  // what it is and asks whatever it needs to ask. Including the game with
  // nothing to ask: the page is an introduction that sometimes carries a
  // setting, not a settings screen that one game happens not to need.
  { path: 'setup/:game', component: GameSetup },

  // The board, and which game is on it. In the route rather than in a setting
  // so that the two cannot disagree: this is a link you can send, bookmark,
  // or land on when an installed app reopens where it left off.
  { path: 'play/:game', component: Play },
  // What an older bookmark looks like. The menu is a better answer than a
  // board of whichever game happened to be remembered.
  { path: 'play', redirectTo: '' },

  { path: 'settings', component: SettingsPage, title: 'Settings · Solitaire' },
  { path: 'stats', component: StatsPage, title: 'Record · Solitaire' },
  // Anything else is the menu. There is no signed-in state and no deep link
  // worth preserving, so a stale bookmark is better answered with the front
  // door than with a page saying it is not a page.
  { path: '**', redirectTo: '' },
];
