import { AfterViewInit, Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { animate, stagger, steps, type JSAnimation } from 'animejs';
import { GameId } from '../../game/table-game';
import { formatPercent } from '../../format';
import { Stats } from '../../stats';

// One bulb, sampled from the outline of a letter drawn on a canvas nobody
// sees. `strokeText` traces a glyph the same way a pen would - both the
// outer edge of an S and the inner ring of an O - so walking a grid over the
// stroke and keeping the lit pixels is what turns a font into a set of bulb
// positions rather than a filled block of them.
interface Bulb {
  readonly x: number;
  readonly y: number;
}

// Real marquee letters have visible gaps between bulbs - that's what reads
// as individual bulbs rather than a lit tube. GRID_STEP has to be bigger
// than a single dot's glow or neighbours merge into a blob (an earlier
// version of this got exactly that wrong: too fine a grid at too large a
// glow drew a smear roughly shaped like the word). But too coarse a grid
// loses the letters themselves - nine characters in ~380px of plaque left
// only four or five sample columns across a stroke, which isn't enough to
// tell an R from an A. GRID_STEP came down and the bulbs shrank to match,
// rather than just adding more of the original size - more, smaller lights
// is what makes a real marquee font legible at all, not just more lights.
// STROKE_WIDTH still has to be at least GRID_STEP, or the sampling grid
// steps clean over a stroke this thin without ever landing on it.
const GRID_STEP = 6;
const STROKE_WIDTH = 7;
const FONT_WEIGHT = 700;
const MARQUEE_TEXT = 'SOLITAIRE';

// One button per game, and nothing else to decide here.
//
// This was a chip row and a single Deal button, which asked the question in
// the wrong order: you had to notice the chips, understand that they changed
// what Deal would do, and only then press it. A game is not a setting. Now
// each game is its own way in - and the one with something to choose opens a
// page to choose it on, rather than crowding the front door with a decision
// that only applies to half of it.
@Component({
  imports: [RouterLink],
  selector: 'app-main-menu',
  styleUrl: './main-menu.scss',
  templateUrl: './main-menu.html',
})
export class MainMenu implements AfterViewInit, OnDestroy {
  private readonly stats = inject(Stats);
  private readonly letters = viewChild.required<ElementRef<HTMLDivElement>>('letters');
  private bulbAnimation?: JSAnimation;

  // What a game is, for somebody who has not played it here before. Replaced
  // by their own record the moment they have one, because by then this is
  // less interesting than how they are doing.
  private readonly blurbs: Record<GameId, string> = {
    klondike: 'Draw one or three · the classic',
    freecell: 'Nothing hidden · almost always winnable',
    yukon: 'No deck to turn · dig for what is buried',
    canfield: 'Thirteen in reserve · the gambling one',
    spiderette: 'Build down by rank · carry a suit at a time',
    scorpion: 'One suit only · the hardest here',
    seahaven: 'Ten columns, four cells · kings only in a gap',
    tripeaks: 'Quick · clear the peaks a card at a time',
    pyramid: 'Pairs that add to thirteen',
    golf: 'One rank up or down · ninety seconds',
    blackhole: 'Nothing hidden, no deck · every move a choice',
    acesup: 'Four piles · the aces cannot be beaten',
  };

  protected line(game: GameId): string {
    const record = this.stats.game(game);
    if (!record.played) return this.blurbs[game];
    return `${record.won} of ${record.played} won · ${formatPercent(record.won / record.played)}`;
  }

  ngAfterViewInit(): void {
    void this.renderBulbLetters();
  }

  ngOnDestroy(): void {
    // Cancels the loop and puts every bulb's opacity back where it started,
    // rather than leaving it wherever the animation happened to be paused -
    // not that anything reuses this element, but a leaked infinite loop is a
    // leaked infinite loop either way.
    this.bulbAnimation?.revert();
  }

  // Traces MARQUEE_TEXT in the app's own display face and turns the result
  // into a field of little glowing spans, then sets them blinking. Done in
  // TypeScript because there is no CSS way to ask "where does this glyph's
  // outline actually fall" - a box-shadow of dots can approximate a frame's
  // straight edges but not an S.
  private async renderBulbLetters(): Promise<void> {
    const host = this.letters().nativeElement;
    const family = "'Cinzel'";

    // font-display: block (see styles.scss) only promises the *page* won't
    // flash unstyled text while Cinzel arrives - a canvas asked to draw
    // before the font has actually loaded falls back to a default serif
    // silently, and bakes the wrong glyph shapes into every bulb position
    // rather than failing loudly.
    await document.fonts.load(`${FONT_WEIGHT} 100px ${family}`);
    await document.fonts.ready;

    const parent = host.parentElement;
    if (!parent) return;

    // Sized to whatever room the plaque actually has rather than a fixed
    // pixel value, so the word fits the same way on a narrow phone and a
    // wide one. measureText scales linearly with font size for a fixed
    // string, so one measurement at a reference size is enough to solve for
    // the size that hits the target width, without an iterative search.
    const reference = document.createElement('canvas').getContext('2d');
    if (!reference) return;
    reference.font = `${FONT_WEIGHT} 100px ${family}`;
    const referenceWidth = reference.measureText(MARQUEE_TEXT).width;
    const available = parent.clientWidth - 24;
    const displayWidth = Math.min(available, 440);
    const fontSize = (100 * displayWidth) / referenceWidth;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = `${FONT_WEIGHT} ${fontSize}px ${family}`;
    canvas.width = Math.ceil(ctx.measureText(MARQUEE_TEXT).width) + STROKE_WIDTH * 2;
    canvas.height = Math.ceil(fontSize * 1.3);
    // Sizing the canvas clears the context back to its defaults, so the font
    // (and everything below) has to be set again after, not just before.
    ctx.font = `${FONT_WEIGHT} ${fontSize}px ${family}`;
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = STROKE_WIDTH;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(MARQUEE_TEXT, STROKE_WIDTH, canvas.height * 0.72);

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bulbs: Bulb[] = [];
    for (let y = 0; y < canvas.height; y += GRID_STEP) {
      for (let x = 0; x < canvas.width; x += GRID_STEP) {
        if (data[(y * canvas.width + x) * 4 + 3] > 128) {
          bulbs.push({ x, y });
        }
      }
    }
    // Left to right, so the stagger below plays as a ripple running through
    // the word in reading order rather than as a scatter with no direction.
    bulbs.sort((a, b) => a.x - b.x || a.y - b.y);

    host.style.width = `${canvas.width}px`;
    host.style.height = `${canvas.height}px`;

    // Styled inline rather than through main-menu.scss: Angular's emulated
    // encapsulation scopes component styles by stamping an attribute onto
    // elements the template compiler creates, and a span built by
    // `document.createElement` here never gets one - `.bulb { ... }` in the
    // stylesheet would silently match nothing. Found by checking a live
    // bulb's computed style and seeing browser defaults looking back.
    const fragment = document.createDocumentFragment();
    for (const bulb of bulbs) {
      const span = document.createElement('span');
      // Kept for the querySelectorAll below, not for any CSS rule - see the
      // encapsulation note above.
      span.className = 'bulb';
      span.style.position = 'absolute';
      span.style.left = `${bulb.x}px`;
      span.style.top = `${bulb.y}px`;
      span.style.width = '3.5px';
      span.style.height = '3.5px';
      span.style.margin = '-1.75px 0 0 -1.75px';
      span.style.borderRadius = '50%';
      span.style.background = '#ffd166';
      span.style.boxShadow = '0 0 3px 1px rgba(255, 209, 102, 0.9), 0 0 7px 1.5px rgba(255, 209, 102, 0.45)';
      fragment.appendChild(span);
    }
    host.appendChild(fragment);

    // Reduced motion means reduced motion, not "the same blink at a duration
    // so short it reads as a strobe" - see the frame bulbs' own note on
    // this. Simplest fallback there is: never start the loop, and every
    // bulb just sits at the opacity it was created with.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Floor at 0.55, not near-zero: a bulb sign's letters stay readable the
    // whole time, with individual bulbs sparkling rather than the word
    // itself going dark. A near-zero floor was tried first and made the
    // stagger read as a single spotlight sweeping over an otherwise
    // invisible word rather than a lit word with life in it.
    this.bulbAnimation = animate(host.querySelectorAll<HTMLElement>('.bulb'), {
      opacity: [1, 0.55],
      duration: 260,
      loop: true,
      alternate: true,
      ease: steps(1),
      delay: stagger(4),
    });
  }
}
