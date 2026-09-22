import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import Phaser from 'phaser';
import { BOARD_SCENE, createBoardGame } from '../../game/board';
import { BoardView, SolitaireScene, WinSummary } from '../../game/solitaire-scene';
import { DrawCount } from '../../game/klondike';
import { GameId, asGameId } from '../../game/table-game';
import { klondikeTable } from '../../game/klondike-table';
import { freecellTable } from '../../game/freecell-table';
import { yukonTable } from '../../game/yukon-table';
import { tripeaksTable } from '../../game/tripeaks-table';
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

  // The move count at which the player waved away the "no moves" panel.
  //
  // Held as a move number rather than a flag so that waving it away is only
  // good for the position it was shown for: the one move still available in a
  // dead game is taking a card back off a foundation, and if they try that
  // and are still stuck, saying so again is the honest thing to do.
  private readonly waved = signal<number | undefined>(undefined);

  protected readonly showStuck = computed(
    () => this.view().stuck && !this.win() && this.waved() !== this.view().moves,
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

  protected keepLooking(): void {
    this.waved.set(this.view().moves);
  }

  protected newGame(): void {
    this.recordAbandoned();
    this.win.set(undefined);
    this.waved.set(undefined);
    this.elapsed.set(0);
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

// Which game the board is handed. One place that knows the four of them, so
// adding a fifth is one line here rather than a conditional that grows a limb
// each time.
function makeTable(game: GameId, drawCount: DrawCount) {
  switch (game) {
    case 'freecell':
      return freecellTable();
    case 'yukon':
      return yukonTable();
    case 'tripeaks':
      return tripeaksTable();
    default:
      return klondikeTable(drawCount);
  }
}
