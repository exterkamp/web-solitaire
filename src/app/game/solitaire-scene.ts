import Phaser from 'phaser';
import {
  BOARD_DROP_STEP,
  BOARD_FLOOR,
  CARD_HEIGHT,
  CARD_WIDTH,
  COLUMN_PITCH,
  MAX_BOARD_DROP,
  FIRST_FOUNDATION_COLUMN,
  FOUNDATION_COUNT,
  GAME_HEIGHT,
  GAME_WIDTH,
  STOCK_COLUMN,
  SUITS,
  TABLEAU_COUNT,
  TABLEAU_TOP_Y,
  TOP_ROW_Y,
  WASTE_COLUMN,
  WASTE_FAN_X,
  columnX,
} from './config';
import { Card } from './deck';
import { DeckTheme } from './deck-theme';
import {
  CARD_BACK_PEEK_HEIGHT,
  CARD_PEEK_HEIGHT,
  CardSprite,
  ghostSuitKey,
  preloadCardArt,
  setDeck,
} from './card-sprite';
import {
  DrawCount,
  Move,
  PileRef,
  autoFinishMove,
  autoTarget,
  canDrop,
  foundationIndexOf,
  liftable,
  timeBonus,
} from './klondike';
import { PointerSample, isUpwardFlick, pointerVelocity } from './gesture';
import { Solitaire } from './session';
import { drawRecycleMark, drawSectionLabel, drawSlot, drawTableSurface } from './table';

// The board: everything you can see and everything you can do to it.
//
// The rules are in klondike.ts and are not repeated here. This scene asks
// that module whether a move is legal and animates the answer; where the two
// could disagree - what a tap means, which pile a dropped card is nearest -
// the question is decided here, because those are facts about a screen and a
// thumb rather than about Klondike.

/** Which hand the phone is in. The stock is what it moves. */
export type Handedness = 'left' | 'right';

/** What the page's heads-up display reads, refreshed after every move. */
export interface BoardView {
  score: number;
  moves: number;
  stock: number;
  waste: number;
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
  drawCount: DrawCount;
}

export interface BoardEvents {
  changed(view: BoardView): void;
  won(summary: WinSummary): void;
}

export interface BoardInit {
  theme: DeckTheme;
  backColor: number;
  drawCount: DrawCount;
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

// A press that travels less than this and is over quickly is a tap, and taps
// mean "send this somewhere sensible". Generous, because a thumb on glass
// never holds still.
const TAP_SLOP = 10;
const TAP_MS = 300;

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
  startTime: number;
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
  private theme!: DeckTheme;
  private backColor!: number;
  private drawCount: DrawCount = 1;
  private handedness: Handedness = 'right';
  // `report`, not `events`, for the same reason the session is not called
  // `game`: Phaser.Scene already has an `events`, and it is the scene's own
  // emitter.
  private report!: BoardEvents;

  // `session`, not `game`: a Phaser.Scene already has a `game`, which is the
  // engine itself, and shadowing it with a different private type is how this
  // file came to be full of errors about a property that was never mentioned.
  private session!: Solitaire;
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
  // Above the cards: the hint flash, and nothing else.
  private effectLayer!: Phaser.GameObjects.Container;

  // One sprite per card, kept for the life of the deal and moved rather than
  // rebuilt. Keyed by card id, which is why a card's id has to be stable.
  private sprites = new Map<string, CardSprite>();
  private slotHighlights = new Map<string, Phaser.GameObjects.Graphics>();
  // The stock's slot as a thing that can be pressed, rather than as printing
  // on the felt. See printLayout.
  private stockZone!: Phaser.GameObjects.Zone;

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
    this.theme = data.theme;
    this.backColor = data.backColor;
    this.drawCount = data.drawCount;
    this.handedness = data.handedness;
    this.report = data.events;
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
    this.effectLayer = this.add.container(0, 0);
    this.root.add([this.markings, this.cardLayer, this.effectLayer]);

    this.printLayout();

    this.input.on(Phaser.Input.Events.GAMEOBJECT_DOWN, this.onCardDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    // A pointer that leaves the window never delivers its up event through
    // the canvas. Without this the run stays stuck to a thumb that is no
    // longer there.
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.releaseDrag(), this);

    this.newGame();
  }

  // --- where everything sits ---------------------------------------------

  // Which column each of the top-row piles is printed in.
  //
  // The stock is tapped more than anything else on the board - a draw-three
  // game is mostly taps on it - so it goes under the thumb of whichever hand
  // is holding the phone, and the foundations take the other end. The waste
  // sits inboard of the stock and fans toward the middle, which leaves its
  // three cards room without them ever running into a foundation.
  private topColumns(): { stock: number; waste: number; foundations: number[]; fan: number } {
    if (this.handedness === 'right') {
      return {
        stock: TABLEAU_COUNT - 1 - STOCK_COLUMN,
        waste: TABLEAU_COUNT - 1 - WASTE_COLUMN,
        foundations: Array.from({ length: FOUNDATION_COUNT }, (_, i) => FOUNDATION_COUNT - 1 - i),
        fan: -1,
      };
    }
    return {
      stock: STOCK_COLUMN,
      waste: WASTE_COLUMN,
      foundations: Array.from({ length: FOUNDATION_COUNT }, (_, i) => FIRST_FOUNDATION_COLUMN + i),
      fan: 1,
    };
  }

  // Where a pile is printed on the felt, in the layout's own coordinates -
  // which is what the printing itself is drawn in. The markings container
  // carries the drop, so everything inside it moves together and none of it
  // has to know how far down the board is sitting.
  private slotPosition(ref: PileRef): { x: number; y: number } {
    const columns = this.topColumns();
    switch (ref.kind) {
      case 'stock':
        return { x: columnX(columns.stock), y: TOP_ROW_Y };
      case 'waste':
        return { x: columnX(columns.waste), y: TOP_ROW_Y };
      case 'foundation':
        return { x: columnX(columns.foundations[ref.index]), y: TOP_ROW_Y };
      case 'tableau':
        return { x: columnX(ref.index), y: TABLEAU_TOP_Y + CARD_HEIGHT / 2 };
    }
  }

  // And where it actually is. Cards are not in the markings container - they
  // are moved one at a time and have to be told where to go - so everything
  // outside the printing goes through this.
  private pileBase(ref: PileRef): { x: number; y: number } {
    const at = this.slotPosition(ref);
    return { x: at.x, y: at.y + this.drop };
  }

  // The gaps down a fanned pile, before any squeezing. A face-down card shows
  // a sliver and a face-up one shows its index, so the step depends on the
  // card *above* the gap rather than on a fixed pitch.
  private fanSteps(pile: readonly Card[]): number[] {
    return pile.map((card, i) =>
      i === 0 ? 0 : pile[i - 1].faceUp ? CARD_PEEK_HEIGHT : CARD_BACK_PEEK_HEIGHT,
    );
  }

  private fanDepth(pile: readonly Card[]): number {
    return this.fanSteps(pile).reduce((sum, step) => sum + step, 0);
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
    const deepest = Math.max(0, ...this.session.state.tableau.map((pile) => this.fanDepth(pile)));
    const slack = BOARD_FLOOR - (TABLEAU_TOP_Y + deepest + CARD_HEIGHT);
    const stepped = Math.floor(Math.max(0, slack) / BOARD_DROP_STEP) * BOARD_DROP_STEP;
    const next = Math.min(stepped, MAX_BOARD_DROP);
    if (next === this.drop) return;

    this.drop = next;
    if (animate) {
      this.tweens.add({ targets: this.markings, y: next, duration: MOVE_MS, ease: 'Cubic.easeOut' });
    } else {
      this.markings.setY(next);
    }
  }

  // How far down the column each card of a tableau pile sits.
  //
  // A face-down card shows a sliver and a face-up one shows its index, so the
  // step depends on the card *above* the gap rather than on a fixed pitch.
  // The whole fan is then squeezed if it would run off the bottom of the
  // screen - which a legal Klondike pile cannot quite do at these numbers,
  // but "cannot quite" is not a reason to draw a card where it cannot be
  // reached.
  private tableauOffsets(pile: readonly Card[]): number[] {
    const steps = this.fanSteps(pile);
    const total = steps.reduce((sum, step) => sum + step, 0);
    // What is left between the pile's first card and the floor. With the
    // board sliding to fit (see updateDrop), this is only ever short for the
    // deepest pile Klondike can deal - which is what the squeeze below is
    // for, and why it now almost never happens.
    const room = BOARD_FLOOR - (TABLEAU_TOP_Y + this.drop) - CARD_HEIGHT;
    const squeeze = total > room ? room / total : 1;

    const offsets: number[] = [];
    let y = 0;
    for (const step of steps) {
      y += step * squeeze;
      offsets.push(y);
    }
    return offsets;
  }

  private cardPosition(ref: PileRef, index: number, pile: readonly Card[]): { x: number; y: number } {
    const base = this.pileBase(ref);
    if (ref.kind === 'tableau') {
      return { x: base.x, y: base.y + this.tableauOffsets(pile)[index] };
    }
    if (ref.kind === 'waste') {
      // Only the last few are fanned, and only in draw-three: in draw-one
      // there is one card to look at and a fan of one is a card that has
      // wandered off its slot.
      const fanned = this.drawCount === 3 ? Math.min(3, pile.length) : 1;
      const place = index - (pile.length - fanned);
      const columns = this.topColumns();
      return {
        x: base.x + (place > 0 ? place * WASTE_FAN_X * columns.fan : 0),
        y: base.y,
      };
    }
    return base;
  }

  // --- the printing on the felt -------------------------------------------

  private printLayout(): void {
    const put = (objects: Phaser.GameObjects.GameObject[]) => this.markings.add(objects);

    // The stock's slot, with the turn-it-over arrow inside it. Drawn whether
    // or not there are cards on it: the arrow is what says an empty stock is
    // a button rather than a gap.
    const stock = this.slotPosition({ kind: 'stock', index: 0 });
    put([drawSlot(this, stock.x, stock.y, CARD_WIDTH, CARD_HEIGHT)]);
    put([drawRecycleMark(this, stock.x, stock.y, 15)]);

    // The stock takes presses whether or not there is a card on it.
    //
    // This was the top card's job alone, which works right up until the stock
    // runs out - and then the one press that matters, the one that turns the
    // waste back into a deck, has nothing left to land on. The arrow was
    // drawn there promising exactly that and the slot underneath it was felt.
    //
    // In the markings layer, so it sits below the cards: while there is a
    // stock to turn, the top card is what gets pressed, and they both mean
    // the same thing anyway.
    this.stockZone = this.add
      .zone(stock.x, stock.y, CARD_WIDTH, CARD_HEIGHT)
      .setInteractive(
        new Phaser.Geom.Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT),
        Phaser.Geom.Rectangle.Contains,
      );
    this.markings.add(this.stockZone);
    this.markings.setY(this.drop);

    const waste = this.slotPosition({ kind: 'waste', index: 0 });
    put([drawSlot(this, waste.x, waste.y, CARD_WIDTH, CARD_HEIGHT)]);

    // Each foundation carries a ghost of the suit it is reserved for. That
    // reservation is a real rule here - a spade cannot be sent to the pile
    // that happens to be empty - so the board has to say which is which
    // before there is a card on it to say it for them.
    SUITS.forEach((suit, i) => {
      const at = this.slotPosition({ kind: 'foundation', index: i });
      put([drawSlot(this, at.x, at.y, CARD_WIDTH, CARD_HEIGHT)]);
      const ghost = this.add
        .image(at.x, at.y, ghostSuitKey(this, suit))
        .setDisplaySize(30, 30)
        .setAlpha(0.16);
      put([ghost]);
    });

    for (let i = 0; i < TABLEAU_COUNT; i++) {
      const at = this.slotPosition({ kind: 'tableau', index: i });
      put([drawSlot(this, at.x, at.y, CARD_WIDTH, CARD_HEIGHT)]);
    }

    // The heading, in the lettering a casino layout is printed in. It sits in
    // the band between the top row and the tableau, which is the only strip
    // of felt on this board that no card ever covers.
    put(drawSectionLabel(this, GAME_WIDTH / 2, TABLEAU_TOP_Y - 23, 'Solitaire', this.pixelRatio));

    // One highlight per droppable pile, kept hidden until a run is dragged
    // over it. Made once rather than per drag: a Graphics object built in the
    // middle of a gesture is a stutter in the middle of a gesture.
    const highlight = (ref: PileRef) => {
      const at = this.slotPosition(ref);
      const g = this.add.graphics();
      g.lineStyle(2.5, HIGHLIGHT_COLOR, 0.95);
      g.strokeRoundedRect(at.x - CARD_WIDTH / 2, at.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 6);
      g.setVisible(false);
      this.markings.add(g);
      this.slotHighlights.set(pileKey(ref), g);
    };
    for (let i = 0; i < FOUNDATION_COUNT; i++) highlight({ kind: 'foundation', index: i });
    for (let i = 0; i < TABLEAU_COUNT; i++) highlight({ kind: 'tableau', index: i });
  }

  // --- starting and re-starting -------------------------------------------

  /** Deals a new game, optionally changing how many cards a draw turns. */
  newGame(drawCount: DrawCount = this.drawCount): void {
    this.stopCascade();
    this.releaseDrag();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();

    this.drawCount = drawCount;
    this.session = new Solitaire(drawCount);
    this.updateDrop(false);
    this.busy = true;

    // Every card starts on the stock, face down, and is dealt from there.
    // The state already says where they end up; this is only the journey.
    const state = this.session.state;
    const stock = this.pileBase({ kind: 'stock', index: 0 });
    const dealt: { sprite: CardSprite; to: { x: number; y: number }; faceUp: boolean }[] = [];

    state.tableau.forEach((pile, column) => {
      pile.forEach((card, index) => {
        const sprite = this.makeSprite({ ...card, faceUp: false }, stock.x, stock.y);
        dealt.push({
          sprite,
          to: this.cardPosition({ kind: 'tableau', index: column }, index, pile),
          faceUp: card.faceUp,
        });
      });
    });
    for (const card of state.stock) this.makeSprite(card, stock.x, stock.y);
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
          if (entry.faceUp) this.flipSprite(entry.sprite, true);
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
    const state = this.session.state;
    this.updateDrop(animate);
    const place = (ref: PileRef, pile: readonly Card[]) => {
      pile.forEach((card, index) => {
        const sprite = this.sprites.get(card.id);
        if (!sprite) return;
        if (this.drag?.sprites.includes(sprite)) return;
        const to = this.cardPosition(ref, index, pile);
        if (sprite.card.faceUp !== card.faceUp) this.flipSprite(sprite, card.faceUp);
        if (animate && (Math.abs(sprite.x - to.x) > 0.5 || Math.abs(sprite.y - to.y) > 0.5)) {
          this.tweens.add({ targets: sprite, x: to.x, y: to.y, duration: MOVE_MS, ease: 'Cubic.easeOut' });
        } else {
          sprite.setPosition(to.x, to.y);
        }
      });
    };

    place({ kind: 'stock', index: 0 }, state.stock);
    place({ kind: 'waste', index: 0 }, state.waste);
    state.foundations.forEach((pile, i) => place({ kind: 'foundation', index: i }, pile));
    state.tableau.forEach((pile, i) => place({ kind: 'tableau', index: i }, pile));
    this.restack();
  }

  // Display order, which for a card game is the whole of what "on top of"
  // means. Rebuilt from the state rather than patched per move, because the
  // one thing worse than a card in the wrong place is a card behind the pile
  // it is in.
  private restack(): void {
    const state = this.session.state;
    const piles: readonly (readonly Card[])[] = [
      state.stock,
      state.waste,
      ...state.foundations,
      ...state.tableau,
    ];
    for (const pile of piles) {
      for (const card of pile) {
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
    const state = this.session.state;
    this.report.changed({
      score: state.score,
      moves: state.moves,
      stock: state.stock.length,
      waste: state.waste.length,
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
    const cards = liftable(this.session.state, found.ref, count);
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
      startTime: this.time.now,
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
    this.showHighlight(drag.moved ? this.dropTarget(head) : undefined);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag) return;
    this.showHighlight(undefined);

    const board = this.toBoard(pointer);
    const quick = this.time.now - drag.startTime < TAP_MS;
    const head = { x: board.x + drag.offsetX, y: board.y + drag.offsetY };
    // Three ways to say where a card goes, in order of how deliberate they
    // are. A throw at the foundations is the most specific thing a gesture
    // can mean here, so it is asked first and is allowed to ignore where the
    // card happened to be let go of. A press that went nowhere is a tap, and
    // asks the rules where the card belongs. Anything else is a carry, and
    // lands where it was put down.
    const flick = this.flickTarget(drag, pointer, board);
    const to = flick
      ?? (!drag.moved && quick
        ? autoTarget(this.session.state, drag.from, drag.count)
        : this.dropTarget(head));

    this.drag = undefined;
    const played = to
      ? this.play({ kind: 'play', from: drag.from, to, count: drag.count })
      : false;
    if (played && flick) this.landHard(drag.sprites[0]);
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

    const cards = liftable(this.session.state, drag.from, 1);
    if (!cards) return undefined;
    const home: PileRef = { kind: 'foundation', index: foundationIndexOf(cards[0].suit) };
    return canDrop(this.session.state, cards, home) ? home : undefined;
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

  /** Turns the stock, or turns the waste back into one. */
  draw(): void {
    if (this.busy) return;
    const result = this.session.play({ kind: 'draw' });
    if (!result) return;

    if (result.recycled) {
      // Everything goes back at once, face down. Rendered rather than
      // animated per card: twenty-four cards flying home in formation is a
      // second of nothing, every pass.
      this.renderBoard(true);
    } else {
      const state = this.session.state;
      state.waste.forEach((card, index) => {
        const sprite = this.sprites.get(card.id);
        if (!sprite) return;
        const to = this.cardPosition({ kind: 'waste', index: 0 }, index, state.waste);
        const isNew = result.drawn?.some((c) => c.id === card.id);
        if (isNew) {
          this.cardLayer.bringToTop(sprite);
          this.flipSprite(sprite, true);
          this.tweens.add({ targets: sprite, x: to.x, y: to.y, duration: DRAW_MS, ease: 'Cubic.easeOut' });
        } else {
          sprite.setPosition(to.x, to.y);
        }
      });
      this.restack();
    }
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
   * Flashes the best move available, without making it.
   *
   * Two flashes, the destination a beat behind the card: one outline on its
   * own says "look here" and leaves you to find the other half yourself,
   * which for a hint is most of the work.
   */
  hint(): void {
    if (this.locked) return;
    const [move] = this.session.hints();
    if (!move || move.kind !== 'play') return;

    const head = liftable(this.session.state, move.from, move.count)?.[0];
    const sprite = head && this.sprites.get(head.id);
    if (sprite) this.flash(sprite.x, sprite.y);
    const to = this.pileBase(move.to);
    this.flash(to.x, to.y, 120);
  }

  // A gold outline that grows and fades where something is worth looking at.
  private flash(x: number, y: number, delay = 0): void {
    const g = this.add.graphics();
    g.lineStyle(3, HIGHLIGHT_COLOR, 1);
    g.strokeRoundedRect(x - CARD_WIDTH / 2, y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 6);
    this.effectLayer.add(g);
    this.tweens.add({
      targets: g,
      alpha: 0,
      scale: 1.12,
      delay,
      duration: 620,
      ease: 'Quad.easeOut',
      onComplete: () => g.destroy(),
    });
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
      const move = autoFinishMove(this.session.state);
      const deck = this.session.state.stock.length + this.session.state.waste.length;
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
    // Let the cards fall for a moment before the page says anything. The
    // cascade *is* the reward; a panel over it half a second in is a
    // congratulation that interrupts itself.
    this.time.delayedCall(1400, () => {
      this.report.won({
        score: session.state.score,
        bonus,
        total: session.state.score + bonus,
        seconds,
        moves: session.state.moves,
        undos: session.undos,
        drawCount: session.drawCount,
      });
    });
    this.publish();
  }

  // --- hit testing ---------------------------------------------------------

  private toBoard(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return { x: pointer.x / this.pixelRatio, y: pointer.y / this.pixelRatio };
  }

  // Where a card is, in terms the rules understand.
  private locate(cardId: string): { ref: PileRef; pile: Card[]; index: number } | undefined {
    const state = this.session.state;
    const search: [PileRef, Card[]][] = [
      [{ kind: 'stock', index: 0 }, state.stock],
      [{ kind: 'waste', index: 0 }, state.waste],
      ...state.foundations.map((pile, i) => [{ kind: 'foundation', index: i }, pile] as [PileRef, Card[]]),
      ...state.tableau.map((pile, i) => [{ kind: 'tableau', index: i }, pile] as [PileRef, Card[]]),
    ];
    for (const [ref, pile] of search) {
      const index = pile.findIndex((card) => card.id === cardId);
      if (index >= 0) return { ref, pile, index };
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
  private dropTarget(head: { x: number; y: number }): PileRef | undefined {
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
    return best?.ref;
  }

  private dropZones(): { ref: PileRef; rect: Phaser.Geom.Rectangle }[] {
    const state = this.session.state;
    const zones: { ref: PileRef; rect: Phaser.Geom.Rectangle }[] = [];

    for (let i = 0; i < FOUNDATION_COUNT; i++) {
      const at = this.slotPosition({ kind: 'foundation', index: i });
      zones.push({
        ref: { kind: 'foundation', index: i },
        rect: new Phaser.Geom.Rectangle(at.x - CARD_WIDTH / 2, at.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT),
      });
    }

    for (let i = 0; i < TABLEAU_COUNT; i++) {
      const pile = state.tableau[i];
      const at = this.pileBase({ kind: 'tableau', index: i });
      // A pile's zone runs from its top card to the bottom of its last one,
      // and is as wide as the column: a run dropped anywhere down a long pile
      // is meant for that pile, not for the felt beside it.
      const offsets = this.tableauOffsets(pile);
      const depth = offsets.length ? offsets[offsets.length - 1] : 0;
      zones.push({
        ref: { kind: 'tableau', index: i },
        rect: new Phaser.Geom.Rectangle(
          at.x - COLUMN_PITCH / 2,
          at.y - CARD_HEIGHT / 2,
          COLUMN_PITCH,
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
    let key: string | undefined;
    if (ref && this.drag) {
      const lifted = liftable(this.session.state, this.drag.from, this.drag.count);
      if (lifted && canDrop(this.session.state, lifted, ref)) key = pileKey(ref);
    }
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
    const rt = this.add.renderTexture(0, 0, GAME_WIDTH * pr, GAME_HEIGHT * pr).setOrigin(0, 0);
    // Drawn at canvas resolution and displayed back down to board units, the
    // same bargain the card textures make: the trail is a ghost, but a soft
    // ghost looks like a mistake.
    rt.setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.root.addAt(rt, 1);
    this.cascade = rt;

    const state = this.session.state;
    // Off the top of each foundation in turn, so the four piles come apart
    // together rather than one at a time.
    const queue: Card[] = [];
    for (let depth = 12; depth >= 0; depth--) {
      for (const pile of state.foundations) if (pile[depth]) queue.push(pile[depth]);
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
          vx: (sprite.x < GAME_WIDTH / 2 ? -1 : 1) * Phaser.Math.FloatBetween(1.4, 4.2),
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

      const gone = sprite.x < -CARD_WIDTH || sprite.x > GAME_WIDTH + CARD_WIDTH;
      if (gone) sprite.setVisible(false);
      return !gone;
    });
  }
}

function pileKey(ref: PileRef): string {
  return `${ref.kind}-${ref.index}`;
}
