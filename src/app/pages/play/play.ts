import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import Phaser from 'phaser';
import { BOARD_SCENE, createBoardGame } from '../../game/board';
import { BoardView, SolitaireScene, WinSummary } from '../../game/solitaire-scene';
import { DrawCount } from '../../game/klondike';
import { GameId, asGameId, GAME_TITLES } from '../../game/table-game';
import { klondikeTable } from '../../game/klondike-table';
import { freecellTable } from '../../game/freecell-table';
import { yukonTable } from '../../game/yukon-table';
import { tripeaksTable } from '../../game/tripeaks-table';
import { spideretteTable } from '../../game/spiderette-table';
import { scorpionTable } from '../../game/scorpion-table';
import { pyramidTable } from '../../game/pyramid-table';
import { golfTable } from '../../game/golf-table';
import { acesUpTable } from '../../game/acesup-table';
import { canfieldTable } from '../../game/canfield-table';
import { seahavenTable } from '../../game/seahaven-table';
import { blackHoleTable } from '../../game/blackhole-table';
import { formatDuration } from '../../format';
import { Settings } from '../../settings';
import { Stats, variantOf } from '../../stats';

// The board, and everything around it that is not drawn on felt.
//
// The split is worth stating because it is the whole architecture of this
// game: Phaser owns the cards and nothing else. The score, the clock, the
// buttons and the win panel are DOM, laid over the canvas, because they are
// text and buttons - things a browser already draws better than a canvas
// can, with focus rings and screen-reader labels that come for free.

@Component({
  imports: [RouterLink],
  selector: 'app-play',
  styleUrl: './play.scss',
  templateUrl: './play.html',
})
export class Play implements AfterViewInit, OnDestroy {
  private readonly settings = inject(Settings);
  private readonly stats = inject(Stats);
  private readonly router = inject(Router);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('board');

  private game?: Phaser.Game;
  private clock?: ReturnType<typeof setInterval>;

  // What the scene last said about itself. One signal rather than several, so
  // the HUD can never show a score from one move and a move count from
  // another.
  protected readonly view = signal<BoardView>({
    moves: 0,
    showsMoves: true,
    canUndo: false,
    canFinish: false,
    stuck: false,
    won: false,
  });

  protected readonly elapsed = signal(0);
  protected readonly win = signal<WinSummary | undefined>(undefined);

  // The pause menu, which is also the only way off this page.
  //
  // A hand in progress lives entirely in this component - there is no server
  // holding it and nothing written down until it ends - so leaving the board
  // is the one irreversible thing on it. It should take two deliberate acts,
  // and now it does.
  protected readonly paused = signal(false);
  // Whether the extra history entry is still in place. See armBackGuard.
  private backGuarded = false;

  // The move count at which the player waved away the "no moves" panel.
  //
  // Held as a move number rather than a flag so that waving it away is only
  // good for the position it was shown for: the one move still available in a
  // dead game is taking a card back off a foundation, and if they try that
  // and are still stuck, saying so again is the honest thing to do.
  private readonly waved = signal<number | undefined>(undefined);

  protected readonly showStuck = computed(
    () =>
      this.settings.warnStuck() &&
      this.view().stuck &&
      !this.win() &&
      this.waved() !== this.view().moves,
  );
  // The game this board was opened with, held apart from the settings: those
  // can be changed from the menu while a game is still on the table, and a
  // hand belongs to the rules it was dealt under.
  // Which game, from the address rather than from a setting - see
  // app.routes.ts. A board that read a preference could be opened by a link
  // and show something else.
  private readonly gameId: GameId = asGameId(inject(ActivatedRoute).snapshot.paramMap.get('game'));
  private readonly drawCount = this.settings.drawCount();
  private readonly table = makeTable(this.gameId, this.drawCount);
  // Which column of the record book this hand is going into.
  private readonly variant = variantOf(this.gameId, this.drawCount);

  constructor() {
    // The tab says which game is on the felt, not just the site name.
    inject(Title).setTitle(`${GAME_TITLES[this.gameId]} · Solitaire`);
    // The two state changes that matter to someone who cannot see the
    // board: winning it, and running out of moves. Announced through the
    // live region in the template.
    effect(() => {
      const summary = this.win();
      if (summary) {
        this.announcement.set(
          `You won ${GAME_TITLES[this.gameId]}! Score ${summary.score.toLocaleString()}, ` +
            `time ${formatDuration(summary.seconds)}, ${summary.moves} moves.`,
        );
      }
    });
    effect(() => {
      if (this.showStuck()) {
        this.announcement.set('No moves left. Nothing on the table can be played.');
      }
    });
  }

  // What a screen reader says about the canvas: the game, and the numbers
  // a sighted player watches. The cards themselves are not in the
  // accessibility tree - describing twelve different boards card by card
  // is a project of its own - but nobody should meet a silent image.
  protected readonly boardLabel = computed(() => {
    const v = this.view();
    const parts = [`${GAME_TITLES[this.gameId]} board`];
    if (v.showsMoves) parts.push(`move ${v.moves}`);
    if (v.score !== undefined) parts.push(`score ${v.score.toLocaleString()}`);
    parts.push(`time ${formatDuration(this.elapsed())}`);
    return parts.join('. ') + '.';
  });

  // The live region's text. Cleared when a new hand starts so the next
  // announcement is not swallowed as a duplicate.
  protected readonly announcement = signal('');

  ngAfterViewInit(): void {
    this.game = createBoardGame(this.host().nativeElement, {
      table: this.table,
      theme: this.settings.deckTheme(),
      backColor: this.settings.backColor(),
      handedness: this.settings.handedness(),
      events: {
        changed: (view) => this.view.set(view),
        won: (summary) => this.onWin(summary),
      },
    });

    // The clock is read rather than run: the session started it at the first
    // move and will stop it at the last, and this only asks what it says.
    // Which means a tab left in the background comes back with the right
    // answer instead of one that stopped ticking when the timers did.
    this.clock = setInterval(() => this.elapsed.set(this.scene()?.elapsed() ?? 0), 500);
    this.armBackGuard();
  }

  ngOnDestroy(): void {
    if (this.clock) clearInterval(this.clock);
    window.removeEventListener('popstate', this.onPopState);
    // A game walked away from mid-hand is a game lost, for the same reason it
    // is in every other solitaire: otherwise the win rate is a measure of how
    // often you finished the ones you were winning.
    this.recordAbandoned();
    this.game?.destroy(true);
  }

  private scene(): SolitaireScene | undefined {
    return this.game?.scene.getScene(BOARD_SCENE) as SolitaireScene | undefined;
  }

  // --- leaving, and not leaving by accident -------------------------------

  /**
   * Turns the back gesture into a pause.
   *
   * Android's back is drawn by the system from outside the page and Chrome's
   * edge swipe is drawn by the browser, so nothing in here can stop either
   * one firing - preventDefault and touch-action do not reach them. What can
   * be done is to make it harmless: an extra history entry is pushed on the
   * way in, so the gesture pops that instead of leaving the board, and this
   * turns it into the pause menu. A thumb that strays to the edge of the
   * screen mid-drag then costs a menu rather than the hand.
   *
   * The pushed entry keeps the current URL, so Angular's router sees a
   * popstate for the route it is already on and does nothing with it.
   * Changing the URL here would make the router re-navigate and tear the
   * board down, which is the thing being prevented.
   */
  private armBackGuard(): void {
    history.pushState({ solitaireGuard: true }, '');
    this.backGuarded = true;
    window.addEventListener('popstate', this.onPopState);
  }

  // An arrow property, so removeEventListener is handed the same reference.
  private readonly onPopState = (): void => {
    if (!this.backGuarded) return;

    // Already paused, or the hand is over and recorded: the player means it.
    // Stop guarding and let the browser carry on back to wherever it was
    // going. Navigating with the router here instead would fight the router's
    // own popstate handling - both run for the same event, one navigation is
    // cancelled, and the URL is put back, leaving you in the game you were
    // trying to leave.
    if (this.paused() || this.view().won) {
      this.backGuarded = false;
      setTimeout(() => history.back(), 0);
      return;
    }

    history.pushState({ solitaireGuard: true }, '');
    this.setPaused(true);
  };

  // Escape does what the back gesture does, for anybody playing with a
  // keyboard: a pause rather than an exit.
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
    // The clock is read every half second and the page may have been paused
    // in between, so read it now rather than showing a stale second for the
    // length of a tick.
    this.elapsed.set(this.scene()?.elapsed() ?? 0);
  }

  /**
   * The deliberate way out. Records the hand as abandoned on the way, which
   * ngOnDestroy would do anyway - this only makes sure it happens before the
   * router takes the component down.
   */
  protected exitToMenu(): void {
    this.backGuarded = false;
    this.router.navigateByUrl('/');
  }

  protected undo(): void {
    this.scene()?.undo();
  }

  protected finish(): void {
    this.scene()?.finish();
  }

  protected keepLooking(): void {
    this.waved.set(this.view().moves);
  }

  protected newGame(): void {
    // A new deal from the pause menu is still a new deal, and the board
    // behind the menu has to be running to be dealt onto.
    if (this.paused()) this.setPaused(false);
    this.recordAbandoned();
    this.win.set(undefined);
    this.waved.set(undefined);
    this.elapsed.set(0);
    this.announcement.set('');
    this.scene()?.newGame();
  }

  private recordAbandoned(): void {
    const view = this.view();
    // A deal nobody touched is not a loss. Dealing a game, looking at it and
    // dealing another is how a lot of solitaire is played, and a record book
    // that counts each of those as a defeat is a record book nobody looks at.
    if (view.moves > 0 && !view.won) this.stats.recordLoss(this.variant);
  }

  private onWin(summary: WinSummary): void {
    this.stats.recordWin(this.variant, summary);
    this.elapsed.set(summary.seconds);
    this.win.set(summary);
  }

  protected readonly asTime = formatDuration;
}

// Which game the board is handed. One place that knows all twelve of them, so
// adding a thirteenth is one line here rather than a conditional that grows a limb
// each time - and the switch is exhaustive over GameId, so leaving a game out
// is a compile error rather than a board that quietly deals Klondike.
function makeTable(game: GameId, drawCount: DrawCount) {
  switch (game) {
    case 'freecell':
      return freecellTable();
    case 'yukon':
      return yukonTable();
    case 'canfield':
      return canfieldTable();
    case 'spiderette':
      return spideretteTable();
    case 'seahaven':
      return seahavenTable();
    case 'scorpion':
      return scorpionTable();
    case 'tripeaks':
      return tripeaksTable();
    case 'pyramid':
      return pyramidTable();
    case 'golf':
      return golfTable();
    case 'blackhole':
      return blackHoleTable();
    case 'acesup':
      return acesUpTable();
    default:
      return klondikeTable(drawCount);
  }
}
