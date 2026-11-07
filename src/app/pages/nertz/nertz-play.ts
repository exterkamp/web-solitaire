import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { createNertzGame } from '../../game/board';
import { NertzScene, NertzView } from '../../game/nertz-scene';
import { Seat } from '../../game/nertz';
import { Settings } from '../../settings';

// Two-player Nertz, and everything around the board that is not drawn on felt.
//
// The same split as the solitaire page: felt owns the cards, and the
// numbers, buttons and panels are DOM laid over it. What is different is that
// there are two people looking at it from opposite ends, so everything a
// player reads or presses is made twice - once the right way up and once
// turned half a turn - and none of it is a single panel in the middle that
// one of them would have to read upside down.
@Component({
  imports: [NgTemplateOutlet],
  selector: 'app-nertz-play',
  styleUrl: './nertz-play.scss',
  templateUrl: './nertz-play.html',
})
export class NertzPlay implements AfterViewInit, OnDestroy {
  private readonly settings = inject(Settings);
  private readonly router = inject(Router);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('board');
  private game?: NertzScene;

  // Top first, which is the order they are laid out in.
  protected readonly seats: readonly Seat[] = [1, 0];

  protected readonly view = signal<NertzView>({
    phase: 'playing',
    round: 1,
    target: this.settings.nertzTarget(),
    totals: [0, 0],
    up: [0, 0],
    left: [13, 13],
    scores: [-26, -26],
    canNertz: [false, false],
    chips: [false, false],
    unstuck: 0,
    rounds: [],
  });

  protected readonly paused = signal(false);
  private backGuarded = false;

  protected readonly announcement = signal('');

  // A line at each player's edge for a moment after both chips went in, so
  // the stocks changing under their thumbs is not a mystery.
  protected readonly movedOn = signal(false);
  private movedOnTimer?: ReturnType<typeof setTimeout>;

  protected readonly boardLabel = computed(() => {
    const v = this.view();
    return (
      `Nertz for two, round ${v.round}. Bottom player ${v.totals[0]}, ` +
      `top player ${v.totals[1]}, playing to ${v.target}.`
    );
  });

  constructor() {
    inject(Title).setTitle('Nertz for Two · Solitaire');
  }

  ngAfterViewInit(): void {
    this.game = createNertzGame(this.host().nativeElement, {
      theme: this.settings.deckTheme(),
      backColor: this.settings.backColor(),
      deckStyle: this.settings.deckStyle(),
      target: this.settings.nertzTarget(),
      workPiles: this.settings.nertzWorkPiles(),
      events: { changed: (view) => this.onChanged(view) },
    });
    this.armBackGuard();
  }

  ngOnDestroy(): void {
    window.removeEventListener('popstate', this.onPopState);
    clearTimeout(this.movedOnTimer);
    this.game?.destroy();
  }

  private scene(): NertzScene | undefined {
    return this.game;
  }

  private onChanged(view: NertzView): void {
    const before = this.view();
    this.view.set(view);
    if (view.phase === 'match' && before.phase !== 'match') {
      this.announcement.set(`Player ${view.winner === 0 ? 'at the bottom' : 'at the top'} wins the match.`);
    } else if (view.phase === 'round' && before.phase === 'playing') {
      this.announcement.set('Round over.');
    } else if (view.unstuck > before.unstuck) {
      // Numbered, so a second time in a round is a new announcement rather
      // than the same text a live region would not read again.
      this.announcement.set(
        view.unstuck === 1
          ? 'Both stuck. Each stock moved on a card.'
          : `Both stuck again. Each stock moved on a card, ${view.unstuck} times this round.`,
      );
      this.movedOn.set(true);
      clearTimeout(this.movedOnTimer);
      this.movedOnTimer = setTimeout(() => this.movedOn.set(false), 1800);
    }
  }

  // --- leaving, and not leaving by accident ---------------------------------

  // The back gesture is turned into a pause, exactly as on the solitaire
  // board - see play.ts's armBackGuard for why the pushed entry keeps the
  // current URL and why the router is never called from the handler.
  private armBackGuard(): void {
    history.pushState({ solitaireGuard: true }, '');
    this.backGuarded = true;
    window.addEventListener('popstate', this.onPopState);
  }

  private readonly onPopState = (): void => {
    if (!this.backGuarded) return;
    if (this.paused() || this.view().phase === 'match') {
      this.backGuarded = false;
      setTimeout(() => history.back(), 0);
      return;
    }
    history.pushState({ solitaireGuard: true }, '');
    this.setPaused(true);
  };

  @HostListener('window:keydown.escape')
  protected togglePause(): void {
    this.setPaused(!this.paused());
  }

  protected resume(): void {
    this.setPaused(false);
  }

  private setPaused(paused: boolean): void {
    this.paused.set(paused);
    this.scene()?.setPaused(paused);
  }

  protected exitToMenu(): void {
    this.backGuarded = false;
    this.router.navigateByUrl('/');
  }

  // --- the players' controls ------------------------------------------------

  protected callNertz(seat: Seat): void {
    this.scene()?.callNertz(seat);
  }

  /** From the pause menu: score the round as it stands. */
  protected endRound(): void {
    this.setPaused(false);
    this.scene()?.endRoundNow();
  }

  protected nextRound(): void {
    this.scene()?.nextRound();
  }

  protected rematch(): void {
    if (this.paused()) this.setPaused(false);
    this.announcement.set('');
    this.scene()?.rematch();
  }

  /** Signed, so a round that cost points reads as a loss. */
  protected signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
  }

  protected other(seat: Seat): Seat {
    return seat === 0 ? 1 : 0;
  }
}
