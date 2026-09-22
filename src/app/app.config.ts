import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { from, of, race, timer } from 'rxjs';
import { firstBoard } from './game/first-board';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // What makes the game playable with nothing behind it.
    //
    // There is no server to lose touch with - the whole application is files
    // and localStorage - so "offline" here is only a question of whether the
    // browser still has the files. The worker keeps them: the app and the
    // deck it deals by default are fetched on install, the other six decks
    // are kept as they are used. See ngsw-config.json.
    //
    // Off in development, where a worker serving yesterday's bundle from a
    // cache is a debugging session spent on the wrong question.
    //
    // Two cases, and they want opposite things.
    //
    // A first visit has no worker yet, and a new one answers no request until
    // it has finished prefetching - so registering while the first game is
    // still asking for its cards makes the game wait on the cache instead of
    // the other way round. That cost half a minute of empty felt, and is why
    // registration waits for the first board (or twenty seconds, for somebody
    // who installs from the menu without dealing a hand).
    //
    // A return visit already has a worker, running from the moment the page
    // opens. There is nothing to wait for and everything to lose by waiting:
    // registration is what starts Angular looking for a new version, so
    // delaying it delays the update - which is how somebody could open the
    // app, see yesterday's menu, and be gone again before it noticed.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: () =>
        navigator.serviceWorker?.controller ? of(0) : race(from(firstBoard), timer(20000)),
    }),
  ],
};
