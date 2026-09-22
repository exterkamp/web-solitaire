import Phaser from 'phaser';
import {
  BOARD_DROP_STEP,
  BOARD_FLOOR,
  BOARD_MARGIN,
  CARD_HEIGHT,
  CARD_WIDTH,
  GAME_HEIGHT,
  MAX_BOARD_DROP,
  MIN_BOARD_DROP,
  TABLEAU_TOP_Y,
  TOP_ROW_Y,
} from './config';
import { Card } from './deck';
import { DeckTheme } from './deck-theme';
import { CardSprite, ghostSuitKey, preloadCardArt, setDeck } from './card-sprite';
import { Move, PileRef, pileKey } from './piles';
import { PileSlot, TableGame } from './table-game';
import { Handedness } from './settings-types';
import { timeBonus } from './klondike';
import { PointerSample, isUpwardFlick, pointerVelocity } from './gesture';
import { GameSession } from './session';
import { firstBoardDealt } from './first-board';
import { drawRecycleMark, drawSectionLabel, drawSlot, drawTableSurface } from './table';

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
export interface BoardView {
  moves: number;
  // Whatever this game keeps score of, if anything: Klondike has a score and
  // a stock, FreeCell has neither and counts its free cells instead. See
  // TableGame.view.
  score?: number;
  stock?: number;
  waste?: number;
  free?: number;
  hidden?: number;
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
// Between two cards of an automatic finish. Slower than a move you made,
// because this one is a thing to watch rather than a thing you did.
const FINISH_STEP_MS = 90;

// The cascade's physics, in board units per 60th of a second. Gravity is
// tuned by eye against a 900-unit screen rather than derived from anything:
// what matters is that a card crosses the board in a second or two, and that
// it loses enough on each bounce to be visibly losing something.
const GRAVITY = 0.34;
const BOUNCE_DAMPING = 0.8;

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

// How far the felt is printed around a slot, and the gold it lights up in
// when a dragged run is over it.
const HIGHLIGHT_COLOR = 0xffd166;

interface DragState {
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
}

export class SolitaireScene extends Phaser.Scene {
  // `table`, not `game`: Phaser.Scene already has a `game` and it is the
  // engine itself. Third time this file has learned that lesson - see the
  // notes on `session` and `report` below.
  private table!: AnyGame;
  private theme!: DeckTheme;
  private backColor!: number;
  private handedness: Handedness = 'right';
  // Where every pile of this game is printed, worked out once from the game's
  // own description of its table.
  private slotMap = new Map<string, { slot: PileSlot; x: number; y: number }>();
  // `report`, not `events`, for the same reason the session is not called
  // `game`: Phaser.Scene already has an `events`, and it is the scene's own
  // emitter.
  private report!: BoardEvents;

  // `session`, not `game`: a Phaser.Scene already has a `game`, which is the
  // engine itself, and shadowing it with a different private type is how this
  // file came to be full of errors about a property that was never mentioned.
  private session!: GameSession<any>;
  private pixelRatio = 1;

  // Every game object is parented into this container instead of being added
  // to the scene, and the container is scaled by pixelRatio. The canvas is
  // rasterized at pixelRatio x GAME_WIDTH/HEIGHT for HiDPI sharpness (see
  // board.ts); scaling this root back up by the same factor keeps every
  // position in the game in its original, untouched 480x900 unit system.
  private root!: Phaser.GameObjects.Container;
  // The layout printed on the felt. Its own layer at the bottom so cards sit
  // on top of the printing rather than under it.
  private markings!: Phaser.GameObjects.Container;
  private cardLayer!: Phaser.GameObjects.Container;

  // One sprite per card, kept for the life of the deal and moved rather than
  // rebuilt. Keyed by card id, which is why a card's id has to be stable.
  private sprites = new Map<string, CardSprite>();
  private slotHighlights = new Map<string, Phaser.GameObjects.Graphics>();
  // The stock's slot as a thing that can be pressed, rather than as printing
  // on the felt. See printLayout.
  // The stock's slot as a thing that can be pressed rather than as printing
  // on the felt. Only games that have a stock get one. See printLayout.
  private stockZone?: Phaser.GameObjects.Zone;

  // How far below its highest position the whole layout is currently sitting.
  // See MAX_BOARD_DROP in config.ts: the board lives at the bottom of the
  // room it is using, so the cards are where a thumb is.
  private drop = MAX_BOARD_DROP;

  private drag?: DragState;
  // Set while the board is animating something the player must not interrupt
  // - the deal, and the automatic finish. A drag begun mid-deal would be a
  // drag on a card whose home is still being decided.
  private busy = false;
  // Playing out a won game by itself. See finish().
  private finishing = false;
  private fallers: Faller[] = [];
  private cascade?: Phaser.GameObjects.RenderTexture;
  private cascadeTimers: Phaser.Time.TimerEvent[] = [];

  constructor() {
    super('solitaire');
  }

  // Whether the board is animating something the player should not be able to
  // interrupt: the deal, the automatic finish, or the cards falling out of a
  // won game. The last one matters more than it looks - the state still says
  // those cards are on their foundations, so a tap on one would be a legal
  // move on a card that is currently bouncing off the bottom of the screen.
  private get locked(): boolean {
    return this.busy || this.finishing || !!this.cascade;
  }

  init(data: BoardInit): void {
    this.table = data.table;
    this.theme = data.theme;
    this.backColor = data.backColor;
    this.handedness = data.handedness;
    this.report = data.events;
    this.slotMap.clear();
    for (const slot of this.table.slots(this.handedness)) {
      this.slotMap.set(pileKey(slot.ref), {
        slot,
        x: this.columnX(slot.column),
        y: slot.row === 'top' ? TOP_ROW_Y : TABLEAU_TOP_Y + CARD_HEIGHT / 2,
      });
    }
  }

  preload(): void {
    setDeck(this.theme, this.backColor);
    preloadCardArt(this, this.theme);
  }

  create(): void {
    this.pixelRatio = window.devicePixelRatio || 1;
    CardSprite.textResolution = this.pixelRatio;

    drawTableSurface(this, this.pixelRatio);

    this.root = this.add.container(0, 0).setScale(this.pixelRatio);
    this.markings = this.add.container(0, 0);
    this.cardLayer = this.add.container(0, 0);
    this.root.add([this.markings, this.cardLayer]);

    this.printLayout();

    this.input.on(Phaser.Input.Events.GAMEOBJECT_DOWN, this.onCardDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    // A pointer that leaves the window never delivers its up event through
    // the canvas. Without this the run stays stuck to a thumb that is no
    // longer there.
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.releaseDrag(), this);

    this.newGame();
    // The art is in and there are cards on the table. Nothing in the game
    // waits on this; the service worker does. See first-board.ts.
    firstBoardDealt();
  }

  // --- where everything sits ---------------------------------------------

  // The board is as wide as its game needs. Seven columns of cards fit in
  // 480 units; eight need a wider table rather than smaller cards, so the
  // pitch comes out the same in both games and every card is drawn from the
  // same textures. See freecell-table.ts.
  private get width(): number {
    return this.table.width;
  }

  private get columnPitch(): number {
    return (this.width - 2 * BOARD_MARGIN) / this.table.columns;
  }

  private columnX(column: number): number {
    return BOARD_MARGIN + this.columnPitch / 2 + column * this.columnPitch;
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
    const depths = this.table
      .piles(this.session.state)
      // Only the piles that hang downward: a pile that fans up out of its
      // slot, like a draw-three waste, needs room above rather than below.
      .filter((pile) => !this.table.fansUp(pile.ref))
      .map((pile) => this.fanDepth(pile.ref, pile.cards));
    const deepest = Math.max(0, ...depths);
    const slack = BOARD_FLOOR - (TABLEAU_TOP_Y + deepest + CARD_HEIGHT);
    const stepped = Math.floor(Math.max(0, slack) / BOARD_DROP_STEP) * BOARD_DROP_STEP;
    const next = Math.min(Math.max(stepped, MIN_BOARD_DROP), MAX_BOARD_DROP);
    if (next === this.drop) return;

    this.drop = next;
    if (animate) {
      this.tweens.add({ targets: this.markings, y: next, duration: MOVE_MS, ease: 'Cubic.easeOut' });
    } else {
      this.markings.setY(next);
    }
  }

  // How far down its pile each card sits, squeezed to fit if the pile is
  // deeper than the room under it.
  //
  // With the board sliding to fit (see updateDrop), a squeeze is only ever
  // needed by the deepest pile a game can produce - which is what it was for,
  // and why it now almost never happens.
  private fanOffsets(ref: PileRef, cards: readonly Card[]): number[] {
    const steps = this.fanSteps(ref, cards);
    const total = steps.reduce((sum, step) => sum + step, 0);
    const room = BOARD_FLOOR - (TABLEAU_TOP_Y + this.drop) - CARD_HEIGHT;
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
    if (!this.table.fansUp(ref)) return { x: base.x, y: base.y + offsets[index] };
    // Upward, measured from the card at the end of the pile rather than from
    // the one at the start: the newest card stays in the slot and the older
    // ones stand above it. See the waste fan in klondike-table.ts.
    const last = offsets[offsets.length - 1] ?? 0;
    return { x: base.x, y: base.y - (last - offsets[index]) };
  }

  // --- the printing on the felt -------------------------------------------

  private printLayout(): void {
    const put = (objects: Phaser.GameObjects.GameObject[]) => this.markings.add(objects);

    for (const slot of this.table.slots(this.handedness)) {
      const at = this.slotPosition(slot.ref);
      put([drawSlot(this, at.x, at.y, CARD_WIDTH, CARD_HEIGHT)]);

      // A foundation carries a ghost of the suit it is reserved for. That
      // reservation is a real rule - a spade cannot be sent to whichever pile
      // happens to be empty - so the board has to say which is which before
      // there is a card on it to say it for them.
      if (slot.ghost) {
        put([this.add.image(at.x, at.y, ghostSuitKey(this, slot.ghost)).setDisplaySize(30, 30).setAlpha(0.16)]);
      }

      // The arrow on the stock: the one slot whose meaning is not "put a card
      // here" but "press to turn the deck over", and the one press that has
      // to keep working when the pile is empty. Presses are otherwise a card
      // sprite's job, and an empty pile has no sprite.
      if (slot.recycle) {
        put([drawRecycleMark(this, at.x, at.y, 15)]);
        this.stockZone = this.add
          .zone(at.x, at.y, CARD_WIDTH, CARD_HEIGHT)
          .setInteractive(
            new Phaser.Geom.Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT),
            Phaser.Geom.Rectangle.Contains,
          );
        this.markings.add(this.stockZone);
      }
    }

    // The heading, in the lettering a casino layout is printed in. It sits in
    // the band between the top row and the tableau, which is the only strip
    // of felt on this board that no card ever covers.
    put(drawSectionLabel(this, this.width / 2, TABLEAU_TOP_Y - 23, this.table.label, this.pixelRatio));

    // One highlight per pile a card can be dropped on, kept hidden until a
    // run is dragged over it. Made once rather than per drag: a Graphics
    // object built in the middle of a gesture is a stutter in the middle of a
    // gesture.
    for (const slot of this.table.slots(this.handedness)) {
      if (slot.ref.kind === 'stock' || slot.ref.kind === 'waste') continue;
      const at = this.slotPosition(slot.ref);
      const g = this.add.graphics();
      g.lineStyle(2.5, HIGHLIGHT_COLOR, 0.95);
      g.strokeRoundedRect(at.x - CARD_WIDTH / 2, at.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 6);
      g.setVisible(false);
      this.markings.add(g);
      this.slotHighlights.set(pileKey(slot.ref), g);
    }

    this.markings.setY(this.drop);
  }

  // --- starting and re-starting -------------------------------------------

  /** Deals a new game of whatever game this board is showing. */
  newGame(): void {
    this.stopCascade();
    this.releaseDrag();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();

    this.session = new GameSession(this.table);
    this.updateDrop(false);
    this.busy = true;

    // Only the tableau is dealt card by card. Everything else is simply there
    // when the dealing stops, which is what it looks like when somebody deals
    // a hand in front of you.
    const origin = this.table.dealOrigin(this.handedness);
    const from = {
      x: this.columnX(origin.column),
      y: (origin.row === 'top' ? TOP_ROW_Y : TABLEAU_TOP_Y + CARD_HEIGHT / 2) + this.drop,
    };
    const dealt: { sprite: CardSprite; to: { x: number; y: number }; faceUp: boolean }[] = [];

    for (const pile of this.table.piles(this.session.state)) {
      pile.cards.forEach((card, index) => {
        const to = this.cardPosition(pile.ref, index, pile.cards);
        if (pile.ref.kind !== 'tableau') {
          this.makeSprite(card, to.x, to.y);
          return;
        }
        // Dealt face down and turned over on arrival, in a game that has
        // anything face down at all. FreeCell does not, and fifty-two cards
        // each flipping on landing is a lot of turning over for a deal where
        // nothing was ever hidden.
        const sprite = this.makeSprite(
          { ...card, faceUp: this.table.dealsFaceDown ? false : card.faceUp },
          from.x,
          from.y,
        );
        dealt.push({ sprite, to, faceUp: card.faceUp });
      });
    }
    this.restack();

    // Row by row across the columns, which is how a person deals: one card to
    // each pile, then round again. Dealing column by column looks like a
    // machine filling in a form.
    const order = [...dealt].sort((a, b) => a.to.y - b.to.y || a.to.x - b.to.x);
    order.forEach((entry, i) => {
      this.tweens.add({
        targets: entry.sprite,
        x: entry.to.x,
        y: entry.to.y,
        duration: DEAL_MS,
        delay: i * DEAL_STAGGER_MS,
        ease: 'Cubic.easeOut',
        onStart: () => this.cardLayer.bringToTop(entry.sprite),
        onComplete: () => {
          if (entry.faceUp && !entry.sprite.card.faceUp) this.flipSprite(entry.sprite, true);
        },
      });
    });

    this.time.delayedCall(order.length * DEAL_STAGGER_MS + DEAL_MS + FLIP_MS, () => {
      this.busy = false;
      this.renderBoard(false);
      this.publish();
    });
    this.publish();
  }

  private makeSprite(card: Card, x: number, y: number): CardSprite {
    const sprite = new CardSprite(this, x, y, { ...card });
    // The hit area is in texture space - 0,0 at the card's top-left corner -
    // and not centred on the sprite, however much a container that draws
    // itself around its own origin suggests otherwise.
    //
    // Phaser normalises a press by *adding* the display origin to the local
    // point before testing it, so for a container, whose origin is always its
    // middle, a rectangle of (-w/2, -h/2, w, h) is tested against a point
    // that has already had (w/2, h/2) added to it. The effect is a hit box
    // half a card up and half a card to the left of the card it belongs to:
    // every press landed on the card above the one aimed at, the right half
    // of every card was dead, and the only part of a pile that could be
    // picked up was the top edge.
    sprite.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    );
    this.cardLayer.add(sprite);
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
        if (sprite.card.faceUp !== card.faceUp) this.flipSprite(sprite, card.faceUp);
        if (animate && (Math.abs(sprite.x - to.x) > 0.5 || Math.abs(sprite.y - to.y) > 0.5)) {
          this.tweens.add({ targets: sprite, x: to.x, y: to.y, duration: MOVE_MS, ease: 'Cubic.easeOut' });
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
        if (sprite) this.cardLayer.bringToTop(sprite);
      }
    }
    // Whatever is in the hand is above all of it.
    for (const sprite of this.drag?.sprites ?? []) this.cardLayer.bringToTop(sprite);
  }

  // A card turning over, rather than changing which side it shows. Squashed
  // to nothing and back out, with the swap at the moment it has no width -
  // which is the whole trick, and is why the sprite is told what to display
  // rather than being flipped twice.
  private flipSprite(sprite: CardSprite, faceUp: boolean): void {
    sprite.card.faceUp = faceUp;
    sprite.setDisplayFace(!faceUp);
    this.tweens.add({
      targets: sprite,
      scaleX: 0,
      duration: FLIP_MS,
      ease: 'Sine.easeIn',
      onComplete: () => {
        sprite.setDisplayFace(undefined);
        this.tweens.add({ targets: sprite, scaleX: 1, duration: FLIP_MS, ease: 'Sine.easeOut' });
      },
    });
  }

  private publish(): void {
    this.report.changed({
      // Whatever this game keeps: a score and a stock, or free cells.
      ...this.table.view(this.session.state),
      moves: this.session.moves,
      canUndo: this.session.canUndo,
      canFinish: this.session.canFinish && !this.locked,
      stuck: this.session.stuck,
      won: this.session.won,
    });
  }

  // --- what the player does -----------------------------------------------

  private onCardDown(pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject): void {
    if (this.locked || this.drag) return;
    // The empty stock, which is a slot rather than a card. Turning the waste
    // back over is the only move on this board that can be made on a pile
    // with nothing in it.
    if (object === this.stockZone) {
      this.draw();
      return;
    }
    const sprite = object as CardSprite;
    if (!(sprite instanceof CardSprite)) return;

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
      sprites,
      from: found.ref,
      count,
      origins: sprites.map((s) => ({ x: s.x, y: s.y })),
      offsetX: sprites[0].x - board.x,
      offsetY: sprites[0].y - board.y,
      startX: board.x,
      startY: board.y,
      moved: false,
      samples: [{ x: board.x, y: board.y, t: pointer.downTime }],
    };
    for (const s of sprites) this.cardLayer.bringToTop(s);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag) return;
    const board = this.toBoard(pointer);
    if (
      Math.abs(board.x - drag.startX) > TAP_SLOP ||
      Math.abs(board.y - drag.startY) > TAP_SLOP
    ) {
      drag.moved = true;
    }

    drag.samples.push({ x: board.x, y: board.y, t: pointer.moveTime });
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

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag) return;
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
        this.tweens.add({
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
    drag: DragState, pointer: Phaser.Input.Pointer, board: { x: number; y: number },
  ): PileRef | undefined {
    if (drag.count !== 1 || !drag.moved) return undefined;
    const velocity = pointerVelocity(drag.samples, { x: board.x, y: board.y, t: pointer.upTime });
    if (!isUpwardFlick(velocity)) return undefined;

    const cards = this.table.liftable(this.session.state, drag.from, 1);
    if (!cards) return undefined;
    const home = this.table.homeFor(cards[0]);
    return this.table.canDrop(this.session.state, cards, home) ? home : undefined;
  }

  // A card that arrived under its own steam, rather than being set down.
  // Rides on top of the flight the render started - one tween owns the
  // position and this one owns the scale, so neither has to know about the
  // other.
  private landHard(sprite: CardSprite): void {
    this.tweens.add({
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
    if (!this.session.play({ kind: 'draw' })) return;
    this.renderBoard(true);
    this.publish();
  }

  /** How long the game in progress has been running, in seconds. */
  elapsed(): number {
    return this.session?.elapsed() ?? 0;
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
    if (this.busy || this.finishing) return;
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
      this.time.delayedCall(FINISH_STEP_MS, step);
    };
    step();
  }

  private play(move: Move, publish = true): boolean {
    const result = this.session.play(move);
    if (!result) return false;
    this.renderBoard(true);
    if (publish) this.publish();
    if (this.session.won) this.onWin();
    return true;
  }

  private onWin(): void {
    this.startCascade();
    const session = this.session;
    const seconds = session.elapsed();
    const bonus = timeBonus(seconds);
    const score = this.table.view(session.state).score ?? 0;
    // Let the cards fall for a moment before the page says anything. The
    // cascade *is* the reward; a panel over it half a second in is a
    // congratulation that interrupts itself.
    this.time.delayedCall(1400, () => {
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

  private toBoard(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return { x: pointer.x / this.pixelRatio, y: pointer.y / this.pixelRatio };
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
    const card = new Phaser.Geom.Rectangle(
      head.x - CARD_WIDTH / 2, head.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT,
    );
    let best: { ref: PileRef; area: number } | undefined;
    for (const { ref, rect } of this.dropZones()) {
      const overlap = Phaser.Geom.Rectangle.Intersection(card, rect, new Phaser.Geom.Rectangle());
      const area = overlap.width * overlap.height;
      if (area <= 0) continue;
      if (!best || area > best.area) best = { ref, area };
    }
    if (!best) return undefined;

    // A card let go anywhere along the foundation row goes to its own suit's
    // pile rather than to the slot it happened to land on. The slots are
    // sixty units wide and printed in an order that mirrors with handedness,
    // and a card has exactly one home - so asking the player to hit the right
    // one is asking them to aim at something the rules already know.
    const to: PileRef = best.ref.kind === 'foundation' ? this.table.homeFor(cards[0]) : best.ref;

    // Legality is settled here rather than left to the move, because this
    // answer is also what the highlight draws: a pile lit up under a card has
    // to mean "this will work", or it is an invitation to a mistake.
    return this.table.canDrop(this.session.state, cards, to) ? to : undefined;
  }

  private dropZones(): { ref: PileRef; rect: Phaser.Geom.Rectangle }[] {
    const zones: { ref: PileRef; rect: Phaser.Geom.Rectangle }[] = [];
    const cards = new Map(this.table.piles(this.session.state).map((p) => [pileKey(p.ref), p.cards]));

    for (const slot of this.table.slots(this.handedness)) {
      // Neither of these takes a card: the stock is turned, and the waste is
      // dealt onto rather than played onto.
      if (slot.ref.kind === 'stock' || slot.ref.kind === 'waste') continue;
      const at = this.pileBase(slot.ref);
      const pile = cards.get(pileKey(slot.ref)) ?? [];
      // A column wide, so the gutters between slots are not dead ground -
      // which foundation is hit hardly matters, since a card dropped on that
      // row is routed to its own suit, but hitting nothing does. And as deep
      // as the pile is long: a run dropped anywhere down a column is meant
      // for that column, not for the felt beside it.
      const offsets = this.fanOffsets(slot.ref, pile);
      const depth = this.table.fansUp(slot.ref) ? 0 : (offsets[offsets.length - 1] ?? 0);
      zones.push({
        ref: slot.ref,
        rect: new Phaser.Geom.Rectangle(
          at.x - this.columnPitch / 2,
          at.y - CARD_HEIGHT / 2,
          this.columnPitch,
          CARD_HEIGHT + depth,
        ),
      });
    }
    return zones;
  }

  // The pile a dragged run is currently over, lit up - but only where the
  // move would actually be allowed. A highlight that appears over a pile that
  // will refuse the card is worse than none: it is an invitation to a mistake.
  private showHighlight(ref: PileRef | undefined): void {
    // Whatever dropTarget answered, which is only ever a pile that will take
    // the cards - so this no longer has to re-ask, and cannot disagree with
    // what the release is about to do.
    const key = ref ? pileKey(ref) : undefined;
    for (const [at, graphics] of this.slotHighlights) graphics.setVisible(at === key);
  }

  // --- the cascade ---------------------------------------------------------

  // The cards falling out of the foundations at the end, which is the oldest
  // piece of computer-game choreography there is and the only reason anybody
  // finishes a game they have already won.
  //
  // Each card is launched with a sideways push and bounces off the bottom of
  // the screen, leaving a trail stamped into a render texture behind it.
  private startCascade(): void {
    const pr = this.pixelRatio;
    const rt = this.add.renderTexture(0, 0, this.width * pr, GAME_HEIGHT * pr).setOrigin(0, 0);
    // Drawn at canvas resolution and displayed back down to board units, the
    // same bargain the card textures make: the trail is a ghost, but a soft
    // ghost looks like a mistake.
    rt.setDisplaySize(this.width, GAME_HEIGHT);
    this.root.addAt(rt, 1);
    this.cascade = rt;

    // Off the top of each foundation in turn, so the four piles come apart
    // together rather than one at a time.
    const foundations = this.table
      .piles(this.session.state)
      .filter((pile) => pile.ref.kind === 'foundation')
      .map((pile) => pile.cards);
    const queue: Card[] = [];
    for (let depth = 12; depth >= 0; depth--) {
      for (const pile of foundations) if (pile[depth]) queue.push(pile[depth]);
    }

    queue.forEach((card, i) => {
      const timer = this.time.delayedCall(i * 110, () => {
        const sprite = this.sprites.get(card.id);
        if (!sprite || !this.cascade) return;
        this.cardLayer.bringToTop(sprite);
        this.fallers.push({
          sprite,
          // Away from the middle, so the two halves of the board throw their
          // cards in opposite directions and the screen fills rather than
          // draining down one side.
          vx: (sprite.x < this.width / 2 ? -1 : 1) * Phaser.Math.FloatBetween(1.4, 4.2),
          vy: Phaser.Math.FloatBetween(-5, -1),
        });
      });
      this.cascadeTimers.push(timer);
    });
  }

  private stopCascade(): void {
    // Only this animation's timers, not the scene's - a deal is scheduled the
    // same way, and removing everything would cancel the one that is about to
    // start. Reachable: undo after a win stops the cascade mid-fall.
    for (const timer of this.cascadeTimers) timer.remove();
    this.cascadeTimers = [];
    this.fallers = [];
    this.cascade?.destroy();
    this.cascade = undefined;
    // A card that fell off the screen was hidden rather than destroyed, and
    // the board it is going back to expects to be able to see it.
    for (const sprite of this.sprites.values()) sprite.setVisible(true).setScale(1);
  }

  override update(_time: number, delta: number): void {
    if (!this.fallers.length || !this.cascade) return;
    // Against a 60fps step rather than raw delta, so a slow frame moves the
    // cards further instead of the whole cascade running in slow motion.
    const step = Math.min(delta / 16.6667, 2);
    const pr = this.pixelRatio;
    const floor = GAME_HEIGHT - CARD_HEIGHT / 2;

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
        if (Math.abs(faller.vy) < 1.2) faller.vy = -Phaser.Math.FloatBetween(2, 5);
      }
      // The trail: the card stamped where it is, every frame, into a texture
      // that is never cleared. Scaled to the canvas for the stamp and back
      // afterwards, because the render texture is at canvas resolution while
      // the sprite lives in board units.
      sprite.setScale(pr);
      this.cascade!.draw(sprite, sprite.x * pr, sprite.y * pr);
      sprite.setScale(1);

      const gone = sprite.x < -CARD_WIDTH || sprite.x > this.width + CARD_WIDTH;
      if (gone) sprite.setVisible(false);
      return !gone;
    });
  }
}
