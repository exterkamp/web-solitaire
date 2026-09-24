import {
  AfterViewInit, Component, ElementRef, OnDestroy, effect, inject, viewChild,
} from '@angular/core';
import Phaser from 'phaser';
import { DeckTheme } from 'phaser-card-engine';
import { boardRoot, createBoard } from 'phaser-card-engine/phaser';
import { Card } from '../../game/deck';
import { CardSprite, preloadCardArt, renderCourtArt, setDeck } from '../../game/card-sprite';
import { DeckStyle } from '../../game/deck-style';
import { FELT_CLEAR_COLOR } from '../../game/table';
import { Settings } from '../../settings';

// Three cards, drawn by the board's own renderer.
//
// A settings page that described a deck in CSS would be a second opinion
// about what a card looks like, and second opinions drift. This is the same
// CardSprite the table deals, handed the same palette, so the only way the
// preview can be wrong about the deck is if the board is wrong too.
//
// Three because it takes three to show everything a deck decides: a court for
// the palette, a number card for the suit ink and the stock, and a back for
// the deck and its colour.
const WIDTH = 260;
const HEIGHT = 116;
const PLACES = [-76, 0, 76];

const FACES: Card[] = [
  { id: 'preview-K', rank: 'K', suit: 'hearts', faceUp: true },
  { id: 'preview-7', rank: '7', suit: 'spades', faceUp: true },
  { id: 'preview-B', rank: 'A', suit: 'clubs', faceUp: false },
];

// A colour wheel being dragged emits continuously, and every redraw costs
// twelve court rasterisations. One frame of settling is the difference
// between a preview that follows the thumb and a page that stops answering.
const SETTLE_MS = 110;

class DeckPreviewScene extends Phaser.Scene {
  /** Set by the component before the scene starts. */
  init(data: { theme: DeckTheme }): void {
    this.theme = data.theme;
  }

  private theme!: DeckTheme;
  private root!: Phaser.GameObjects.Container;
  private cards: CardSprite[] = [];
  private settle = 0;
  private live = false;

  preload(): void {
    preloadCardArt(this, this.theme);
  }

  create(): void {
    this.root = boardRoot(this);
    this.live = true;
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      window.clearTimeout(this.settle);
      this.live = false;
    });
    void renderCourtArt(this);
    this.lay();
  }

  /** Draw the deck again, once the hand has come off the colour wheel. */
  restyle(theme: DeckTheme, backColor: number, style: DeckStyle): void {
    if (!this.live) return;
    window.clearTimeout(this.settle);
    this.settle = window.setTimeout(() => {
      setDeck(theme, backColor, style);
      void renderCourtArt(this);
      // Only one theme's back is loaded at a time - the whole point of not
      // preloading all seven - so switching deck means fetching one image
      // before there is anything to draw.
      this.withArt(theme, () => this.lay());
    }, SETTLE_MS);
  }

  private withArt(theme: DeckTheme, then: () => void): void {
    preloadCardArt(this, theme);
    if (this.load.list.size === 0) {
      then();
      return;
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, then);
    this.load.start();
  }

  private lay(): void {
    for (const card of this.cards) card.destroy();
    this.cards = FACES.map((card, i) => {
      const sprite = new CardSprite(this, WIDTH / 2 + PLACES[i], HEIGHT / 2, card);
      this.root.add(sprite);
      return sprite;
    });
  }

}

@Component({
  selector: 'app-deck-preview',
  template: '<div class="deck-preview" #host aria-hidden="true"></div>',
  styles: `
    .deck-preview {
      width: 100%;
      max-width: 17rem;
      aspect-ratio: 260 / 116;
      margin: 0 auto;
      border-radius: 8px;
      overflow: hidden;
    }
  `,
})
export class DeckPreview implements AfterViewInit, OnDestroy {
  private readonly settings = inject(Settings);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private game?: Phaser.Game;

  constructor() {
    // Every dial a deck has, read in one place: any of them moving redraws
    // the three cards.
    effect(() => {
      const theme = this.settings.deckTheme();
      const backColor = this.settings.backColor();
      const style = this.settings.deckStyle();
      this.scene()?.restyle(theme, backColor, style);
    });
  }

  ngAfterViewInit(): void {
    const theme = this.settings.deckTheme();
    setDeck(theme, this.settings.backColor(), this.settings.deckStyle());
    this.game = createBoard({
      parent: this.host().nativeElement,
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: FELT_CLEAR_COLOR,
    });
    this.game.scene.add('deck-preview', DeckPreviewScene, true, { theme });
  }

  ngOnDestroy(): void {
    // A second Phaser game, on a page that is not the board. It has to go
    // when the page does, or leaving settings leaves a canvas running.
    this.game?.destroy(true);
  }

  private scene(): DeckPreviewScene | undefined {
    return this.game?.scene.getScene('deck-preview') as DeckPreviewScene | undefined;
  }
}
