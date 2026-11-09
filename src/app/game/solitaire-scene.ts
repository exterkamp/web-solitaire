import {
  Board, BoardPointer, Sprite, Toaster, Tween, cardsReady, createBoard, defineStack, flipCard, formatNumber,
  riffleShuffle, stackOffsets, toastsOf,
} from '@exterkamp/felt';
import { markBooted, renderScale } from './lite';
import {
  BOARD_DROP_STEP,
  BOARD_FLOOR,
  BOARD_MARGIN,
  CARD_HEIGHT,
  CARD_WIDTH,
  FRAME_PAD,
  GAME_HEIGHT,
  MIN_BOARD_DROP,
  TABLEAU_TOP_Y,
  TOP_ROW_Y,
  boardFloor,
  boardHeight,
  maxBoardDrop,
} from './config';
import { Card } from './deck';
import { CHIP_STACK_REACH, ScoreChips } from './chip';
import { DeckTheme } from './deck-theme';
import { DeckStyle } from './deck-style';
import { CardSprite, ghostSuit, renderCourtArt, setDeck } from './card-sprite';
import { Markings, Stacking, after, pausable } from './felt-kit';
import { fontsReady } from './fonts';
import { Move, PileRef, pileKey, samePile } from './piles';
import { GameView, PileSlot, TableGame } from './table-game';
import { Handedness, ScoreDisplay } from './settings-types';
import { timeBonus } from './klondike';
import { PointerSample, isUpwardFlick, pointerVelocity } from './gesture';
import { GameSession, SessionSnapshot } from './session';
import { firstBoardDealt } from './first-board';
import {
  FELT_CLEAR_COLOR, drawHighlight, drawRecycleMark, drawSectionLabel, drawSlot, drawTableSurface, paintTableBorder,
} from './table';

// The board: everything you can see and everything you can do to it.
//
// No rules live here, and no game either. The scene is handed a TableGame -
// Klondike or FreeCell - and asks it whether a move is legal, which piles
// exist and where they are printed. What the scene owns is everything about a
// screen and a thumb: picking a run up, following it, deciding what a release
// meant, moving a card from one place to another, and the fifty-two cards
// that fall out of a won game. None of that differs between the two games,
// and the day it is written twice is the day it starts to differ by accident.

// The scene holds a game whose state type it never inspects - every state
// goes straight back to the game that made it - so `any` here is the honest
// description rather than a shortcut. Naming it says so once.
type AnyGame = TableGame<any>;

/** What the page's heads-up display reads, refreshed after every move. */
export interface BoardView extends GameView {
  moves: number;
  // Everything a game keeps score of arrives through GameView, which this
  // extends rather than restates. It restated it until a tenth field was
  // added to one and not the other, and the board then published a number
  // the page had no name for - caught by the template compiler rather than
  // by tsc, which is a long way from where the mistake was made.
  //
  // Whether this game thinks its move count is worth the room. See
  // TableGame.showsMoves.
  showsMoves: boolean;
  canUndo: boolean;
  canFinish: boolean;
  // Nothing legal left to do. Not the same as lost - the game is still there
  // to be undone back into - but it is worth saying out loud rather than
  // leaving somebody to work out for themselves that they are done.
  stuck: boolean;
  won: boolean;
}

/** What a finished game is worth, handed to the record book. */
export interface WinSummary {
  score: number;
  bonus: number;
  total: number;
  seconds: number;
  moves: number;
  undos: number;
}

export interface BoardEvents {
  changed(view: BoardView): void;
  won(summary: WinSummary): void;
}

export interface BoardInit {
  table: AnyGame;
  theme: DeckTheme;
  backColor: number;
  handedness: Handedness;
  /** Whether a new game opens with a riffle. */
  showShuffle: boolean;
  /** A number in the HUD, or a stack of chips on the felt. See chip.ts. */
  scoreDisplay: ScoreDisplay;
  /** The deck the player drew, if they drew one. */
  deckStyle?: DeckStyle;
  /** A game to pick up where it was left, rather than a new deal. */
  resume?: SessionSnapshot<unknown>;
  events: BoardEvents;
}

// How long a card takes to get where it is going. Short: every one of these
// is between you and the next move, and the whole point of a tap gesture is
// that it is faster than a drag.
const MOVE_MS = 170;
const DRAW_MS = 150;
// The deal is the exception. It is the one animation nobody is waiting on -
// there is nothing to do until it lands - and watching a deal is half of why
// a card game is pleasant to start.
const DEAL_STAGGER_MS = 34;
const DEAL_MS = 220;
const FLIP_MS = 110;
// Carrying the shuffled pack from the middle of the table to wherever the
// deal comes from. Short: it is a beat between the shuffle and the deal, not
// a third thing to sit through.
const CARRY_MS = 190;
// Between two cards of an automatic finish. Slower than a move you made,
// because this one is a thing to watch rather than a thing you did.
const FINISH_STEP_MS = 90;

// The cascade's physics, in board units per 60th of a second. Gravity is
// tuned by eye against a 900-unit screen rather than derived from anything:
// what matters is that a card crosses the board in a second or two, and that
// it loses enough on each bounce to be visibly losing something.
const GRAVITY = 0.34;
const BOUNCE_DAMPING = 0.8;

// The trail a falling card leaves: a copy of it left behind every so many
// units of travel. Phaser stamped the card into a texture every frame; felt
// draws copies, so they are spaced by distance and capped, which on a phone
// is a few thousand cards in one draw and on any screen looks the same.
const TRAIL_SPACING = 7;
const TRAIL_LIMIT = 3000;
const TRAIL_DEPTH = -500;

// Enough pointer history to cover the flick window at any sane event rate,
// and no more: this is trimmed on every move event of every drag.
const SAMPLE_LIMIT = 8;

// The pop a flicked card makes as it lands, and how far it swells. Small -
// what sells a throw is that the card left your hand before it arrived, and
// this is only the full stop on the end of it.
const LAND_POP_MS = 150;
const LAND_POP_SCALE = 1.07;

// A press that travels less than this is a tap, and taps mean "send this
// somewhere sensible". Generous, because a thumb on glass never holds still.
const TAP_SLOP = 10;

// How far a fixed layout (Tri Peaks, Pyramid, Golf, Black Hole) may be
// raised up its board to fit a short screen: as far as keeps the game's
// lettering, at TABLEAU_TOP_Y - 23, clear of the printed border.
const MAX_RAISE = 85;
// How far down the layout must sit for the rosette at the head of the table
// to be clear of the game's lettering (see paintTableBorder).
const ROSETTE_CLEAR_DROP = 60;

// The score's chips sit in the band of felt between the top row and the
// tableau (see TABLEAU_TOP_Y's own note), against the rail - the rail is 14
// units, and the stack stops a couple short of it.
const CHIP_RAIL_CLEARANCE = 16;

interface DragState {
  pointer: number;
  sprites: CardSprite[];
  from: PileRef;
  count: number;
  // Where each sprite sat before it was picked up, so a refused drop can put
  // it back without re-deriving the layout.
  origins: { x: number; y: number }[];
  // Pointer-to-card offset at the moment of the grab, so the card does not
  // jump under the thumb.
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
  // The last few pointer positions, for telling a throw from a carry. See
  // gesture.ts - only the tail of the gesture is measured, so only the tail
  // is kept.
  samples: PointerSample[];
}

// One card falling out of a won game.
interface Faller {
  sprite: CardSprite;
  vx: number;
  vy: number;
  /** Where its last copy was left. */
  trailX: number;
  trailY: number;
}

/** Somewhere on the board. */
interface Place { x: number; y: number }

/** A card, and where it is going once the shuffling stops. */
interface Placement {
  sprite: CardSprite;
  to: Place;
  faceUp: boolean;
  /** Dealt out card by card, rather than simply put down. */
  dealt: boolean;
}

export class SolitaireScene {
  readonly board: Board;
  // `table`, not `game`, and `report` and `session` below for the same
  // reason: this was a Phaser.Scene, which had a `game`, an `events` and so
  // on of its own. The names stayed.
  private table!: AnyGame;
  private theme!: DeckTheme;
  private backColor!: number;
  private handedness: Handedness = 'right';
  private showShuffle = true;
  private scoreDisplay: ScoreDisplay = 'score';
  private deckStyle: DeckStyle | undefined;
  // True while the pack is being riffled. A second deal started in the middle
  // of that would destroy the sprites the first one's meshes are standing in
  // for, and leave the board holding cards from two packs.
  private shuffling = false;
  // Where every pile of this game is printed, worked out once from the game's
  // own description of its table.
  private slotMap = new Map<string, { slot: PileSlot; x: number; y: number }>();
  private report!: BoardEvents;
  private session!: GameSession<any>;
  private resume?: SessionSnapshot<unknown>;

  // The layout printed on the felt, which slides with the board (see
  // updateDrop), and the order the cards are drawn in. felt works in board
  // units at any density, so there is no scaled root to keep them in.
  private readonly markings: Markings;
  private readonly stacking = new Stacking();
  private readonly setBoardPaused: (paused: boolean) => void;
  // The score, in chips. See chip.ts.
  private chips?: ScoreChips;
  // What a move scored, rising off the card that scored it. See scored().
  private toasts?: Toaster;
  // The side each card is turning to, while it turns: flipCard only says so
  // when it lands, and a render half way through must not start another.
  private readonly facing = new WeakMap<CardSprite, boolean>();

  // One sprite per card, kept for the life of the deal and moved rather than
  // rebuilt. Keyed by card id, which is why a card's id has to be stable.
  private sprites = new Map<string, CardSprite>();
  // The gold outline a pile lights up in when the run in hand would be taken
  // there. One, moved to whichever pile it is: see showHighlight.
  private highlight?: Sprite;
  // The stock's slot as a thing that can be pressed rather than as printing
  // on the felt. Only games that have a stock get one. See printLayout.
  private stockSlot?: PileRef;

  // How far below its highest position the whole layout is currently sitting.
  // See boardFloor and maxBoardDrop in config.ts: the board lives at the
  // bottom of the room it is using, so the cards are where a thumb is.
  // Placeholder until init() sets the real one - this.table (and so
  // this.height) doesn't exist yet at field-initialiser time.
  private drop = 0;
  // The page's box for the board, height over width, when it was built.
  private readonly aspect?: number;

  private drag?: DragState;
  // Set while the board is animating something the player must not interrupt
  // - the deal, and the automatic finish. A drag begun mid-deal would be a
  // drag on a card whose home is still being decided.
  private busy = false;
  // Playing out a won game by itself. See finish().
  private finishing = false;
  private fallers: Faller[] = [];
  // The copies the falling cards leave behind, while a cascade is running.
  private cascade?: CardSprite[];
  private cascadeTimers: Tween[] = [];
  private stopInput: () => void = () => {};
  /** How fast the board's clock runs. Only ever changed by the smoke test. */
  timeScale = 1;

  constructor(parent: HTMLElement, init: BoardInit) {
    // The shape of the box the board is shown in, so it can be built to fill
    // it - see boardHeight.
    this.aspect = parent.clientWidth > 0 ? parent.clientHeight / parent.clientWidth : undefined;
    this.init(init);
    this.board = createBoard({
      parent,
      width: this.width,
      // Scaled to the game's own width rather than the fixed GAME_HEIGHT - see
      // boardHeight's own note on why a wider game needs a taller canvas to
      // reach the same container edges a 480-wide one already does.
      height: this.height,
      backgroundColor: FELT_CLEAR_COLOR,
      pixelRatio: renderScale(),
      // A card in the hand is lifted off the felt and swings with the pull,
      // felt's pick-up - driven by this board's own drag (see onCardDown),
      // since the gestures here are its own rather than felt's draggable.
      pickUp: true,
    });
    this.markings = new Markings(this.board);
    this.setBoardPaused = pausable(this.board, () => this.timeScale);
    void this.create();
  }

  /** Takes the board down, canvas and all. */
  destroy(): void {
    this.stopInput();
    this.chips?.destroy();
    this.toasts?.destroy();
    this.board.destroy();
  }

  // Whether the board is animating something the player should not be able to
  // interrupt: the deal, the automatic finish, or the cards falling out of a
  // won game. The last one matters more than it looks - the state still says
  // those cards are on their foundations, so a tap on one would be a legal
  // move on a card that is currently bouncing off the bottom of the screen.
  private get locked(): boolean {
    return this.busy || this.finishing || !!this.cascade;
  }

  private init(data: BoardInit): void {
    this.table = data.table;
    this.theme = data.theme;
    this.backColor = data.backColor;
    this.handedness = data.handedness;
    this.showShuffle = data.showShuffle;
    this.scoreDisplay = data.scoreDisplay;
    this.deckStyle = data.deckStyle;
    this.report = data.events;
    this.resume = data.resume;
    this.drop = this.table.drops ? maxBoardDrop(this.floorY) : this.fixedDrop;
    this.slotMap.clear();
    for (const slot of this.table.slots(this.handedness)) {
      this.slotMap.set(pileKey(slot.ref), {
        slot,
        // A game that lays itself out in columns says which column; one whose
        // board is not a grid gives the place outright.
        x: slot.x !== undefined ? slot.x + FRAME_PAD : this.columnX(slot.column),
        y: slot.y ?? (slot.row === 'top' ? TOP_ROW_Y : TABLEAU_TOP_Y + CARD_HEIGHT / 2),
      });
    }
  }

  private async create(): Promise<void> {
    setDeck(this.theme, this.backColor, this.deckStyle);
    // The courts at the size these cards are played at. Not awaited: felt
    // holds every card back until its face is painted, so the deal simply
    // starts when the deck is ready (see newGame).
    void renderCourtArt(this.board);

    drawTableSurface(this.board);
    // The rosette only where the game's name is printed clear below it.
    paintTableBorder(this.board, this.table.id, this.drop >= ROSETTE_CLEAR_DROP);
    this.toasts = toastsOf(this.board);
    // In the band between the top row and the tableau, to the right of the
    // game's name - and sliding down the board with it.
    this.chips = new ScoreChips(
      this.board, this.width - CHIP_RAIL_CLEARANCE - CHIP_STACK_REACH, TABLEAU_TOP_Y - 18,
    );
    this.chips.setDrop(this.drop);

    // The lettering is painted once, so its face has to be in first.
    await fontsReady().catch(() => undefined);
    if (this.board.isDestroyed) return;
    this.printLayout();

    const down = (p: BoardPointer) => this.onCardDown(p);
    const move = (p: BoardPointer) => this.onPointerMove(p);
    const up = (p: BoardPointer) => this.onPointerUp(p);
    // A pointer that leaves the window still ends here: felt captures every
    // press, and a cancelled one arrives as an up.
    this.board.on('pointerdown', down).on('pointermove', move).on('pointerup', up);
    this.stopInput = () => {
      this.board.off('pointerdown', down).off('pointermove', move).off('pointerup', up);
    };

    if (this.resume) this.resumeGame(this.resume);
    else this.newGame();
    this.resume = undefined;
    // The art is in and there are cards on the table. Nothing in the game
    // waits on this; the service worker does. See first-board.ts.
    firstBoardDealt();
    // The survival window starts once the board is dealt, not when the canvas
    // is built (see markBooted).
    markBooted();
  }

  // --- where everything sits ---------------------------------------------

  // The board is as wide as its game needs. Seven columns of cards fit in
  // 480 units; eight need a wider table rather than smaller cards, so the
  // pitch comes out the same in both games and every card is drawn from the
  // same textures. See freecell-table.ts.
  //
  // Plus a pad down each side for the printed border (see FRAME_PAD): every
  // x a game gives is in its own width, and is moved over by the pad here.
  private get width(): number {
    return this.table.width + 2 * FRAME_PAD;
  }

  // Scaled to this game's own width - see boardHeight's own note in
  // config.ts on why a fixed height was the wrong idea for any game whose
  // width isn't Klondike's.
  //
  // A game that places its own piles was laid out on a 920-unit board, and
  // a screen squarer than that would cut its bottom row off: it gets the
  // height it needs, less what its layout can be raised by (see fixedDrop).
  private get height(): number {
    const fitted = boardHeight(this.width, this.aspect);
    return this.table.drops ? fitted : Math.max(fitted, this.layoutNeeds() - MAX_RAISE);
  }

  // How far down the felt a fixed layout's lowest card reaches, plus the
  // clearance every board keeps above its bottom rail.
  private layoutNeeds(): number {
    const bottoms = this.table.slots(this.handedness)
      .map((slot) => (slot.y ?? TABLEAU_TOP_Y + CARD_HEIGHT / 2) + CARD_HEIGHT / 2);
    return Math.max(...bottoms) + (GAME_HEIGHT - BOARD_FLOOR);
  }

  // Where a game that places its own piles sits on a board built to the
  // screen's shape: its lowest card on the floor, where the thumb is, as a
  // column game's is - lower on a tall screen, raised on a short one, but
  // never so far its lettering meets the border at the top.
  private get fixedDrop(): number {
    return Math.max(-MAX_RAISE, this.height - this.layoutNeeds());
  }

  // Clear of the rail at whatever height this particular game came out to.
  private get floorY(): number {
    return boardFloor(this.height);
  }

  private get columnPitch(): number {
    return (this.table.width - 2 * BOARD_MARGIN) / this.table.columns;
  }

  private columnX(column: number): number {
    return FRAME_PAD + BOARD_MARGIN + this.columnPitch / 2 + column * this.columnPitch;
  }

  // Where a pile is printed on the felt, in the layout's own coordinates -
  // which is what the printing itself is drawn in. The markings container
  // carries the drop, so everything inside it moves together and none of it
  // has to know how far down the board is sitting.
  private slotPosition(ref: PileRef): { x: number; y: number } {
    const slot = this.slotMap.get(pileKey(ref));
    // Every pile a game names has a slot; this is only reachable if a game
    // returns a pile from piles() that it did not put on its table.
    return slot ? { x: slot.x, y: slot.y } : { x: this.width / 2, y: TOP_ROW_Y };
  }

  // And where it actually is. Cards are not in the markings container - they
  // are moved one at a time and have to be told where to go - so everything
  // outside the printing goes through this.
  private pileBase(ref: PileRef): { x: number; y: number } {
    const at = this.slotPosition(ref);
    return { x: at.x, y: at.y + this.drop };
  }

  // The gaps down a fanned pile, before any squeezing. What the steps are is
  // the game's business: Klondike shows a sliver of a face-down card and an
  // index of a face-up one, FreeCell has no face-down cards at all.
  private fanSteps(ref: PileRef, cards: readonly Card[]): number[] {
    return cards.map((_, i) => this.table.fanStep(ref, cards, i));
  }

  private across(ref: PileRef): boolean {
    return this.table.fansAcross?.(ref) ?? false;
  }

  // How wide a spread hand may get: the table between the rails, less the
  // card at each end.
  private get acrossRoom(): number {
    return this.table.width - 2 * BOARD_MARGIN - CARD_WIDTH;
  }

  private fanDepth(ref: PileRef, cards: readonly Card[]): number {
    return this.fanSteps(ref, cards).reduce((sum, step) => sum + step, 0);
  }

  /**
   * Slides the whole layout to sit on the bottom of the room the tableau is
   * actually using, and lifts it when a pile grows long enough to want that
   * room back.
   *
   * Called before anything is placed, so the cards and the felt's printing
   * agree about where the board is - the printing rides on the markings
   * container and is tweened here; the cards get their new positions from
   * pileBase a moment later, in the same render.
   */
  private updateDrop(animate: boolean): void {
    // A game that placed every pile itself does not slide as it plays: it
    // sits where fixedDrop puts it for the board's shape, and stays.
    //
    // Set rather than left alone: the field starts at whatever init chose,
    // and the cards and the printing have to agree on it - a mismatch once
    // left Tri Peaks drawing its deck off the bottom edge of the board.
    if (!this.table.drops) {
      const fixed = this.fixedDrop;
      if (this.drop !== fixed) {
        this.drop = fixed;
        this.markings.setY(fixed);
        this.chips?.setDrop(fixed);
      }
      return;
    }
    const depths = this.table
      .piles(this.session.state)
      // Only the piles that hang downward: a pile that fans up out of its
      // slot, like a draw-three waste, needs room above rather than below.
      .filter((pile) => !this.table.fansUp(pile.ref) && !this.across(pile.ref))
      .map((pile) => this.fanDepth(pile.ref, pile.cards));
    const deepest = Math.max(0, ...depths);
    const slack = this.floorY - (TABLEAU_TOP_Y + deepest + CARD_HEIGHT);
    const stepped = Math.floor(Math.max(0, slack) / BOARD_DROP_STEP) * BOARD_DROP_STEP;
    const next = Math.min(Math.max(stepped, MIN_BOARD_DROP), maxBoardDrop(this.floorY));
    if (next === this.drop) return;

    this.drop = next;
    if (animate) {
      this.markings.tweenY(next, MOVE_MS, 'Cubic.easeOut');
    } else {
      this.markings.setY(next);
    }
    this.chips?.setDrop(next, animate ? MOVE_MS : 0);
  }

  // How far down its pile each card sits, squeezed to fit if the pile is
  // deeper than the room under it.
  //
  // With the board sliding to fit (see updateDrop), a squeeze is only ever
  // needed by the deepest pile a game can produce - which is what it was for,
  // and why it now almost never happens.
  private fanOffsets(ref: PileRef, cards: readonly Card[]): number[] {
    // A hand spread across the table is felt's own fan: squeezed evenly to
    // the room between the rails once it would reach them.
    if (this.across(ref)) {
      const stack = defineStack({ id: pileKey(ref), x: 0, y: 0, fan: 'right', maxSpread: this.acrossRoom });
      return stackOffsets(stack, this.fanSteps(ref, cards).slice(1));
    }
    const steps = this.fanSteps(ref, cards);
    const total = steps.reduce((sum, step) => sum + step, 0);
    const room = this.floorY - (TABLEAU_TOP_Y + this.drop) - CARD_HEIGHT;
    const squeeze = this.table.fansUp(ref) || total <= room ? 1 : room / total;

    const offsets: number[] = [];
    let y = 0;
    for (const step of steps) {
      y += step * squeeze;
      offsets.push(y);
    }
    return offsets;
  }

  private cardPosition(ref: PileRef, index: number, cards: readonly Card[]): { x: number; y: number } {
    const base = this.pileBase(ref);
    const offsets = this.fanOffsets(ref, cards);
    if (this.across(ref)) {
      // Centred on the slot, so a hand grows out both ways as it is dealt.
      const spread = offsets[offsets.length - 1] ?? 0;
      return { x: base.x - spread / 2 + offsets[index], y: base.y };
    }
    if (!this.table.fansUp(ref)) return { x: base.x, y: base.y + offsets[index] };
    // Upward, measured from the card at the end of the pile rather than from
    // the one at the start: the newest card stays in the slot and the older
    // ones stand above it. See the waste fan in klondike-table.ts.
    const last = offsets[offsets.length - 1] ?? 0;
    return { x: base.x, y: base.y - (last - offsets[index]) };
  }

  // --- the printing on the felt -------------------------------------------

  private printLayout(): void {
    const board = this.board;
    const put = (sprite: Sprite) => this.markings.add(sprite);

    for (const slot of this.table.slots(this.handedness)) {
      const at = this.slotPosition(slot.ref);
      // Most piles are marked on the felt. A position on a peak is not: once
      // its card is taken it is table again, not a place something belongs.
      if (slot.printed !== false) put(drawSlot(board, at.x, at.y, CARD_WIDTH, CARD_HEIGHT));

      // A foundation carries a ghost of the suit it is reserved for. That
      // reservation is a real rule - a spade cannot be sent to whichever pile
      // happens to be empty - so the board has to say which is which before
      // there is a card on it to say it for them.
      if (slot.ghost) {
        put(board.image(ghostSuit(board, slot.ghost, 30), {
          x: at.x, y: at.y, width: 30, height: 30, alpha: 0.16, depth: -1000,
        }));
      }

      // The arrow on the stock: the one slot whose meaning is not "put a card
      // here" but "press to turn the deck over", and the one press that has
      // to keep working when the pile is empty. Presses are otherwise a card
      // sprite's job, and an empty pile has no sprite.
      if (slot.recycle) {
        put(drawRecycleMark(board, at.x, at.y, 15));
        this.stockSlot = slot.ref;
      }
    }

    // The heading, in the lettering a casino layout is printed in. It sits in
    // the band between the top row and the tableau, which is the only strip
    // of felt on this board that no card ever covers.
    put(drawSectionLabel(board, this.width / 2, TABLEAU_TOP_Y - 23, this.table.label));

    // The highlight, kept hidden until a run is dragged over a pile that
    // would take it. Made once rather than per drag: a picture painted in the
    // middle of a gesture is a stutter in the middle of a gesture.
    this.highlight = drawHighlight(board, 0, 0, CARD_WIDTH, CARD_HEIGHT);

    this.markings.setY(this.drop);
  }

  // --- starting and re-starting -------------------------------------------

  /** The game on the table as plain data, for SavedGames. */
  snapshot(): SessionSnapshot<unknown> {
    return this.session.snapshot();
  }

  /**
   * Puts a saved game back on the table, every card where it was left. No
   * shuffle and no deal: this hand was dealt already, and the riffle in front
   * of a game you are coming back to would say it was a new one.
   */
  private resumeGame(saved: SessionSnapshot<unknown>): void {
    this.session = GameSession.restore(this.table, saved);
    this.updateDrop(false);
    for (const pile of this.table.piles(this.session.state)) {
      pile.cards.forEach((card, index) => {
        const to = this.cardPosition(pile.ref, index, pile.cards);
        this.makeSprite({ ...card }, to.x, to.y);
      });
    }
    this.busy = false;
    this.renderBoard(false);
    this.publish();
  }

  /** Deals a new game of whatever game this board is showing. */
  newGame(): void {
    // Ignored while the pack is still being shuffled - half a second, and
    // the alternative is two deals sharing a table.
    if (this.shuffling) return;
    this.stopCascade();
    this.releaseDrag();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();

    this.session = new GameSession(this.table);
    this.updateDrop(false);
    this.busy = true;

    // Every card starts in the dealer's hand, face down, because that is
    // where a shuffle happens. Where each one is going is worked out now and
    // acted on after the riffle.
    const origin = this.table.dealOrigin(this.handedness);
    const from = { x: origin.x + FRAME_PAD, y: origin.y + this.drop };
    const going: Placement[] = [];

    for (const pile of this.table.piles(this.session.state)) {
      pile.cards.forEach((card, index) => {
        const sprite = this.makeSprite({ ...card, faceUp: false }, from.x, from.y);
        going.push({
          sprite,
          to: this.cardPosition(pile.ref, index, pile.cards),
          faceUp: card.faceUp,
          // Only the tableau is dealt card by card. Everything else is simply
          // there when the dealing stops, which is what it looks like when
          // somebody deals a hand in front of you.
          dealt: pile.ref.kind === 'tableau',
        });
      });
    }
    this.restack();
    void this.shuffleThenDeal(going, from);
  }

  /** Every card the deal made, painted: felt draws none of them until then. */
  private artReady(): Promise<void> {
    return cardsReady(this.board);
  }

  /**
   * The riffle, and then the deal.
   *
   * Split out of newGame because it waits and newGame does not: the scene
   * calls that one from `create`, where nothing can be awaited, and the page
   * calls it from a button.
   */
  private async shuffleThenDeal(going: readonly Placement[], from: Place): Promise<void> {
    const sprites = going.map((entry) => entry.sprite);
    // A deal nobody can see is not a deal: wait for the faces first.
    await this.artReady();
    if (this.board.isDestroyed || sprites.some((sprite) => sprite.isDestroyed)) return;
    await this.riffle(sprites, from);
    if (this.board.isDestroyed || sprites.some((sprite) => sprite.isDestroyed)) return;

    const dealt: Placement[] = [];
    for (const entry of going) {
      if (!entry.dealt) {
        // Put down where it belongs, the moment the shuffling stops.
        entry.sprite.setPosition(entry.to.x, entry.to.y);
        entry.sprite.setFaceUp(entry.faceUp);
        continue;
      }
      // Dealt face down and turned over on arrival, in a game that has
      // anything face down at all. FreeCell does not, and fifty-two cards
      // each flipping on landing is a lot of turning over for a deal where
      // nothing was ever hidden.
      if (!this.table.dealsFaceDown) entry.sprite.setFaceUp(entry.faceUp);
      dealt.push(entry);
    }
    this.restack();

    // Row by row across the columns, which is how a person deals: one card to
    // each pile, then round again. Dealing column by column looks like a
    // machine filling in a form.
    const order = [...dealt].sort((a, b) => a.to.y - b.to.y || a.to.x - b.to.x);
    order.forEach((entry, i) => {
      this.board.tweens.add({
        targets: entry.sprite,
        x: entry.to.x,
        y: entry.to.y,
        duration: DEAL_MS,
        delay: i * DEAL_STAGGER_MS,
        ease: 'Cubic.easeOut',
        onStart: () => this.stacking.bringToTop(entry.sprite),
        onComplete: () => {
          if (entry.faceUp && !entry.sprite.card.faceUp) this.flipSprite(entry.sprite, true);
        },
      });
    });

    after(this.board, order.length * DEAL_STAGGER_MS + DEAL_MS + FLIP_MS * 2, () => {
      this.busy = false;
      this.renderBoard(false);
      this.publish();
    });
    this.publish();
  }

  /**
   * Shuffles the pack, in front of you.
   *
   * The deck is already in its order - the deal decided that before any of
   * this - so what this shows is a riffle worked backwards from the deck it
   * has to produce. Brisk on purpose: a shuffle is something to see, not
   * something to wait through, and this one sits in front of every new game.
   *
   * Skipped for anyone who has asked for less movement. A pack of cards
   * flexing and springing apart is precisely the kind of thing that setting
   * is about, and the deal reads perfectly well without it.
   */
  private async riffle(sprites: readonly CardSprite[], at: Place): Promise<void> {
    if (!this.showShuffle) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    this.shuffling = true;
    try {
      await this.riffleAndCarry(sprites, at);
    } finally {
      this.shuffling = false;
    }
  }

  private async riffleAndCarry(sprites: readonly CardSprite[], at: Place): Promise<void> {

    // Shuffled in the middle of the table rather than where the deal starts.
    // Klondike deals off the stock, and the stock sits against the edge of
    // the board - a pack cut in half there puts one of the two halves off the
    // table. The middle is where a pack gets shuffled anyway.
    const middle = { x: this.width / 2, y: at.y };
    for (const sprite of sprites) sprite.setPosition(middle.x, middle.y);

    await riffleShuffle(
      this.board,
      sprites,
      defineStack({ id: 'deal', x: middle.x, y: middle.y }),
      { duration: 140, stagger: 4 },
    );

    // And carried over to where the deal comes from, squared.
    await this.board.tweens.to(sprites, { x: at.x, y: at.y, duration: CARRY_MS, ease: 'Cubic.easeInOut' });
  }

  private makeSprite(card: Card, x: number, y: number): CardSprite {
    const sprite = new CardSprite(this.board, x, y, { ...card });
    // Pressable: felt answers a press with the card drawn in front under it,
    // tested through the lens, so a fanned pile gives up the card you aimed at.
    sprite.interactive = true;
    this.sprites.set(card.id, sprite);
    return sprite;
  }

  // --- drawing the state --------------------------------------------------

  /**
   * Puts every card where the state says it should be.
   *
   * The sprites are never rebuilt - a card that moved is the same object in a
   * new place - which is what lets a move be animated at all: the thing that
   * travels is the thing that was already there.
   */
  private renderBoard(animate = true): void {
    this.updateDrop(animate);
    for (const pile of this.table.piles(this.session.state)) {
      pile.cards.forEach((card, index) => {
        const sprite = this.sprites.get(card.id);
        if (!sprite) return;
        if (this.drag?.sprites.includes(sprite)) return;
        const to = this.cardPosition(pile.ref, index, pile.cards);
        if (this.faceOf(sprite) !== card.faceUp) this.flipSprite(sprite, card.faceUp);
        if (animate && (Math.abs(sprite.x - to.x) > 0.5 || Math.abs(sprite.y - to.y) > 0.5)) {
          this.board.tweens.add({ targets: sprite, x: to.x, y: to.y, duration: MOVE_MS, ease: 'Cubic.easeOut' });
        } else {
          sprite.setPosition(to.x, to.y);
        }
      });
    }
    this.restack();
  }

  // Display order, which for a card game is the whole of what "on top of"
  // means. Rebuilt from the state rather than patched per move, because the
  // one thing worse than a card in the wrong place is a card behind the pile
  // it is in.
  private restack(): void {
    for (const pile of this.table.piles(this.session.state)) {
      for (const card of pile.cards) {
        const sprite = this.sprites.get(card.id);
        if (sprite) this.stacking.bringToTop(sprite);
      }
    }
    // Whatever is in the hand is above all of it.
    for (const sprite of this.drag?.sprites ?? []) this.stacking.bringToTop(sprite);
  }

  // A card turning over, rather than changing which side it shows: lifted a
  // little, rolled half a turn and set down the other side up.
  private flipSprite(sprite: CardSprite, faceUp: boolean): void {
    this.facing.set(sprite, faceUp);
    void flipCard(this.board, sprite, { faceUp, duration: FLIP_MS * 2, lift: 10 }).then(() => {
      if (this.facing.get(sprite) === faceUp) this.facing.delete(sprite);
    });
  }

  /** The side a card shows, or is turning to. */
  private faceOf(sprite: CardSprite): boolean {
    return this.facing.get(sprite) ?? sprite.card.faceUp;
  }

  private publish(): void {
    const view = this.table.view(this.session.state);
    this.renderChips(view.score);
    this.report.changed({
      // Whatever this game keeps: a score and a stock, or free cells.
      ...view,
      moves: this.session.moves,
      showsMoves: this.table.showsMoves,
      canUndo: this.undoable && this.session.canUndo,
      canFinish: this.session.canFinish && !this.locked,
      stuck: this.session.stuck,
      won: this.session.won,
    });
  }

  // The score, in chips, sitting on the felt in the one place every game
  // leaves empty: the band between the top row and the tableau (see
  // TABLEAU_TOP_Y's own note - it's where the game's name is printed, and
  // nowhere else), to the right of that lettering rather than under it.
  // Gated on the setting rather than left on the felt unseen: the
  // preference exists so a player who wants the plain number back gets the
  // felt back too, not just the number.
  private renderChips(score: number | undefined): void {
    this.chips?.show(this.scoreDisplay === 'chips' ? score : undefined);
  }

  // --- what the player does -----------------------------------------------

  private onCardDown(pointer: BoardPointer): void {
    if (this.locked || this.drag) return;
    const sprite = pointer.node;
    if (!(sprite instanceof CardSprite)) {
      // The empty stock, which is a slot rather than a card. Turning the
      // waste back over is the only move on this board that can be made on a
      // pile with nothing in it.
      if (this.stockSlot && this.overSlot(this.stockSlot, pointer)) this.draw();
      // Or the empty place a card is wanted in, for the game that is played
      // by choosing where rather than what. See TableGame.placeAt.
      else this.placeAtPointer(pointer);
      return;
    }

    const found = this.locate(sprite.card.id);
    if (!found) return;

    // The stock is turned, not played from, so a press anywhere on it is a
    // draw and never a grab.
    if (found.ref.kind === 'stock') {
      this.draw();
      return;
    }

    const count = found.pile.length - found.index;
    const cards = this.table.liftable(this.session.state, found.ref, count);
    if (!cards) return;

    const sprites = cards
      .map((card) => this.sprites.get(card.id))
      .filter((s): s is CardSprite => !!s);
    const board = this.toBoard(pointer);
    this.drag = {
      pointer: pointer.id,
      sprites,
      from: found.ref,
      count,
      origins: sprites.map((s) => ({ x: s.x, y: s.y })),
      offsetX: sprites[0].x - board.x,
      offsetY: sprites[0].y - board.y,
      startX: board.x,
      startY: board.y,
      moved: false,
      samples: [{ x: board.x, y: board.y, t: pointer.event.timeStamp }],
    };
    for (const s of sprites) {
      this.board.tweens.killTweensOf(s);
      this.stacking.bringToTop(s);
    }
    // Up off the felt, and the rest of the run with it as one piece.
    this.board.pickUp?.lift(sprites[0]);
    this.board.pickUp?.carry(sprites[0], sprites.slice(1));
  }

  private placeAtPointer(pointer: BoardPointer): void {
    const placeAt = this.table.placeAt;
    if (!placeAt) return;
    const state = this.session.state;
    const pile = this.table.piles(state).find((p) => !p.cards.length && this.overSlot(p.ref, pointer));
    const move = pile && placeAt(state, pile.ref);
    if (move) this.play(move);
  }

  // Whether a press is over a pile's slot, wherever the board has slid it.
  private overSlot(ref: PileRef, at: { x: number; y: number }): boolean {
    const base = this.pileBase(ref);
    return Math.abs(at.x - base.x) <= CARD_WIDTH / 2 && Math.abs(at.y - base.y) <= CARD_HEIGHT / 2;
  }

  private onPointerMove(pointer: BoardPointer): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== pointer.id) return;
    const board = this.toBoard(pointer);
    if (
      Math.abs(board.x - drag.startX) > TAP_SLOP ||
      Math.abs(board.y - drag.startY) > TAP_SLOP
    ) {
      drag.moved = true;
    }

    drag.samples.push({ x: board.x, y: board.y, t: pointer.event.timeStamp });
    if (drag.samples.length > SAMPLE_LIMIT) drag.samples.shift();

    const head = { x: board.x + drag.offsetX, y: board.y + drag.offsetY };
    drag.sprites.forEach((sprite, i) => {
      const lift = drag.origins[i].y - drag.origins[0].y;
      sprite.setPosition(head.x, head.y + lift);
    });
    this.showHighlight(
      drag.moved ? this.dropTarget(head, drag.sprites.map((sprite) => sprite.card)) : undefined,
    );
  }

  private onPointerUp(pointer: BoardPointer): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== pointer.id) return;
    this.showHighlight(undefined);

    const board = this.toBoard(pointer);

    const head = { x: board.x + drag.offsetX, y: board.y + drag.offsetY };
    // Three ways to say where a card goes, in order of how deliberate they
    // are. A throw at the foundations is the most specific thing a gesture
    // can mean here, so it is asked first and is allowed to ignore where the
    // card happened to be let go of. A press that went nowhere is a tap, and
    // asks the rules where the card belongs. Anything else is a carry, and
    // lands where it was put down.
    const cards = this.table.liftable(this.session.state, drag.from, drag.count) ?? [];

    // Where the cards were put down comes first, and only counts if that pile
    // will actually take them. Letting go of a card on a pile that accepts it
    // is the least ambiguous thing this gesture can be, so it wins even when
    // the hand was still moving quickly - which it often is, and which used
    // to make a brisk carry up the board read as a throw and go home instead
    // of where it was aimed.
    //
    // Then a throw at the foundations, for a gesture that ended over nothing
    // in particular: not having to arrive anywhere is the whole point of a
    // flick. Then a tap, which is a press that went nowhere at all and asks
    // the rules where the card belongs.
    const landed = this.dropTarget(head, cards);
    const thrown = landed ? undefined : this.flickTarget(drag, pointer, board);
    // A press that never moved is a tap, however long it was held.
    //
    // There used to be a time limit on that - a third of a second, the usual
    // figure - and it was worth nothing and cost something. Nothing, because
    // a stationary press has no other meaning here: there is no press-and-
    // hold gesture to be confused with, and holding a card still and putting
    // it back where it was is not a thing anybody means to do. And something,
    // because when a device stutters the limit is what decides a tap was a
    // slow drag, and the answer to a tap that misses its window is silence.
    const tapped = landed || thrown || drag.moved
      ? undefined
      : this.table.autoTarget(this.session.state, drag.from, drag.count);
    const to = landed ?? thrown ?? tapped;

    this.drag = undefined;
    this.board.pickUp?.drop(drag.sprites[0]);
    const played = to
      ? this.play({ kind: 'play', from: drag.from, to, count: drag.count })
      : false;
    if (played && thrown) this.landHard(drag.sprites[0]);
    // A refused drop puts the run back where it came from rather than leaving
    // it where the thumb let go. Snapping back is also the only feedback a
    // wrong move gets, and it is enough: nothing was lost, so nothing needs
    // explaining.
    if (!played) {
      drag.sprites.forEach((sprite, i) => {
        this.board.tweens.add({
          targets: sprite,
          x: drag.origins[i].x,
          y: drag.origins[i].y,
          duration: MOVE_MS,
          ease: 'Cubic.easeOut',
        });
      });
      this.restack();
    }
  }

  /**
   * The foundation a card was thrown at, if it was thrown at all.
   *
   * Foundations only, and single cards only - a foundation takes one card at
   * a time, so there is nothing a flicked run could mean. Where the throw is
   * refused, this answers nothing and the release goes on to be treated as an
   * ordinary drop: a flick that finds no home should cost no more than a drag
   * to the same place would have.
   */
  private flickTarget(
    drag: DragState, pointer: BoardPointer, board: { x: number; y: number },
  ): PileRef | undefined {
    if (drag.count !== 1 || !drag.moved) return undefined;
    const velocity = pointerVelocity(drag.samples, { x: board.x, y: board.y, t: pointer.event.timeStamp });
    if (!isUpwardFlick(velocity)) return undefined;

    // A game with no foundations has nowhere to throw a card, so there is no
    // such gesture in it.
    if (!this.table.homeFor) return undefined;
    const cards = this.table.liftable(this.session.state, drag.from, 1);
    if (!cards) return undefined;
    const home = this.table.homeFor(cards[0], this.session.state);
    return this.table.canDrop(this.session.state, cards, home) ? home : undefined;
  }

  // A card that arrived under its own steam, rather than being set down.
  // Rides on top of the flight the render started - one tween owns the
  // position and this one owns the scale, so neither has to know about the
  // other.
  private landHard(sprite: CardSprite): void {
    this.board.tweens.add({
      targets: sprite,
      scaleX: LAND_POP_SCALE,
      scaleY: LAND_POP_SCALE,
      duration: LAND_POP_MS / 2,
      delay: MOVE_MS * 0.8,
      yoyo: true,
      ease: 'Quad.easeOut',
      // Set rather than tweened back, because a flip can start on this sprite
      // while the pop is running and the two would fight over scaleX. The
      // flip wins; this only has to leave the card the size it found it.
      onComplete: () => sprite.setScale(1),
    });
  }

  private releaseDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    this.board.pickUp?.drop(drag.sprites[0]);
    this.showHighlight(undefined);
    drag.sprites.forEach((sprite, i) => sprite.setPosition(drag.origins[i].x, drag.origins[i].y));
    this.restack();
  }

  /**
   * Turns the stock, or turns the waste back into one.
   *
   * Both are one gesture on one pile, so they are one move as far as the
   * rules are concerned, and the render sorts out what it looks like: cards
   * flying to the waste and turning over, or the whole waste going quietly
   * back under the stock. A game with no stock never gets here - nothing
   * presses it, and its rules refuse the move anyway.
   */
  draw(): void {
    if (this.locked) return;
    const before = this.scoreNow();
    if (!this.session.play({ kind: 'draw' })) return;
    this.renderBoard(true);
    if (this.stockSlot) this.scored(before, this.stockSlot);
    this.publish();
  }

  /**
   * Every pile a controller can point at, with where it is on the board.
   * The order is the tab order: stock, waste, foundations, then the tableau
   * left to right. A game with no stock or no waste simply has fewer entries.
   */
  focusPiles(): { ref: PileRef; x: number; y: number }[] {
    return this.table.piles(this.session.state).map((pile) => {
      const at = this.pileBase(pile.ref);
      return { ref: pile.ref, x: at.x, y: at.y };
    });
  }

  /**
   * What a tap on a pile means, for a controller with no pointer: the stock
   * draws, anything else asks the rules where its top card belongs. Returns
   * true when something happened.
   */
  tapPile(ref: PileRef): boolean {
    if (this.locked) return false;
    if (ref.kind === 'stock') {
      this.draw();
      return true;
    }
    const pile = this.table
      .piles(this.session.state)
      .find((p) => samePile(p.ref, ref));
    if (!pile) return false;
    if (pile.cards.length === 0) {
      const move = this.table.placeAt?.(this.session.state, ref);
      return move ? this.play(move) : false;
    }
    // The top card is what a press would lift.
    const liftable = this.table.liftable(this.session.state, ref, 1);
    if (!liftable) return false;
    const to = this.table.autoTarget(this.session.state, ref, liftable.length);
    if (!to) return false;
    return this.play({ kind: 'play', from: ref, to, count: liftable.length });
  }

  /** One of the game's own buttons, pressed. See GameView.actions. */
  act(action: string): boolean {
    if (this.locked) return false;
    const before = this.scoreNow();
    if (!this.session.act(action)) return false;
    this.renderBoard(true);
    if (this.table.actAnchor) this.scored(before, this.table.actAnchor);
    this.publish();
    if (this.session.won) this.onWin();
    return true;
  }

  /** The board's own dimensions, for placing DOM over it. */
  gameSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** How long the game in progress has been running, in seconds. */
  elapsed(): number {
    return this.session?.elapsed() ?? 0;
  }

  /**
   * Stops the board, for the pause menu.
   *
   * Two things, and they are separate on purpose. The clock stops because a
   * paused hand should not cost a best time; the scene stops because a tween
   * still running behind a menu is a card that moved while nobody was
   * looking, and a finish playing itself out behind one is worse.
   *
   * The page still puts its own overlay over the canvas - that is what stops
   * a thumb reaching a card - so this is not a substitute for that. It is
   * what makes the board the same board when you come back.
   */
  setPaused(paused: boolean): void {
    this.session?.setPaused(paused);
    if (paused) this.releaseDrag();
    this.setBoardPaused(paused);
  }

  /**
   * Steps back one move.
   *
   * The one thing that is allowed during a cascade, because undoing a win is
   * a reasonable thing to want - somebody who finishes a hand and then wants
   * to keep playing the deal has no other way back. It stops the cascade
   * rather than waiting for it.
   */
  undo(): void {
    if (this.busy || this.finishing || !this.undoable) return;
    if (!this.session.undo()) return;
    this.stopCascade();
    this.renderBoard(true);
    this.publish();
  }

  /**
   * Plays out the rest of a game that is already decided: every card face up,
   * and nothing left but to send them home in order.
   */
  finish(): void {
    if (this.locked || !this.session.canFinish) return;
    // Its own flag rather than `busy`, which blocks draw() and play() - the
    // two things the finish is made of. This one keeps the player's hands off
    // the board without keeping the board's hands off it.
    this.finishing = true;
    this.publish();

    // A finish that is only turning the deck over is a finish that is not
    // finishing. It cannot happen from a position this board can reach - a
    // tableau built of descending runs has no deadlock in it - but the loop
    // below would spin forever if it ever did, and a rigged state is one
    // console line away.
    let sinceProgress = 0;

    const step = () => {
      if (!this.finishing) return;
      const move = this.table.autoFinishMove(this.session.state);
      // How much turning the deck can be doing before it is clear it is
      // getting nowhere. A game with no deck reports none of either, and this
      // reduces to "one fruitless move and stop".
      const view = this.table.view(this.session.state);
      const deck = (view.stock ?? 0) + (view.waste ?? 0);
      if (!move || this.session.won || sinceProgress > deck + 1) {
        this.finishing = false;
        this.publish();
        return;
      }
      if (move.kind === 'draw') {
        sinceProgress++;
        this.draw();
      } else {
        sinceProgress = 0;
        this.play(move, false);
      }
      after(this.board, FINISH_STEP_MS, step);
    };
    step();
  }

  private play(move: Move, publish = true): boolean {
    const before = this.scoreNow();
    const result = this.session.play(move);
    if (!result) return false;
    this.renderBoard(true);
    if (move.kind === 'play') this.scored(before, move.to);
    if (publish) this.publish();
    if (this.session.won) this.onWin();
    return true;
  }

  // Off for the game where every move turns a card nobody has seen yet. See
  // TableGame.undoable.
  private get undoable(): boolean {
    return this.table.undoable !== false;
  }

  private scoreNow(): number | undefined {
    return this.table.view(this.session.state).score;
  }

  /**
   * What a move just scored, as a felt float: "+10" rising off the card it
   * landed on, or "-100" off the stock a recycle cost. Shown whichever way
   * the score itself is shown - a number in the bar or chips on the felt -
   * since it says which move earned it, which neither of those does. Not for
   * an undo: taking a move back is not scoring. Said by the HUD's own live
   * region rather than by the float.
   */
  private scored(before: number | undefined, ref: PileRef): void {
    const after = this.scoreNow();
    if (before === undefined || after === undefined || after === before || !this.toasts) return;
    const pile = this.table.piles(this.session.state).find((p) => samePile(p.ref, ref));
    const at = pile?.cards.length
      ? this.cardPosition(ref, pile.cards.length - 1, pile.cards)
      : this.pileBase(ref);
    const gain = after > before;
    this.toasts.float(formatNumber(after - before, { sign: 'always' }), at.x, at.y - CARD_HEIGHT / 2 + 6, {
      color: gain ? '#ffd166' : '#ff8a7a',
      size: gain ? 22 : 20,
    });
  }

  private onWin(): void {
    this.startCascade();
    const session = this.session;
    const seconds = session.elapsed();
    // Not for a game played to a target: there the points are the game.
    const bonus = this.table.forPoints ? 0 : timeBonus(seconds);
    const score = this.table.view(session.state).score ?? 0;
    // Let the cards fall for a moment before the page says anything. The
    // cascade *is* the reward; a panel over it half a second in is a
    // congratulation that interrupts itself.
    after(this.board, 1400, () => {
      this.report.won({
        score,
        bonus,
        total: score + bonus,
        seconds,
        moves: session.moves,
        undos: session.undos,
      });
    });
    this.publish();
  }

  // --- hit testing ---------------------------------------------------------

  // felt's pointers arrive in board units already, at any density.
  private toBoard(pointer: BoardPointer): { x: number; y: number } {
    return { x: pointer.x, y: pointer.y };
  }

  // Where a card is, in terms the rules understand.
  private locate(cardId: string): { ref: PileRef; pile: readonly Card[]; index: number } | undefined {
    for (const pile of this.table.piles(this.session.state)) {
      const index = pile.cards.findIndex((card) => card.id === cardId);
      if (index >= 0) return { ref: pile.ref, pile: pile.cards, index };
    }
    return undefined;
  }

  /**
   * Which pile a dropped run is being offered to.
   *
   * Overlap rather than the pointer's position, and the *most* overlapped
   * pile rather than the first that touches: a card held between two columns
   * should go to the one it is mostly over, which is what a hand on a real
   * table does and is not what "the pointer is inside this rectangle" gives
   * you.
   */
  private dropTarget(
    head: { x: number; y: number }, cards: readonly Card[],
  ): PileRef | undefined {
    if (!cards.length) return undefined;
    const card: Box = { x: head.x - CARD_WIDTH / 2, y: head.y - CARD_HEIGHT / 2, width: CARD_WIDTH, height: CARD_HEIGHT };
    let best: { ref: PileRef; area: number } | undefined;
    for (const { ref, rect } of this.dropZones()) {
      const area = overlapArea(card, rect);
      if (area <= 0) continue;
      if (!best || area > best.area) best = { ref, area };
    }
    if (!best) return undefined;

    // A card let go anywhere along the foundation row goes to its own suit's
    // pile rather than to the slot it happened to land on. The slots are
    // sixty units wide and printed in an order that mirrors with handedness,
    // and a card has exactly one home - so asking the player to hit the right
    // one is asking them to aim at something the rules already know.
    //
    // Unless the slot it landed on will take it: in Calculation two
    // foundations can want the same rank at once, and a card put on one of
    // them on purpose stays there. Every other game's foundation refuses a
    // card that is not its own, so for them this changes nothing.
    const state = this.session.state;
    const to: PileRef =
      best.ref.kind === 'foundation' && this.table.homeFor && !this.table.canDrop(state, cards, best.ref)
        ? this.table.homeFor(cards[0], state)
        : best.ref;

    // Legality is settled here rather than left to the move, because this
    // answer is also what the highlight draws: a pile lit up under a card has
    // to mean "this will work", or it is an invitation to a mistake.
    return this.table.canDrop(this.session.state, cards, to) ? to : undefined;
  }

  private dropZones(): { ref: PileRef; rect: Box }[] {
    const zones: { ref: PileRef; rect: Box }[] = [];
    const cards = new Map(this.table.piles(this.session.state).map((p) => [pileKey(p.ref), p.cards]));

    for (const slot of this.table.slots(this.handedness)) {
      if (!isTarget(slot)) continue;
      const at = this.pileBase(slot.ref);
      const pile = cards.get(pileKey(slot.ref)) ?? [];
      // A column wide, so the gutters between slots are not dead ground -
      // which foundation is hit hardly matters, since a card dropped on that
      // row is routed to its own suit, but hitting nothing does. And as deep
      // as the pile is long: a run dropped anywhere down a column is meant
      // for that column, not for the felt beside it.
      const offsets = this.fanOffsets(slot.ref, pile);
      const depth = this.table.fansUp(slot.ref) || this.across(slot.ref) ? 0 : (offsets[offsets.length - 1] ?? 0);
      zones.push({
        ref: slot.ref,
        rect: {
          x: at.x - this.columnPitch / 2,
          y: at.y - CARD_HEIGHT / 2,
          width: this.columnPitch,
          height: CARD_HEIGHT + depth,
        },
      });
    }
    return zones;
  }

  // The pile a dragged run is currently over, lit up - but only where the
  // move would actually be allowed. A highlight that appears over a pile that
  // will refuse the card is worse than none: it is an invitation to a mistake.
  //
  // On the card the run would land on - the top of the pile, which on a
  // tableau column is its last face-up card, far down from where the pile
  // starts - and over it, under the run in hand. On an empty pile, the slot.
  private showHighlight(ref: PileRef | undefined): void {
    const highlight = this.highlight;
    if (!highlight) return;
    // Whatever dropTarget answered, which is only ever a pile that will take
    // the cards - so this no longer has to re-ask, and cannot disagree with
    // what the release is about to do.
    if (!ref) {
      highlight.visible = false;
      return;
    }
    const pile = this.table.piles(this.session.state).find((p) => samePile(p.ref, ref));
    const top = pile?.cards[pile.cards.length - 1];
    const sprite = top && this.sprites.get(top.id);
    if (pile && top && sprite) {
      const at = this.cardPosition(ref, pile.cards.length - 1, pile.cards);
      highlight.setPosition(at.x, at.y);
      highlight.depth = sprite.depth + 0.5;
    } else {
      const at = this.pileBase(ref);
      highlight.setPosition(at.x, at.y);
      highlight.depth = -900;
    }
    highlight.visible = true;
  }

  // --- the cascade ---------------------------------------------------------

  // The cards falling out of the foundations at the end, which is the oldest
  // piece of computer-game choreography there is and the only reason anybody
  // finishes a game they have already won.
  //
  // Each card is launched with a sideways push and bounces off the bottom of
  // the screen, leaving a trail of copies of itself behind it.
  private startCascade(): void {
    this.cascade = [];

    // Off the top of each foundation in turn, so the four piles come apart
    // together rather than one at a time.
    //
    // Falling back to whatever piles still hold cards, for the game that has
    // no foundations: Scorpion is won with its four suits lying in four
    // columns, and a win with nothing to throw is a win with no cascade -
    // which is the one part of finishing a hand anybody actually watches.
    const piles = this.table.piles(this.session.state);
    const homes = piles.filter((pile) => pile.ref.kind === 'foundation');
    const source = (homes.length ? homes : piles.filter((pile) => pile.cards.length))
      .map((pile) => pile.cards);
    const deepest = Math.max(0, ...source.map((pile) => pile.length));
    const queue: Card[] = [];
    for (let depth = deepest - 1; depth >= 0; depth--) {
      for (const pile of source) if (pile[depth]) queue.push(pile[depth]);
    }

    let ticking = false;
    queue.forEach((card, i) => {
      const timer = after(this.board, i * 110, () => {
        const sprite = this.sprites.get(card.id);
        if (!sprite || !this.cascade) return;
        this.stacking.bringToTop(sprite);
        this.fallers.push({
          sprite,
          // Away from the middle, so the two halves of the board throw their
          // cards in opposite directions and the screen fills rather than
          // draining down one side.
          vx: (sprite.x < this.width / 2 ? -1 : 1) * between(1.4, 4.2),
          vy: between(-5, -1),
          trailX: sprite.x,
          trailY: sprite.y,
        });
        if (!ticking) {
          ticking = true;
          this.board.tweens.tick((ms) => {
            ticking = this.stepCascade(ms);
            return ticking;
          });
        }
      });
      this.cascadeTimers.push(timer);
    });
  }

  private stopCascade(): void {
    // Only this animation's timers - a deal is scheduled the same way, and
    // stopping everything would cancel the one that is about to start.
    // Reachable: undo after a win stops the cascade mid-fall.
    for (const timer of this.cascadeTimers) timer.stop();
    this.cascadeTimers = [];
    this.fallers = [];
    for (const copy of this.cascade ?? []) copy.destroy();
    this.cascade = undefined;
    // A card that fell off the screen was hidden rather than destroyed, and
    // the board it is going back to expects to be able to see it.
    for (const sprite of this.sprites.values()) sprite.setVisible(true).setScale(1);
  }

  /** One step of the falling cards. Answers whether any are still falling. */
  private stepCascade(ms: number): boolean {
    if (!this.fallers.length || !this.cascade) return false;
    // Against a 60fps step rather than raw delta, so a slow frame moves the
    // cards further instead of the whole cascade running in slow motion.
    const step = Math.min(ms / 16.6667, 2);
    const floor = this.height - CARD_HEIGHT / 2;
    const trail = this.cascade;

    this.fallers = this.fallers.filter((faller) => {
      const sprite = faller.sprite;
      faller.vy += GRAVITY * step;
      sprite.x += faller.vx * step;
      sprite.y += faller.vy * step;
      if (sprite.y > floor) {
        sprite.y = floor;
        faller.vy = -Math.abs(faller.vy) * BOUNCE_DAMPING;
        // A card whose bounce has died sits on the bottom edge forever,
        // which is a card that never leaves the screen and so never ends the
        // cascade. It gets another push instead.
        if (Math.abs(faller.vy) < 1.2) faller.vy = -between(2, 5);
      }
      // The trail: a copy of the card left where it is, every few units it
      // travels, under every card still falling.
      if (trail.length < TRAIL_LIMIT
        && Math.hypot(sprite.x - faller.trailX, sprite.y - faller.trailY) >= TRAIL_SPACING) {
        const copy = new CardSprite(this.board, sprite.x, sprite.y, { ...sprite.card });
        copy.setShadow(0);
        copy.depth = TRAIL_DEPTH;
        trail.push(copy);
        faller.trailX = sprite.x;
        faller.trailY = sprite.y;
      }

      const gone = sprite.x < -CARD_WIDTH || sprite.x > this.width + CARD_WIDTH;
      if (gone) sprite.setVisible(false);
      return !gone;
    });
    return this.fallers.length > 0;
  }
}

interface Box { x: number; y: number; width: number; height: number }

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function between(low: number, high: number): number {
  return low + Math.random() * (high - low);
}

/**
 * Whether a pile takes cards.
 *
 * The default is every pile but the stock and the waste, which is right for
 * the games that build on their piles: a stock is turned and a waste is dealt
 * onto. TriPeaks is the other way round - its board positions are only ever
 * emptied, and its waste is the one place a card can go - so its slots say so
 * outright.
 */
function isTarget(slot: PileSlot): boolean {
  return slot.target ?? (slot.ref.kind !== 'stock' && slot.ref.kind !== 'waste');
}
