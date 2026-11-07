import {
  AfterViewInit, Component, ElementRef, OnDestroy, effect, inject, viewChild,
} from '@angular/core';
import { Board, createBoard } from '@exterkamp/felt';
import { Card } from '../../game/deck';
import { CardSprite, currentCardStyle, renderCourtArt, setDeck } from '../../game/card-sprite';
import { DeckTheme } from '../../game/deck-theme';
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

class DeckPreviewBoard {
  private readonly cards: CardSprite[];
  private settle = 0;

  constructor(readonly board: Board) {
    void renderCourtArt(board);
    this.cards = FACES.map((card, i) => new CardSprite(board, WIDTH / 2 + PLACES[i], HEIGHT / 2, { ...card }));
  }

  /**
   * Draw the deck again, once the hand has come off the colour wheel. felt
   * keeps showing the old deck until the new one is painted, so the preview
   * never blinks out between the two.
   */
  restyle(theme: DeckTheme, backColor: number, style: DeckStyle): void {
    if (this.board.isDestroyed) return;
    window.clearTimeout(this.settle);
    this.settle = window.setTimeout(() => {
      if (this.board.isDestroyed) return;
      setDeck(theme, backColor, style);
      void renderCourtArt(this.board);
      for (const card of this.cards) card.restyle(currentCardStyle());
    }, SETTLE_MS);
  }

  destroy(): void {
    window.clearTimeout(this.settle);
    this.board.destroy();
  }
}

@Component({
  selector: 'app-deck-preview',
  template: '<div class="deck-preview" #host aria-hidden="true"></div>',
  styles: `
    /* As wide as the column it is in. A custom element is inline, and in a
       centred column it shrinks to its content - the canvas - which felt
       then fits to the box it is in: a loop the browser has to break. */
    :host {
      display: block;
      width: 100%;
    }
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
  private game?: DeckPreviewBoard;

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
    setDeck(this.settings.deckTheme(), this.settings.backColor(), this.settings.deckStyle());
    this.game = new DeckPreviewBoard(createBoard({
      parent: this.host().nativeElement,
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: FELT_CLEAR_COLOR,
      pickUp: false,
    }));
  }

  ngOnDestroy(): void {
    // A second board, on a page that is not the board. It has to go when
    // the page does, or leaving settings leaves a canvas running.
    this.game?.destroy();
  }

  private scene(): DeckPreviewBoard | undefined {
    return this.game;
  }
}
