import Phaser from 'phaser';
import { CARD_HEIGHT, CARD_WIDTH } from './config';
import { Card } from './deck';
import { DeckStyle } from './deck-style';
import { DeckTheme } from './deck-theme';
import { CardSprite, preloadCardArt, renderCourtArt, setDeck } from './card-sprite';
import {
  Match, NertzMove, StuckTalk, NertzPile, NertzState, RoundResult, SEATS, Seat, addRound, agreeToEnd, apply, autoTarget, bothAgreed, carryOn, drawRefused,
  DEFAULT_WORK_PILES, canCallNertz, canDrop, deal, finishRound, liftable, matchWinner, newMatch,
  newTalk, promptShowing, roundScores, sameNertzPile, tableStuck, talkAfter,
} from './nertz';
import {
  NERTZ_HEIGHT, NERTZ_WIDTH, Rect, cardSpot, foundationZone, handSpot, overlap, pileSpot,
  workZone, FOUNDATION_INDICES, workIndices,
} from './nertz-layout';
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
  // Both players have run out of moves on the table and are turning their
  // hands over to see whether anything is left in them.
  flipping: boolean;
  // ...and have, and are being asked whether to carry on.
  prompt: boolean;
  agreed: [boolean, boolean];
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

  // Stuck handling. See publish().
  private talk: StuckTalk = newTalk();

  private pixelRatio = 1;
  private root!: Phaser.GameObjects.Container;
  private markings!: Phaser.GameObjects.Container;
  private cardLayer!: Phaser.GameObjects.Container;
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
    this.pixelRatio = window.devicePixelRatio || 1;
    drawTableSurface(this, this.pixelRatio);

    this.root = this.add.container(0, 0).setScale(this.pixelRatio);
    this.markings = this.add.container(0, 0);
    this.cardLayer = this.add.container(0, 0);
    this.root.add([this.markings, this.cardLayer]);
    this.printLayout();

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
    this.talk = newTalk();

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
    return this.phase === 'playing' && !this.promptShowing;
  }

  private toBoard(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return { x: pointer.x / this.pixelRatio, y: pointer.y / this.pixelRatio };
  }

  private onDown(pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject): void {
    if (!this.live || this.drags.has(pointer.id)) return;
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
    this.talk = talkAfter(this.talk, this.state, move, result.recycled === true);
    this.renderBoard(true);
    this.publish();
    return true;
  }

  private draw(seat: Seat): void {
    if (!this.live) return;
    if (this.play({ kind: 'draw', seat })) return;
    // Nothing to turn: still a reason to ask again if the prompt was waved away.
    this.talk = drawRefused(this.talk);
    this.publish();
  }

  // --- the page's controls --------------------------------------------------

  /** A player says Nertz. Only legal once their pile is empty. */
  callNertz(seat: Seat): boolean {
    if (this.phase !== 'playing' || !canCallNertz(this.state, seat)) return false;
    this.endRound(seat);
    return true;
  }

  /** One player's half of ending a round on which both are stuck. */
  agreeToEnd(seat: Seat): void {
    if (!this.promptShowing) return;
    this.talk = agreeToEnd(this.talk, seat);
    if (bothAgreed(this.talk)) this.endRound(undefined);
    else this.publish();
  }

  /** Either player may say to keep going. */
  continuePlay(): void {
    if (!this.promptShowing) return;
    this.talk = carryOn();
    this.publish();
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

  private get tableStuck(): boolean {
    return this.phase === 'playing' && tableStuck(this.state);
  }

  private get promptShowing(): boolean {
    return this.phase === 'playing' && promptShowing(this.state, this.talk);
  }

  private publish(): void {
    const stuck = this.tableStuck;
    const prompt = this.promptShowing;
    this.report.changed({
      phase: this.phase,
      round: this.match.rounds.length + (this.phase === 'playing' ? 1 : 0),
      target: this.match.target,
      totals: this.match.totals,
      up: this.state.up,
      left: [this.state.hands[0].nertz.length, this.state.hands[1].nertz.length],
      scores: roundScores(this.state),
      canNertz: [canCallNertz(this.state, 0), canCallNertz(this.state, 1)],
      flipping: stuck && !prompt && !this.talk.dismissed,
      prompt,
      agreed: this.talk.agreed,
      last: this.last,
      rounds: this.match.rounds,
      winner: matchWinner(this.match),
    });
  }
}
