import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { from, race, timer } from 'rxjs';
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
    // Registered after the first board has loaded rather than on any of the
    // strategies Angular offers by name. A new worker answers nothing until
    // it has finished prefetching, so registering it while the first game is
    // still asking for its cards means the game waits for the cache instead
    // of the other way round - see first-board.ts, where that cost half a
    // minute of empty felt. Afterwards the same files come out of the
    // browser's own cache and the copy is nearly free.
    //
    // Whichever comes first, because plenty of people will install this from
    // the menu without dealing a hand at all, and they should get an offline
    // copy too.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: () => race(from(firstBoard), timer(20000)),
    }),
  ],
};
