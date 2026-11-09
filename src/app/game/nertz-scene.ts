import { Board, BoardPointer, Sprite, cardsReady, createBoard, defineStack, flipCard, riffleShuffle } from '@exterkamp/felt';
import { markBooted, renderScale } from './lite';
import { CARD_HEIGHT, CARD_WIDTH } from './config';
import { Card } from './deck';
import { DeckStyle } from './deck-style';
import { DeckTheme } from './deck-theme';
import { CardSprite, renderCourtArt, setDeck } from './card-sprite';
import { Markings, Stacking, after, pausable } from './felt-kit';
import {
  Chips, Match, NertzMove, NertzPile, NertzState, RoundResult, SEATS, Seat, addRound, apply, autoTarget,
  DEFAULT_WORK_PILES, bothStuck, canCallNertz, canDrop, deal, finishRound, liftable, matchWinner, newMatch,
  noChips, roundScores, sameNertzPile, takeBackChip, throwChip, unstick,
} from './nertz';
import {
  CHIP_RADIUS, NertzLayout, Rect, nertzHeightFor, overlap, FOUNDATION_INDICES, workIndices,
} from './nertz-layout';
import { DISPLAY_FONT, DISPLAY_WEIGHT } from './fonts';
import { PointerSample, pointerVelocity } from './gesture';
import { isMiddleFlick } from './nertz-gesture';
import { FELT_CLEAR_COLOR, drawRecycleMark, drawSlot, drawTableSurface } from './table';

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

/** A match in progress, as plain data - see SavedGames. */
export interface NertzSnapshot {
  workPiles: number;
  match: Match;
  phase: NertzPhase;
  state: NertzState;
  chips: Chips;
  unstuck: number;
  last?: RoundResult;
}

export interface NertzInit {
  /** A match to pick up where it was left, rather than a new one. */
  resume?: NertzSnapshot;
  theme: DeckTheme;
  backColor: number;
  deckStyle?: DeckStyle;
  target: number;
  workPiles?: number;
  /** Whether a round opens with each player riffling their deck. */
  showShuffle?: boolean;
  events: NertzEvents;
}

const MOVE_MS = 170;
const FLIP_MS = 110;
const DEAL_MS = 260;
const DEAL_STAGGER_MS = 14;
// The round's deal, after the riffle: a card every this-many milliseconds
// off each player's stock, both players at once.
const ROUND_DEAL_STAGGER_MS = 62;
const CARRY_MS = 200;
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

// The chips are drawn over every card.
const CHIP_DEPTH = 1_000_000;

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

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

// Foundations are built by two players slapping cards down at speed, so they
// land askew: each card a little off centre and turned, by an amount fixed
// to the card itself so a re-render never shuffles the mess around.
const MESS_SHIFT = 5;
const MESS_TURN = 9;

function mess(card: Card): { dx: number; dy: number; turn: number } {
  let h = 2166136261;
  for (let i = 0; i < card.id.length; i++) h = Math.imul(h ^ card.id.charCodeAt(i), 16777619);
  const unit = (shift: number) => (((h >>> shift) & 0xff) / 255) * 2 - 1;
  return { dx: unit(0) * MESS_SHIFT, dy: unit(8) * MESS_SHIFT, turn: unit(16) * MESS_TURN };
}

export class NertzScene {
  readonly board: Board;
  private theme!: DeckTheme;
  private backColor!: number;
  private deckStyle: DeckStyle | undefined;
  private target = 100;
  private workPiles = DEFAULT_WORK_PILES;
  private report!: NertzEvents;

  private state!: NertzState;
  private match!: Match;
  private phase: NertzPhase = 'playing';
  // The riffle and the deal at the top of a round, while nobody may play.
  // Counted rather than flagged, so a round restarted mid-deal leaves the
  // old deal nothing to finish.
  private dealing = 0;
  private deals = 0;
  private showShuffle = true;
  private last: RoundResult | undefined;
  private resume?: NertzSnapshot;
  // Whether anybody has done anything this match, so a deal looked at and
  // left is not kept as a match in progress.
  private touched = false;

  // The Stuck chips. See nertz.ts's Chips.
  private chips: Chips = noChips();
  private unstuck = 0;
  private chipSprites: Sprite[] = [];
  private chipDrags = new Map<number, ChipDrag>();

  private readonly markings: Markings;
  // Cards in their order, and the chips over them: a chip in the middle sits
  // in the gap between foundations, but one being carried passes over
  // everything.
  private readonly stacking = new Stacking();
  private readonly chipStacking = new Stacking();
  private readonly setBoardPaused: (paused: boolean) => void;
  private readonly facing = new WeakMap<CardSprite, boolean>();
  private stopInput: () => void = () => {};
  /** How fast the board's clock runs. Only ever changed by the smoke test. */
  timeScale = 1;
  private sprites = new Map<string, CardSprite>();

  // One drag per finger, which is the whole of what makes this two-player:
  // each pointer carries its own hand and neither knows about the other.
  private drags = new Map<number, Drag>();
  // Where everything sits, at the height this board was built.
  private readonly layout: NertzLayout;

  constructor(parent: HTMLElement, init: NertzInit) {
    this.init(init);
    // Built to the shape of the box it is shown in, so the felt reaches both
    // sides of the screen - see NertzLayout.
    const aspect = parent.clientWidth > 0 ? parent.clientHeight / parent.clientWidth : undefined;
    this.layout = new NertzLayout(nertzHeightFor(aspect));
    this.board = createBoard({
      parent,
      width: this.layout.width,
      height: this.layout.height,
      backgroundColor: FELT_CLEAR_COLOR,
      pixelRatio: renderScale(),
      // Lifted and swinging in the hand - see onDown.
      pickUp: true,
    });
    this.markings = new Markings(this.board);
    this.setBoardPaused = pausable(this.board, () => this.timeScale);
    this.create();
  }

  /** Takes the board down, canvas and all. */
  destroy(): void {
    this.stopInput();
    this.board.destroy();
  }

  private init(data: NertzInit): void {
    this.theme = data.theme;
    this.backColor = data.backColor;
    this.deckStyle = data.deckStyle;
    this.target = data.target;
    this.workPiles = data.resume?.workPiles ?? data.workPiles ?? DEFAULT_WORK_PILES;
    this.resume = data.resume;
    if (data.resume) this.target = data.resume.match.target;
    this.showShuffle = data.showShuffle ?? true;
    this.report = data.events;
  }

  private create(): void {
    setDeck(this.theme, this.backColor, this.deckStyle);
    void renderCourtArt(this.board);
    drawTableSurface(this.board);
    this.printLayout();
    this.makeChips();

    // Every finger on the glass is its own pointer: felt tracks each press
    // by id and captures it, so a thumb that slides off the canvas still
    // lets go here.
    const down = (p: BoardPointer) => this.onDown(p);
    const move = (p: BoardPointer) => this.onMove(p);
    const up = (p: BoardPointer) => this.onUp(p);
    this.board.on('pointerdown', down).on('pointermove', move).on('pointerup', up);
    this.stopInput = () => {
      this.board.off('pointerdown', down).off('pointermove', move).off('pointerup', up);
    };

    if (this.resume) {
      this.restore(this.resume);
      this.resume = undefined;
    } else {
      this.match = newMatch(this.target);
      this.startRound();
    }
    // The first frame is queued: the survival window starts here, not at
    // construction (see markBooted).
    markBooted();
  }

  // --- the felt -------------------------------------------------------------

  private printLayout(): void {
    const board = this.board;
    const put = (sprite: Sprite) => this.markings.add(sprite);
    for (const index of FOUNDATION_INDICES) {
      const z = this.layout.foundationZone(index);
      put(drawSlot(board, z.x + CARD_WIDTH / 2, z.y + CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT));
    }
    for (const seat of SEATS) {
      for (const index of workIndices(this.workPiles)) {
        const at = this.layout.pileSpot(seat, { kind: 'work', index }, this.workPiles);
        put(drawSlot(board, at.x, at.y, CARD_WIDTH, CARD_HEIGHT));
      }
      for (const kind of ['nertz', 'waste', 'stock'] as const) {
        const at = this.layout.handSpot(seat, kind);
        put(drawSlot(board, at.x, at.y, CARD_WIDTH, CARD_HEIGHT));
        if (kind === 'stock') {
          // The empty stock is a slot rather than a card, and is the one
          // place a press has to work with nothing in it - see onDown.
          put(drawRecycleMark(board, at.x, at.y, 15));
        }
      }
    }
  }

  // --- rounds ---------------------------------------------------------------

  /** The match as plain data, or nothing if it has not been played yet. */
  snapshot(): NertzSnapshot | undefined {
    if (!this.state || !this.touched || this.phase === 'match') return undefined;
    return {
      workPiles: this.workPiles,
      match: this.match,
      phase: this.phase,
      state: this.state,
      chips: this.chips,
      unstuck: this.unstuck,
      last: this.last,
    };
  }

  /**
   * A saved match back on the table, every card where it was left: no
   * riffle and no deal, because this round was dealt already.
   */
  private restore(saved: NertzSnapshot): void {
    this.match = saved.match;
    this.state = saved.state;
    this.phase = saved.phase;
    this.chips = saved.chips;
    this.unstuck = saved.unstuck;
    this.last = saved.last;
    this.touched = true;
    for (const { seat, pile, cards } of this.everyPile()) {
      cards.forEach((card, index) => {
        const at = this.position(seat, pile, index, cards.length, card);
        this.makeSprite(card, at.x, at.y);
      });
    }
    this.placeChips(false);
    this.renderBoard(false);
    this.publish();
  }

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

    // Every card starts in its owner's hands, face down: the deck is
    // riffled, set down on the stock, and dealt from there.
    for (const { cards, seat } of this.everyPile()) {
      const stock = this.layout.handSpot(seat, 'stock');
      for (const card of cards) this.makeSprite({ ...card, faceUp: false }, stock.x, stock.y);
    }
    this.restack();
    void this.shuffleAndDeal(++this.deals);
    this.publish();
  }

  /**
   * The top of a round: each player's deck riffled in front of them - both at
   * once, the way two people sit down and shuffle - then squared on their
   * stock and dealt from it, the Nertz pile counted off first and the work
   * row after, a card at a time.
   */
  private async shuffleAndDeal(deal: number): Promise<void> {
    this.dealing = deal;
    const stale = () => this.board.isDestroyed || this.deals !== deal;
    await cardsReady(this.board);
    if (stale()) return;

    const decks = SEATS.map((seat) => {
      const hand = this.state.hands[seat];
      const ids = [...hand.stock, ...hand.nertz, ...hand.work.flat()].map((card) => card.id);
      return ids.map((id) => this.sprites.get(id)).filter((s): s is CardSprite => !!s);
    });
    const shuffle = this.showShuffle && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (shuffle) {
      await Promise.all(SEATS.map(async (seat) => {
        const stock = this.layout.handSpot(seat, 'stock');
        // In front of the player, between their hand and their work row: a
        // pack cut in half on the stock would put a half off the table.
        const at = { x: this.layout.width / 2, y: stock.y + (seat === 0 ? -1 : 1) * (CARD_HEIGHT + 24) };
        const deck = decks[seat];
        for (const sprite of deck) sprite.setPosition(at.x, at.y);
        await riffleShuffle(this.board, deck, defineStack({ id: `riffle-${seat}`, x: at.x, y: at.y }), {
          duration: 140, stagger: 4,
        });
        if (stale()) return;
        // The riffle squares a pack upright; the far player's is theirs again.
        for (const sprite of deck) sprite.setAngle(seat === 1 ? 180 : 0);
        await this.board.tweens.to(deck, { x: stock.x, y: stock.y, duration: CARRY_MS, ease: 'Cubic.easeInOut' });
      }));
      if (stale()) return;
    }

    // Off the stock: the Nertz pile first, then one to each work pile.
    let longest = 0;
    for (const seat of SEATS) {
      const hand = this.state.hands[seat];
      const going: { card: Card; pile: NertzPile; index: number; count: number }[] = [
        ...hand.nertz.map((card, index) => ({ card, pile: { kind: 'nertz' } as NertzPile, index, count: hand.nertz.length })),
        ...hand.work.flatMap((cards, w) => cards.map((card, index) => ({
          card, pile: { kind: 'work', index: w } as NertzPile, index, count: cards.length,
        }))),
      ];
      longest = Math.max(longest, going.length);
      going.forEach(({ card, pile, index, count }, i) => {
        const sprite = this.sprites.get(card.id);
        if (!sprite) return;
        const to = this.position(seat, pile, index, count);
        this.board.tweens.add({
          targets: sprite, x: to.x, y: to.y,
          duration: DEAL_MS, delay: i * ROUND_DEAL_STAGGER_MS, ease: 'Cubic.easeOut',
          onStart: () => this.stacking.bringToTop(sprite),
          onComplete: () => {
            if (card.faceUp && !stale()) this.flipSprite(sprite, true);
          },
        });
      });
    }
    after(this.board, longest * ROUND_DEAL_STAGGER_MS + DEAL_MS + FLIP_MS * 2, () => {
      if (stale()) return;
      this.dealing = 0;
      this.renderBoard(false);
      this.publish();
    });
  }

  private makeSprite(card: Card, x: number, y: number): CardSprite {
    const sprite = new CardSprite(this.board, x, y, { ...card });
    sprite.interactive = true;
    // Upside down for the player across the table, so a card is the right
    // way up for whoever owns it - including once it is on a foundation.
    sprite.setAngle(seatOf(card) === 1 ? 180 : 0);
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

  private position(seat: Seat, pile: NertzPile, index: number, count: number, card?: Card): { x: number; y: number; angle?: number } {
    const at = this.layout.cardSpot(seat, pile, index, count, this.workPiles);
    if (pile.kind === 'foundation' && card) {
      const m = mess(card);
      return { x: at.x + m.dx, y: at.y + m.dy, angle: (seatOf(card) === 1 ? 180 : 0) + m.turn };
    }
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
        const to = this.position(seatOf(card), pile, index, cards.length, card);
        // A foundation finished with its king is closed: the king goes on
        // face down, so nobody keeps looking at it for a place to play.
        const closed = pile.kind === 'foundation' && card.rank === 'K' && index === cards.length - 1;
        const faceUp = card.faceUp && !closed;
        if ((this.facing.get(sprite) ?? sprite.card.faceUp) !== faceUp) this.flipSprite(sprite, faceUp);
        const angle = to.angle ?? sprite.angle;
        const turns = Math.abs(sprite.angle - angle) > 0.1;
        if (animate && (Math.abs(sprite.x - to.x) > 0.5 || Math.abs(sprite.y - to.y) > 0.5 || turns)) {
          this.board.tweens.add({ targets: sprite, x: to.x, y: to.y, angle, duration, ease: 'Cubic.easeOut' });
        } else {
          sprite.setPosition(to.x, to.y);
          sprite.setAngle(angle);
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
        if (sprite) this.stacking.bringToTop(sprite);
      }
    }
    for (const drag of this.drags.values()) for (const s of drag.sprites) this.stacking.bringToTop(s);
  }

  // Lifted, rolled half a turn, set down the other side up. Remembered while
  // it turns: flipCard only says so when it lands.
  private flipSprite(sprite: CardSprite, faceUp: boolean): void {
    this.facing.set(sprite, faceUp);
    void flipCard(this.board, sprite, { faceUp, duration: FLIP_MS * 2, lift: 10 }).then(() => {
      if (this.facing.get(sprite) === faceUp) this.facing.delete(sprite);
    });
  }

  // --- what the players do --------------------------------------------------

  private get live(): boolean {
    return this.phase === 'playing' && !this.dealing;
  }

  // felt's pointers arrive in board units already.
  private toBoard(pointer: BoardPointer): { x: number; y: number } {
    return { x: pointer.x, y: pointer.y };
  }

  private onDown(pointer: BoardPointer): void {
    if (!this.live || this.drags.has(pointer.id) || this.chipDrags.has(pointer.id)) return;
    const object = pointer.node;
    const chip = object instanceof Sprite ? this.chipSprites.indexOf(object) : -1;
    if (chip >= 0) {
      // One finger to a chip: a second would only fight the first for it.
      if (!this.chipHeld(chip as Seat)) this.pickUpChip(pointer, chip as Seat);
      return;
    }
    const sprite = object;
    if (!(sprite instanceof CardSprite)) {
      // An empty stock: a slot rather than a card.
      for (const seat of SEATS) {
        const at = this.layout.handSpot(seat, 'stock');
        if (Math.abs(pointer.x - at.x) <= CARD_WIDTH / 2 && Math.abs(pointer.y - at.y) <= CARD_HEIGHT / 2) {
          this.draw(seat);
          return;
        }
      }
      return;
    }
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
      samples: [{ x: board.x, y: board.y, t: pointer.event.timeStamp }],
    });
    // Cancel any tween still carrying these, or it fights the thumb.
    for (const s of sprites) this.board.tweens.killTweensOf(s);
    for (const s of sprites) this.stacking.bringToTop(s);
    // Up off the felt, and the rest of the run with it as one piece.
    this.board.pickUp?.lift(sprites[0]);
    this.board.pickUp?.carry(sprites[0], sprites.slice(1));
  }

  private onMove(pointer: BoardPointer): void {
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
    drag.samples.push({ x: board.x, y: board.y, t: pointer.event.timeStamp });
    if (drag.samples.length > SAMPLE_LIMIT) drag.samples.shift();
    const head = { x: board.x + drag.offsetX, y: board.y + drag.offsetY };
    drag.sprites.forEach((sprite, i) => {
      sprite.setPosition(head.x, head.y + (drag.origins[i].y - drag.origins[0].y));
    });
  }

  private onUp(pointer: BoardPointer): void {
    if (this.chipDrags.has(pointer.id)) {
      this.dropChip(pointer);
      return;
    }
    const drag = this.drags.get(pointer.id);
    if (!drag) return;
    this.drags.delete(pointer.id);
    this.board.pickUp?.drop(drag.sprites[0]);

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
        this.board.tweens.add({
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
  private flickTarget(drag: Drag, pointer: BoardPointer): NertzPile | undefined {
    if (drag.count !== 1 || !drag.moved || !this.live) return undefined;
    const board = this.toBoard(pointer);
    const velocity = pointerVelocity(drag.samples, { x: board.x, y: board.y, t: pointer.event.timeStamp });
    if (!isMiddleFlick(velocity, drag.seat)) return undefined;
    const home = autoTarget(this.state, drag.seat, drag.from, 1);
    return home?.kind === 'foundation' ? home : undefined;
  }

  private landHard(sprite: CardSprite): void {
    this.board.tweens.add({
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
      this.board.pickUp?.drop(drag.sprites[0]);
      drag.sprites.forEach((s, i) => s.setPosition(drag.origins[i].x, drag.origins[i].y));
    }
    this.drags.clear();
    this.restack();
    if (this.chipDrags.size) {
      for (const drag of this.chipDrags.values()) this.board.pickUp?.drop(this.chipSprites[drag.seat]);
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
    for (const index of FOUNDATION_INDICES) consider({ kind: 'foundation', index }, this.layout.foundationZone(index));
    for (const index of workIndices(this.workPiles)) {
      consider({ kind: 'work', index }, this.layout.workZone(drag.seat, index, this.state.hands[drag.seat].work[index].length, this.workPiles));
    }
    return (best as { pile: NertzPile } | undefined)?.pile;
  }

  private play(move: NertzMove): boolean {
    const result = apply(this.state, move);
    if (!result) return false;
    this.state = result.state;
    this.touched = true;
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
    const reach = CHIP_RADIUS + 4;
    for (const seat of SEATS) {
      // Drawn round its middle, in a box a little bigger than the chip so a
      // press just off its rim still takes it - Phaser's circle had the same
      // four units of slack.
      const chip = this.board.graphic(reach * 2, reach * 2, (g, w, h) => {
        const cx = w / 2;
        const cy = h / 2;
        const disc = (x: number, y: number, r: number) => {
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        };
        g.fillStyle = 'rgba(0, 0, 0, 0.28)';
        disc(cx + 1.5, cy + 2.5, CHIP_RADIUS);
        g.fillStyle = css(CHIP_FACE);
        disc(cx, cy, CHIP_RADIUS);
        g.strokeStyle = css(CHIP_EDGE);
        g.lineWidth = 4;
        g.beginPath();
        g.arc(cx, cy, CHIP_RADIUS - 2, 0, Math.PI * 2);
        g.stroke();
        // The notches round a poker chip's rim, so it reads as a chip at a glance.
        g.fillStyle = css(CHIP_FACE);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          disc(cx + Math.cos(a) * (CHIP_RADIUS - 2), cy + Math.sin(a) * (CHIP_RADIUS - 2), 2.2);
        }
        g.fillStyle = CHIP_INK;
        g.font = `${DISPLAY_WEIGHT} 9px ${DISPLAY_FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('STUCK', cx, cy);
      }, { key: 'nertz-stuck-chip' });
      chip.interactive = true;
      chip.setAngle(seat === 1 ? 180 : 0);
      this.chipStacking.bringToTop(chip);
      chip.depth += CHIP_DEPTH;
      this.chipSprites.push(chip);
    }
    this.placeChips(false);
  }

  private chipSpot(seat: Seat): { x: number; y: number } {
    return this.chips[seat] ? this.layout.chipMiddle(seat) : this.layout.chipHome(seat);
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
    this.board.tweens.killTweensOf(chip);
    chip.setScale(1);
    if (animate) {
      this.board.tweens.add({ targets: chip, x: to.x, y: to.y, duration: MOVE_MS * 1.4, delay, ease: 'Cubic.easeOut' });
    } else {
      chip.setPosition(to.x, to.y);
    }
  }

  private placeChips(animate: boolean, delay = 0): void {
    for (const seat of SEATS) this.placeChip(seat, animate, delay);
  }

  private pickUpChip(pointer: BoardPointer, seat: Seat): void {
    const chip = this.chipSprites[seat];
    const board = this.toBoard(pointer);
    this.board.tweens.killTweensOf(chip);
    this.chipDrags.set(pointer.id, {
      seat,
      startX: board.x,
      startY: board.y,
      offsetX: chip.x - board.x,
      offsetY: chip.y - board.y,
      moved: false,
      samples: [{ x: board.x, y: board.y, t: pointer.event.timeStamp }],
    });
    this.chipStacking.bringToTop(chip);
    chip.depth += CHIP_DEPTH;
    this.board.pickUp?.lift(chip);
  }

  private moveChip(pointer: BoardPointer): void {
    const drag = this.chipDrags.get(pointer.id)!;
    const board = this.toBoard(pointer);
    if (Math.abs(board.x - drag.startX) > TAP_SLOP || Math.abs(board.y - drag.startY) > TAP_SLOP) {
      drag.moved = true;
    }
    drag.samples.push({ x: board.x, y: board.y, t: pointer.event.timeStamp });
    if (drag.samples.length > SAMPLE_LIMIT) drag.samples.shift();
    this.chipSprites[drag.seat].setPosition(board.x + drag.offsetX, board.y + drag.offsetY);
  }

  /**
   * A chip let go. Into the middle if it was dropped over the foundations or
   * thrown toward them; a tap on a chip already in takes it back; anything
   * else and it goes back to where it was.
   */
  private dropChip(pointer: BoardPointer): void {
    const drag = this.chipDrags.get(pointer.id)!;
    this.chipDrags.delete(pointer.id);
    const { seat } = drag;
    this.board.pickUp?.drop(this.chipSprites[seat]);
    if (!this.live) {
      this.placeChip(seat, true);
      return;
    }
    const chip = this.chipSprites[seat];
    const board = this.toBoard(pointer);
    const rect: Rect = { x: chip.x - CHIP_RADIUS, y: chip.y - CHIP_RADIUS, width: CHIP_RADIUS * 2, height: CHIP_RADIUS * 2 };
    const over = overlap(rect, this.layout.middleZone()) > 0;
    const thrown = drag.moved &&
      isMiddleFlick(pointerVelocity(drag.samples, { x: board.x, y: board.y, t: pointer.event.timeStamp }), seat);

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
    // Every card on the waste is about to go back onto the stock, so a thumb
    // holding one lets go of it. Anything else being carried is unaffected.
    for (const [id, drag] of this.drags) {
      if (drag.from.kind !== 'waste') continue;
      this.board.pickUp?.drop(drag.sprites[0]);
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
    after(this.board, MOVE_MS * 1.4 + CHIP_SETTLE_MS, () => this.placeChips(true));
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
    this.touched = false;
    this.startRound();
  }

  setPaused(paused: boolean): void {
    if (paused) this.releaseAll();
    this.setBoardPaused(paused);
  }

  gameSize(): { width: number; height: number } {
    return { width: this.layout.width, height: this.layout.height };
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
