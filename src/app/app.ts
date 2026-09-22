import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

// The shell: a router outlet, and the one thing that has to outlive every
// page.
//
// Nothing else sits outside a page in this game. In Nertz the corner holds
// who you are signed in as; here there is nobody to be, which is most of the
// point - see README.md.
@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);
  // A new version has been downloaded and is waiting for a reload.
  private waiting = false;

  constructor() {
    const updates = inject(SwUpdate);
    if (!updates.isEnabled) return;

    // Installed, this game can go months without being closed, and a service
    // worker will happily serve the version it has for all of that time. So
    // the app takes a new one as soon as it is safe to.
    //
    // "Safe" means not in the middle of a hand. Applying an update is a
    // reload, and a reload takes the deal with it - the score, the clock and
    // the undo stack are all in memory. So a version that arrives mid-game is
    // held until the next time the player is somewhere a reload costs them
    // nothing, which is any screen that is not the board.
    updates.versionUpdates
      .pipe(filter((event) => event.type === 'VERSION_READY'))
      .subscribe(() => {
        this.waiting = true;
        this.applyIfIdle(updates);
      });

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.applyIfIdle(updates));
  }

  private applyIfIdle(updates: SwUpdate): void {
    if (!this.waiting || this.router.url.startsWith('/play')) return;
    this.waiting = false;
    // If activating fails there is nothing to do about it and nothing to say:
    // the player keeps the version they have, and the next cold start picks
    // up the new one.
    updates.activateUpdate().then(
      () => document.location.reload(),
      () => undefined,
    );
  }
}
