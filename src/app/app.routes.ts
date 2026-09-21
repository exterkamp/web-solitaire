import { Routes } from '@angular/router';
import { MainMenu } from './pages/main-menu/main-menu';
import { Play } from './pages/play/play';
import { SettingsPage } from './pages/settings/settings-page';
import { StatsPage } from './pages/stats/stats-page';

export const routes: Routes = [
  { path: '', component: MainMenu },
  { path: 'play', component: Play },
  { path: 'settings', component: SettingsPage },
  { path: 'stats', component: StatsPage },
  // Anything else is the menu. There is no signed-in state and no deep link
  // worth preserving, so a stale bookmark is better answered with the front
  // door than with a page saying it is not a page.
  { path: '**', redirectTo: '' },
];
