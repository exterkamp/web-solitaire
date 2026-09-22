import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import Phaser from 'phaser';
import { BOARD_SCENE, createBoardGame } from '../../game/board';
import { BoardView, SolitaireScene, WinSummary } from '../../game/solitaire-scene';
import { formatDuration } from '../../format';
import { Settings } from '../../settings';
import { Stats } from '../../stats';

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
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('board');

  private game?: Phaser.Game;
  private clock?: ReturnType<typeof setInterval>;

  // What the scene last said about itself. One signal rather than several, so
  // the HUD can never show a score from one move and a move count from
  // another.
  protected readonly view = signal<BoardView>({
    score: 0,
    moves: 0,
    stock: 0,
    waste: 0,
    canUndo: false,
    canFinish: false,
    stuck: false,
    won: false,
  });

  protected readonly elapsed = signal(0);
  protected readonly win = signal<WinSummary | undefined>(undefined);
  // The draw count this deal was dealt with, held apart from the setting: the
  // setting can be changed from the menu mid-game, and a game is scored
  // against the rules it was played under.
  protected readonly drawCount = this.settings.drawCount();

  ngAfterViewInit(): void {
    this.game = createBoardGame(this.host().nativeElement, {
      theme: this.settings.deckTheme(),
      backColor: this.settings.backColor(),
      drawCount: this.drawCount,
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
  }

  ngOnDestroy(): void {
    if (this.clock) clearInterval(this.clock);
    // A game walked away from mid-hand is a game lost, for the same reason it
    // is in every other solitaire: otherwise the win rate is a measure of how
    // often you finished the ones you were winning.
    this.recordAbandoned();
    this.game?.destroy(true);
  }

  private scene(): SolitaireScene | undefined {
    return this.game?.scene.getScene(BOARD_SCENE) as SolitaireScene | undefined;
  }

  protected undo(): void {
    this.scene()?.undo();
  }

  protected finish(): void {
    this.scene()?.finish();
  }

  protected newGame(): void {
    this.recordAbandoned();
    this.win.set(undefined);
    this.elapsed.set(0);
    this.scene()?.newGame(this.drawCount);
  }

  private recordAbandoned(): void {
    const view = this.view();
    // A deal nobody touched is not a loss. Dealing a game, looking at it and
    // dealing another is how a lot of solitaire is played, and a record book
    // that counts each of those as a defeat is a record book nobody looks at.
    if (view.moves > 0 && !view.won) this.stats.recordLoss(this.drawCount);
  }

  private onWin(summary: WinSummary): void {
    this.stats.recordWin(summary);
    this.elapsed.set(summary.seconds);
    this.win.set(summary);
  }

  protected readonly asTime = formatDuration;
}
