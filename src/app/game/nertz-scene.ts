import Phaser from 'phaser';
import { markBooted, renderScale, textOversample } from './lite';
import { CARD_HEIGHT, CARD_WIDTH } from './config';
import { Card } from './deck';
import { DeckStyle } from './deck-style';
import { DeckTheme } from './deck-theme';
import { CardSprite, preloadCardArt, renderCourtArt, setDeck } from './card-sprite';
import {
  Chips, Match, NertzMove, NertzPile, NertzState, RoundResult, SEATS, Seat, addRound, apply, autoTarget,
  DEFAULT_WORK_PILES, bothStuck, canCallNertz, canDrop, deal, finishRound, liftable, matchWinner, newMatch,
  noChips, roundScores, sameNertzPile, takeBackChip, throwChip, unstick,
} from './nertz';
import {
  CHIP_RADIUS, NERTZ_HEIGHT, NERTZ_WIDTH, Rect, cardSpot, chipHome, chipMiddle, foundationZone, handSpot,
  middleZone, overlap, pileSpot, workZone, FOUNDATION_INDICES, workIndices,
} from './nertz-layout';
import { DISPLAY_FONT, DISPLAY_WEIGHT } from './fonts';
import { PointerSample, pointerVelocity } from './gesture';
import { isMiddleFlick } from './nertz-gesture';
import { drawRecycleMark, drawSlot, drawTableSurface } from './table';

// The Nertz board for two, face to face.
//
// A different scene from the solitaire board, and on purpose. SolitaireScene
// is built around one hand, one pointer and one TableGame; this has two hands
// that are played at once, so there is more than one drag in flight at a time
// and the rules take a seat with every move. What they share is everything
// beneath that - the felt, the card sprites, the deck the player chose - and
// the rules for how it is all played live in nertz.ts, the layout in
// nertz-layout.ts, and this file only turns them into something to look at
// and something to put a thumb on.

export type NertzPhase = 'playing' | 'round' | 'match';

/** What the page's displays read, refreshed after anything that changes them. */
export interface NertzView {
  phase: NertzPhase;
  round: number;
  target: number;
  totals: [number, number];
  // This round, so far.
  up: [number, number];
  left: [number, number];
  scores: [number, number];
  canNertz: [boolean, boolean];
  // Whose Stuck chip is in the middle.
  chips: Chips;
  // How many times this round both chips went in and the hands moved on.
  // A count rather than a flag, so the page can tell each one apart.
  unstuck: number;
  last?: RoundResult;
  rounds: RoundResult[];
  winner?: Seat;
}

export interface NertzEvents {
  changed(view: NertzView): void;
}

export interface NertzInit {
  theme: DeckTheme;
  backColor: number;
  deckStyle?: DeckStyle;
  target: number;
  workPiles?: number;
  events: NertzEvents;
}

export const NERTZ_SCENE = 'nertz';

const MOVE_MS = 170;
const FLIP_MS = 110;
const DEAL_MS = 260;
const DEAL_STAGGER_MS = 14;
// A press that travels less than this is a tap. Generous: a thumb on glass
// never holds still.
const TAP_SLOP = 10;
// How much of a card a drop has to cover a pile to count as being on it.
const MIN_OVERLAP = 0.2 * CARD_WIDTH * CARD_HEIGHT;

// Enough pointer history to cover the flick window; see gesture.ts.
const SAMPLE_LIMIT = 8;
// The pop a flicked card makes as it lands, as in solitaire-scene.ts.
const LAND_POP_MS = 150;
const LAND_POP_SCALE = 1.07;

// How long both chips stay in the middle before they come home, so each
// player sees the other's land before the hands move on.
const CHIP_SETTLE_MS = 380;
const CHIP_FACE = 0xf4ecd8;
const CHIP_EDGE = 0xb3282f;
const CHIP_INK = '#8c1d24';

// Two hands, a thumb each, and room for a third finger that strays.
const EXTRA_POINTERS = 3;

interface Drag {
  seat: Seat;
  sprites: CardSprite[];
  from: NertzPile;
  count: number;
  origins: { x: number; y: number }[];
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
  // The tail of the gesture, for telling a throw from a carry.
  samples: PointerSample[];
}

interface ChipDrag {
  seat: Seat;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  samples: PointerSample[];
}

interface Located {
  seat: Seat;
  pile: NertzPile;
  cards: readonly Card[];
  index: number;
}

function seatOf(card: Card): Seat {
  return card.id.startsWith('p1-') ? 1 : 0;
}

export class NertzScene extends Phaser.Scene {
  private theme!: DeckTheme;
  private backColor!: number;
  private deckStyle: DeckStyle | undefined;
  private target = 100;
  private workPiles = DEFAULT_WORK_PILES;
  // `report`, not `events`: Phaser.Scene already has one.
  private report!: NertzEvents;

  private state!: NertzState;
  private match!: Match;
  private phase: NertzPhase = 'playing';
  private last: RoundResult | undefined;

  // The Stuck chips. See nertz.ts's Chips.
  private chips: Chips = noChips();
  private unstuck = 0;
  private chipSprites: Phaser.GameObjects.Container[] = [];
  private chipDrags = new Map<number, ChipDrag>();

  private pixelRatio = 1;
  private root!: Phaser.GameObjects.Container;
  private markings!: Phaser.GameObjects.Container;
  private cardLayer!: Phaser.GameObjects.Container;
  private chipLayer!: Phaser.GameObjects.Container;
  private sprites = new Map<string, CardSprite>();
  private stockZones: Phaser.GameObjects.Zone[] = [];

  // One drag per finger, which is the whole of what makes this two-player:
  // each pointer carries its own hand and neither knows about the other.
  private drags = new Map<number, Drag>();

  constructor() {
    super(NERTZ_SCENE);
  }

  init(data: NertzInit): void {
    this.theme = data.theme;
    this.backColor = data.backColor;
    this.deckStyle = data.deckStyle;
    this.target = data.target;
    this.workPiles = data.workPiles ?? DEFAULT_WORK_PILES;
    this.report = data.events;
  }

  preload(): void {
    setDeck(this.theme, this.backColor, this.deckStyle);
    preloadCardArt(this, this.theme);
  }

  create(): void {
    void renderCourtArt(this);
    this.pixelRatio = renderScale();
    drawTableSurface(this, this.pixelRatio);

    this.root = this.add.container(0, 0).setScale(this.pixelRatio);
    this.markings = this.add.container(0, 0);
    this.cardLayer = this.add.container(0, 0);
    // Over the cards: a chip in the middle sits in the gap between
    // foundations, but one being carried passes over everything.
    this.chipLayer = this.add.container(0, 0);
    this.root.add([this.markings, this.cardLayer, this.chipLayer]);
    this.printLayout();
    this.makeChips();

    // Phaser starts with a mouse and one finger. Two thumbs and a stray
    // third need more.
    this.input.addPointer(EXTRA_POINTERS);
    this.input.on(Phaser.Input.Events.GAMEOBJECT_DOWN, this.onDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.releaseAll(), this);

    this.match = newMatch(this.target);
    this.startRound();
    // The first frame is queued: the survival window starts here, not at
    // construction (see markBooted).
    markBooted();
  }

  // --- the felt -------------------------------------------------------------

  private printLayout(): void {
    const put = (object: Phaser.GameObjects.GameObject) => this.markings.add(object);
    for (const index of FOUNDATION_INDICES) {
      const z = foundationZone(index);
      put(drawSlot(this, z.x + CARD_WIDTH / 2, z.y + CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT));
    }
    for (const seat of SEATS) {
      for (const index of workIndices(this.workPiles)) {
        const at = pileSpot(seat, { kind: 'work', index }, this.workPiles);
        put(drawSlot(this, at.x, at.y, CARD_WIDTH, CARD_HEIGHT));
      }
      for (const kind of ['nertz', 'waste', 'stock'] as const) {
        const at = handSpot(seat, kind);
        put(drawSlot(this, at.x, at.y, CARD_WIDTH, CARD_HEIGHT));
        if (kind === 'stock') {
          put(drawRecycleMark(this, at.x, at.y, 15));
          // The empty stock is a slot rather than a card, and is the one
          // place a press has to work with nothing in it.
          const zone = this.add
            .zone(at.x, at.y, CARD_WIDTH, CARD_HEIGHT)
            .setInteractive(
              new Phaser.Geom.Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT),
              Phaser.Geom.Rectangle.Contains,
            );
          zone.setData('seat', seat);
          this.stockZones.push(zone);
          put(zone);
        }
      }
    }
  }

  // --- rounds ---------------------------------------------------------------

  private startRound(random: () => number = Math.random): void {
    this.releaseAll();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();

    this.state = deal(this.workPiles, random);
    this.phase = 'playing';
    this.last = undefined;
    this.chips = noChips();
    this.unstuck = 0;
    this.placeChips(false);

    let n = 0;
    for (const { cards, seat } of this.everyPile()) {
      for (const card of cards) {
        const stock = handSpot(seat, 'stock');
        const sprite = this.makeSprite(card, stock.x, stock.y);
        // Dealt out of the stock, a card at a time.
        sprite.setAlpha(0);
        this.tweens.add({
          targets: sprite, alpha: 1, duration: 1, delay: n++ * DEAL_STAGGER_MS * 0.2,
        });
      }
    }
    this.renderBoard(true, DEAL_MS);
    this.publish();
  }

  private makeSprite(card: Card, x: number, y: number): CardSprite {
    const sprite = new CardSprite(this, x, y, { ...card });
    // Texture space, not centred - see solitaire-scene.ts's makeSprite.
    sprite.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    );
    // Upside down for the player across the table, so a card is the right
    // way up for whoever owns it - including once it is on a foundation.
    sprite.setAngle(seatOf(card) === 1 ? 180 : 0);
    this.cardLayer.add(sprite);
    this.sprites.set(card.id, sprite);
    return sprite;
  }

  private *everyPile(): Generator<Located & { ref: NertzPile }> {
    for (const seat of SEATS) {
      const hand = this.state.hands[seat];
      const named: [NertzPile, readonly Card[]][] = [
        [{ kind: 'stock' }, hand.stock],
        [{ kind: 'nertz' }, hand.nertz],
        [{ kind: 'waste' }, hand.waste],
        ...hand.work.map((cards, index): [NertzPile, readonly Card[]] => [{ kind: 'work', index }, cards]),
      ];
      for (const [pile, cards] of named) yield { seat, pile, ref: pile, cards, index: 0 };
    }
    for (const index of FOUNDATION_INDICES) {
      yield { seat: 0, pile: { kind: 'foundation', index }, ref: { kind: 'foundation', index }, cards: this.state.foundations[index], index: 0 };
    }
  }

  private locate(cardId: string): Located | undefined {
    for (const { seat, pile, cards } of this.everyPile()) {
      const index = cards.findIndex((card) => card.id === cardId);
      if (index >= 0) return { seat, pile, cards, index };
    }
    return undefined;
  }

  // --- drawing the state ----------------------------------------------------

  private position(seat: Seat, pile: NertzPile, index: number, count: number): { x: number; y: number } {
    const at = cardSpot(seat, pile, index, count, this.workPiles);
    // A deep pile reads as one: a sliver of thickness toward the middle of
    // the table, so a Nertz pile of thirteen is not mistaken for a card.
    if (pile.kind === 'nertz' || pile.kind === 'stock') {
      const thick = Math.min(index * 0.45, 8);
      return { x: at.x, y: at.y + (seat === 0 ? -thick : thick) };
    }
    return { x: at.x, y: at.y };
  }

  private renderBoard(animate = true, duration = MOVE_MS): void {
    const held = new Set<CardSprite>();
    for (const drag of this.drags.values()) for (const s of drag.sprites) held.add(s);

    for (const { pile, cards } of this.everyPile()) {
      cards.forEach((card, index) => {
        const sprite = this.sprites.get(card.id);
        if (!sprite || held.has(sprite)) return;
        const to = this.position(seatOf(card), pile, index, cards.length);
        if (sprite.card.faceUp !== card.faceUp) this.flipSprite(sprite, card.faceUp);
        if (animate && (Math.abs(sprite.x - to.x) > 0.5 || Math.abs(sprite.y - to.y) > 0.5)) {
          this.tweens.add({ targets: sprite, x: to.x, y: to.y, duration, ease: 'Cubic.easeOut' });
        } else {
          sprite.setPosition(to.x, to.y);
        }
      });
    }
    this.restack();
  }

  private restack(): void {
    // Before the first deal there is nothing to put in order.
    if (!this.state) return;
    for (const { cards } of this.everyPile()) {
      for (const card of cards) {
        const sprite = this.sprites.get(card.id);
        if (sprite) this.cardLayer.bringToTop(sprite);
      }
    }
    for (const drag of this.drags.values()) for (const s of drag.sprites) this.cardLayer.bringToTop(s);
  }

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

  // --- what the players do --------------------------------------------------

  private get live(): boolean {
    return this.phase === 'playing';
  }

  private toBoard(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return { x: pointer.x / this.pixelRatio, y: pointer.y / this.pixelRatio };
  }

  private onDown(pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject): void {
    if (!this.live || this.drags.has(pointer.id) || this.chipDrags.has(pointer.id)) return;
    const chip = this.chipSprites.indexOf(object as Phaser.GameObjects.Container);
    if (chip >= 0) {
      // One finger to a chip: a second would only fight the first for it.
      if (!this.chipHeld(chip as Seat)) this.pickUpChip(pointer, chip as Seat);
      return;
    }
    if (this.stockZones.includes(object as Phaser.GameObjects.Zone)) {
      this.draw(object.getData('seat') as Seat);
      return;
    }
    const sprite = object as CardSprite;
    if (!(sprite instanceof CardSprite)) return;
    const found = this.locate(sprite.card.id);
    if (!found) return;

    if (found.pile.kind === 'stock') {
      this.draw(found.seat);
      return;
    }
    const count = found.pile.kind === 'work' ? found.cards.length - found.index : 1;
    // Only the card on top of the Nertz pile or the waste can be picked up.
    if (found.pile.kind !== 'work' && found.index !== found.cards.length - 1) return;
    const cards = liftable(this.state, found.seat, found.pile, count);
    if (!cards) return;

    const sprites = cards.map((c) => this.sprites.get(c.id)).filter((s): s is CardSprite => !!s);
    const board = this.toBoard(pointer);
    this.drags.set(pointer.id, {
      seat: found.seat,
      sprites,
      from: found.pile,
      count,
      origins: sprites.map((s) => ({ x: s.x, y: s.y })),
      offsetX: sprites[0].x - board.x,
      offsetY: sprites[0].y - board.y,
      startX: board.x,
      startY: board.y,
      moved: false,
      samples: [{ x: board.x, y: board.y, t: pointer.downTime }],
    });
    // Cancel any tween still carrying these, or it fights the thumb.
    for (const s of sprites) this.tweens.killTweensOf(s);
    for (const s of sprites) this.cardLayer.bringToTop(s);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (this.chipDrags.has(pointer.id)) {
      this.moveChip(pointer);
      return;
    }
    const drag = this.drags.get(pointer.id);
    if (!drag) return;
    const board = this.toBoard(pointer);
    if (Math.abs(board.x - drag.startX) > TAP_SLOP || Math.abs(board.y - drag.startY) > TAP_SLOP) {
      drag.moved = true;
    }
    drag.samples.push({ x: board.x, y: board.y, t: pointer.moveTime });
    if (drag.samples.length > SAMPLE_LIMIT) drag.samples.shift();
    const head = { x: board.x + drag.offsetX, y: board.y + drag.offsetY };
    drag.sprites.forEach((sprite, i) => {
      sprite.setPosition(head.x, head.y + (drag.origins[i].y - drag.origins[0].y));
    });
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (this.chipDrags.has(pointer.id)) {
      this.dropChip(pointer);
      return;
    }
    const drag = this.drags.get(pointer.id);
    if (!drag) return;
    this.drags.delete(pointer.id);

    const head = drag.sprites[0];
    const landed = drag.moved ? this.dropTarget(drag, { x: head.x, y: head.y }) : undefined;
    // As in the single-player scene, a pile the card was let go over wins over
    // a throw, and a throw that finds no home falls through to a plain drop.
    const thrown = landed ? undefined : this.flickTarget(drag, pointer);
    const to = landed ?? thrown ?? (drag.moved ? undefined : autoTarget(this.state, drag.seat, drag.from, drag.count));
    const played = this.live && to
      ? this.play({ kind: 'play', seat: drag.seat, from: drag.from, to, count: drag.count })
      : false;
    if (played && thrown) this.landHard(head);
    if (!played) {
      // A refused drop - or one that lost the race for a foundation - puts
      // the cards back where they came from.
      drag.sprites.forEach((sprite, i) => {
        this.tweens.add({
          targets: sprite, x: drag.origins[i].x, y: drag.origins[i].y,
          duration: MOVE_MS, ease: 'Cubic.easeOut',
        });
      });
      this.restack();
    }
  }

  /**
   * The foundation a card was thrown at, if it was thrown at all: the one a
   * tap would have picked. Single cards only; anything refused answers
   * nothing and the release is an ordinary drop.
   */
  private flickTarget(drag: Drag, pointer: Phaser.Input.Pointer): NertzPile | undefined {
    if (drag.count !== 1 || !drag.moved || !this.live) return undefined;
    const board = this.toBoard(pointer);
    const velocity = pointerVelocity(drag.samples, { x: board.x, y: board.y, t: pointer.upTime });
    if (!isMiddleFlick(velocity, drag.seat)) return undefined;
    const home = autoTarget(this.state, drag.seat, drag.from, 1);
    return home?.kind === 'foundation' ? home : undefined;
  }

  private landHard(sprite: CardSprite): void {
    this.tweens.add({
      targets: sprite,
      scaleX: LAND_POP_SCALE,
      scaleY: LAND_POP_SCALE,
      duration: LAND_POP_MS / 2,
      delay: MOVE_MS * 0.8,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => sprite.setScale(1),
    });
  }

  private releaseAll(): void {
    for (const drag of this.drags.values()) {
      drag.sprites.forEach((s, i) => s.setPosition(drag.origins[i].x, drag.origins[i].y));
    }
    this.drags.clear();
    this.restack();
    if (this.chipDrags.size) {
      this.chipDrags.clear();
      this.placeChips(false);
    }
  }

  /** The pile a dragged run was let go over, if it will take it. */
  private dropTarget(drag: Drag, at: { x: number; y: number }): NertzPile | undefined {
    const cards = drag.sprites.map((s) => s.card);
    const rect: Rect = { x: at.x - CARD_WIDTH / 2, y: at.y - CARD_HEIGHT / 2, width: CARD_WIDTH, height: CARD_HEIGHT };
    let best: { pile: NertzPile; area: number } | undefined;
    const consider = (pile: NertzPile, zone: Rect) => {
      if (sameNertzPile(pile, drag.from)) return;
      const area = overlap(rect, zone);
      if (area < MIN_OVERLAP || !canDrop(this.state, drag.seat, cards, pile)) return;
      if (!best || area > best.area) best = { pile, area };
    };
    for (const index of FOUNDATION_INDICES) consider({ kind: 'foundation', index }, foundationZone(index));
    for (const index of workIndices(this.workPiles)) {
      consider({ kind: 'work', index }, workZone(drag.seat, index, this.state.hands[drag.seat].work[index].length, this.workPiles));
    }
    return (best as { pile: NertzPile } | undefined)?.pile;
  }

  private play(move: NertzMove): boolean {
    const result = apply(this.state, move);
    if (!result) return false;
    this.state = result.state;
    // Playing a card is not being stuck, so it takes that player's chip back.
    // Turning the stock is not a play: it is what somebody waiting on the
    // other player's chip does with their hands.
    if (move.kind === 'play' && this.chips[move.seat]) {
      this.chips = takeBackChip(this.chips, move.seat);
      this.placeChip(move.seat, true);
    }
    this.renderBoard(true);
    this.publish();
    return true;
  }

  private draw(seat: Seat): void {
    if (!this.live) return;
    this.play({ kind: 'draw', seat });
  }

  // --- the Stuck chips ------------------------------------------------------

  private makeChips(): void {
    for (const seat of SEATS) {
      const face = this.add.graphics();
      face.fillStyle(0x000000, 0.28);
      face.fillCircle(1.5, 2.5, CHIP_RADIUS);
      face.fillStyle(CHIP_FACE, 1);
      face.fillCircle(0, 0, CHIP_RADIUS);
      face.lineStyle(4, CHIP_EDGE, 1);
      face.strokeCircle(0, 0, CHIP_RADIUS - 2);
      // The notches round a poker chip's rim, so it reads as a chip at a glance.
      face.fillStyle(CHIP_FACE, 1);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        face.fillCircle(Math.cos(a) * (CHIP_RADIUS - 2), Math.sin(a) * (CHIP_RADIUS - 2), 2.2);
      }
      const label = this.add.text(0, 0, 'STUCK', {
        fontFamily: DISPLAY_FONT,
        fontSize: '9px',
        fontStyle: DISPLAY_WEIGHT,
        color: CHIP_INK,
        resolution: this.pixelRatio * textOversample(),
      }).setOrigin(0.5);
      const chip = this.add.container(0, 0, [face, label]);
      // A container's hit area is measured from its top-left corner.
      chip.setSize(CHIP_RADIUS * 2, CHIP_RADIUS * 2);
      chip.setInteractive(
        new Phaser.Geom.Circle(CHIP_RADIUS, CHIP_RADIUS, CHIP_RADIUS + 4),
        Phaser.Geom.Circle.Contains,
      );
      chip.setAngle(seat === 1 ? 180 : 0);
      this.chipLayer.add(chip);
      this.chipSprites.push(chip);
    }
    this.placeChips(false);
  }

  private chipSpot(seat: Seat): { x: number; y: number } {
    return this.chips[seat] ? chipMiddle(seat) : chipHome(seat);
  }

  private chipHeld(seat: Seat): boolean {
    for (const drag of this.chipDrags.values()) if (drag.seat === seat) return true;
    return false;
  }

  /** Sends a chip to where the rules say it is - unless a finger has it, in which case dropChip will. */
  private placeChip(seat: Seat, animate: boolean, delay = 0): void {
    const chip = this.chipSprites[seat];
    if (!chip || this.chipHeld(seat)) return;
    const to = this.chipSpot(seat);
    this.tweens.killTweensOf(chip);
    chip.setScale(1);
    if (animate) {
      this.tweens.add({ targets: chip, x: to.x, y: to.y, duration: MOVE_MS * 1.4, delay, ease: 'Cubic.easeOut' });
    } else {
      chip.setPosition(to.x, to.y);
    }
  }

  private placeChips(animate: boolean, delay = 0): void {
    for (const seat of SEATS) this.placeChip(seat, animate, delay);
  }

  private pickUpChip(pointer: Phaser.Input.Pointer, seat: Seat): void {
    const chip = this.chipSprites[seat];
    const board = this.toBoard(pointer);
    this.tweens.killTweensOf(chip);
    this.chipDrags.set(pointer.id, {
      seat,
      startX: board.x,
      startY: board.y,
      offsetX: chip.x - board.x,
      offsetY: chip.y - board.y,
      moved: false,
      samples: [{ x: board.x, y: board.y, t: pointer.downTime }],
    });
    this.chipLayer.bringToTop(chip);
  }

  private moveChip(pointer: Phaser.Input.Pointer): void {
    const drag = this.chipDrags.get(pointer.id)!;
    const board = this.toBoard(pointer);
    if (Math.abs(board.x - drag.startX) > TAP_SLOP || Math.abs(board.y - drag.startY) > TAP_SLOP) {
      drag.moved = true;
    }
    drag.samples.push({ x: board.x, y: board.y, t: pointer.moveTime });
    if (drag.samples.length > SAMPLE_LIMIT) drag.samples.shift();
    this.chipSprites[drag.seat].setPosition(board.x + drag.offsetX, board.y + drag.offsetY);
  }

  /**
   * A chip let go. Into the middle if it was dropped over the foundations or
   * thrown toward them; a tap on a chip already in takes it back; anything
   * else and it goes back to where it was.
   */
  private dropChip(pointer: Phaser.Input.Pointer): void {
    const drag = this.chipDrags.get(pointer.id)!;
    this.chipDrags.delete(pointer.id);
    const { seat } = drag;
    if (!this.live) {
      this.placeChip(seat, true);
      return;
    }
    const chip = this.chipSprites[seat];
    const board = this.toBoard(pointer);
    const rect: Rect = { x: chip.x - CHIP_RADIUS, y: chip.y - CHIP_RADIUS, width: CHIP_RADIUS * 2, height: CHIP_RADIUS * 2 };
    const over = overlap(rect, middleZone()) > 0;
    const thrown = drag.moved &&
      isMiddleFlick(pointerVelocity(drag.samples, { x: board.x, y: board.y, t: pointer.upTime }), seat);

    if (!drag.moved) {
      if (this.chips[seat]) this.chips = takeBackChip(this.chips, seat);
    } else if (over || thrown) {
      this.chips = throwChip(this.chips, seat);
    } else {
      // Carried out of the middle, or never got there: it is not in.
      this.chips = takeBackChip(this.chips, seat);
    }
    this.placeChip(seat, true);
    // A chip under the other player's finger is on its way somewhere, not in.
    const other: Seat = seat === 0 ? 1 : 0;
    if (bothStuck(this.chips) && !this.chipHeld(other)) this.moveHandsOn();
    else this.publish();
  }

  /** Both chips are in: every hand moves on a card, and the chips come home. */
  private moveHandsOn(): void {
    // A card off the waste is about to go back under the stock, so a thumb
    // holding one lets go of it. Anything else being carried is unaffected.
    for (const [id, drag] of this.drags) {
      if (drag.from.kind !== 'waste') continue;
      drag.sprites.forEach((s, i) => s.setPosition(drag.origins[i].x, drag.origins[i].y));
      this.drags.delete(id);
    }
    this.state = unstick(this.state);
    this.chips = noChips();
    this.unstuck += 1;
    this.renderBoard(true);
    // The last chip is still on its way in: let it land, let both sit there a
    // moment, then send them home. Read from the rules when it fires, so a
    // chip thrown again in the meantime stays where it was thrown.
    this.time.delayedCall(MOVE_MS * 1.4 + CHIP_SETTLE_MS, () => this.placeChips(true));
    this.publish();
  }

  // --- the page's controls --------------------------------------------------

  /** A player says Nertz. Only legal once their pile is empty. */
  callNertz(seat: Seat): boolean {
    if (this.phase !== 'playing' || !canCallNertz(this.state, seat)) return false;
    this.endRound(seat);
    return true;
  }

  /**
   * Ends the round without a Nertz, scored as it stands. From the pause
   * menu, for a round nobody can get anything more out of.
   */
  endRoundNow(): void {
    if (this.phase === 'playing') this.endRound(undefined);
  }

  nextRound(): void {
    if (this.phase === 'round') this.startRound();
  }

  rematch(): void {
    this.match = newMatch(this.target);
    this.startRound();
  }

  setPaused(paused: boolean): void {
    if (paused) {
      this.releaseAll();
      this.scene.pause();
    } else {
      this.scene.resume();
    }
  }

  gameSize(): { width: number; height: number } {
    return { width: NERTZ_WIDTH, height: NERTZ_HEIGHT };
  }

  private endRound(nertz: Seat | undefined): void {
    this.releaseAll();
    this.last = finishRound(this.state, nertz);
    this.match = addRound(this.match, this.last);
    this.phase = matchWinner(this.match) === undefined ? 'round' : 'match';
    this.publish();
  }

  // --- what the page is told ------------------------------------------------

  private publish(): void {
    this.report.changed({
      phase: this.phase,
      round: this.match.rounds.length + (this.phase === 'playing' ? 1 : 0),
      target: this.match.target,
      totals: this.match.totals,
      up: this.state.up,
      left: [this.state.hands[0].nertz.length, this.state.hands[1].nertz.length],
      scores: roundScores(this.state),
      canNertz: [canCallNertz(this.state, 0), canCallNertz(this.state, 1)],
      chips: this.chips,
      unstuck: this.unstuck,
      last: this.last,
      rounds: this.match.rounds,
      winner: matchWinner(this.match),
    });
  }
}
