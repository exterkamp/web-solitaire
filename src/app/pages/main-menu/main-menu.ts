import { AfterViewInit, Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { animate, stagger, steps, type JSAnimation } from 'animejs';
import { GameId } from '../../game/table-game';
import { formatPercent } from '../../format';
import { Stats } from '../../stats';

// One bulb, sampled from a letter's outline or walked round the plaque's
// frame. Both end up rendered by the same helper (appendBulb) so a frame
// bulb and a letter bulb are the same visual object, not two approximations
// of one that happen to be a similar colour.
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

// Jost, not Cinzel. Cinzel is cut from Roman inscriptional capitals - thin
// serifs and a thick-thin stroke contrast that a grid of evenly spaced
// bulbs cannot hold onto, so the word traced but only barely, and read as
// noise before it read as SOLITAIRE. Jost is geometric - Futura's shapes,
// the same reasoning styles.scss gives for using it as the body face - and
// a geometric sans with even strokes and no serifs to lose is closer to
// what a real bulb sign's lettering actually looks like.
const MARQUEE_FONT = "'Jost'";

// One bulb's whole visual identity, in one place, so the frame and the
// letters can't drift into two different-looking kinds of light. Small
// enough that GRID_STEP's spacing reads as gaps between bulbs rather than
// one continuous glow.
const BULB_SIZE = 3.5;
const BULB_SHADOW = '0 0 3px 1px rgba(255, 209, 102, 0.9), 0 0 7px 1.5px rgba(255, 209, 102, 0.45)';

// The frame: a rounded rectangle walked once, rather than the four straight
// strips this used to be. FRAME_SPACING is looser than GRID_STEP - a border
// doesn't need to hold a glyph's shape, only read as a loop of individual
// lights - and FRAME_INSET keeps it off the plaque's own bronze edge.
const FRAME_INSET = 9;
const FRAME_RADIUS = 16;
const FRAME_SPACING = 13;

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
  private readonly frame = viewChild.required<ElementRef<HTMLDivElement>>('frame');
  private letterAnimation?: JSAnimation;
  private frameAnimation?: JSAnimation;

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
    void this.renderMarquee();
  }

  ngOnDestroy(): void {
    // Cancels both loops and puts every bulb's opacity back where it
    // started, rather than leaving it wherever the animation happened to be
    // paused - not that anything reuses this element, but a leaked infinite
    // loop is a leaked infinite loop either way.
    this.letterAnimation?.revert();
    this.frameAnimation?.revert();
  }

  // Fonts load once, up front, then the letters and the frame are drawn -
  // the frame second because it needs the plaque's own settled height,
  // which depends on how tall the letters turned out to be.
  private async renderMarquee(): Promise<void> {
    const lettersHost = this.letters().nativeElement;
    const marquee = lettersHost.parentElement;
    if (!marquee) return;

    // font-display: block (see styles.scss) only promises the *page* won't
    // flash unstyled text while Jost arrives - a canvas asked to draw
    // before the font has actually loaded falls back to a default sans
    // silently, and bakes the wrong glyph shapes into every bulb position
    // rather than failing loudly.
    await document.fonts.load(`${FONT_WEIGHT} 100px ${MARQUEE_FONT}`);
    await document.fonts.ready;

    this.renderLetters(lettersHost, marquee);
    this.renderFrame(this.frame().nativeElement, marquee);
  }

  // Traces MARQUEE_TEXT and turns the result into a field of bulbs, then
  // sets them blinking. Done in TypeScript because there is no CSS way to
  // ask "where does this glyph's outline actually fall."
  private renderLetters(host: HTMLDivElement, marquee: HTMLElement): void {
    // Sized to whatever room the plaque actually has rather than a fixed
    // pixel value, so the word fits the same way on a narrow phone and a
    // wide one. measureText scales linearly with font size for a fixed
    // string, so one measurement at a reference size is enough to solve for
    // the size that hits the target width, without an iterative search.
    const reference = document.createElement('canvas').getContext('2d');
    if (!reference) return;
    reference.font = `${FONT_WEIGHT} 100px ${MARQUEE_FONT}`;
    const referenceWidth = reference.measureText(MARQUEE_TEXT).width;
    const available = marquee.clientWidth - 24;
    const displayWidth = Math.min(available, 440);
    const fontSize = (100 * displayWidth) / referenceWidth;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = `${FONT_WEIGHT} ${fontSize}px ${MARQUEE_FONT}`;
    canvas.width = Math.ceil(ctx.measureText(MARQUEE_TEXT).width) + STROKE_WIDTH * 2;
    canvas.height = Math.ceil(fontSize * 1.3);
    // Sizing the canvas clears the context back to its defaults, so the font
    // (and everything below) has to be set again after, not just before.
    ctx.font = `${FONT_WEIGHT} ${fontSize}px ${MARQUEE_FONT}`;
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

    const fragment = document.createDocumentFragment();
    for (const bulb of bulbs) appendBulb(fragment, bulb.x, bulb.y);
    host.appendChild(fragment);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Floor at 0.55, not near-zero: a bulb sign's letters stay readable the
    // whole time, with individual bulbs sparkling rather than the word
    // itself going dark. A near-zero floor was tried first and made the
    // stagger read as a single spotlight sweeping over an otherwise
    // invisible word rather than a lit word with life in it.
    this.letterAnimation = animate(host.querySelectorAll<HTMLElement>('.bulb'), {
      opacity: [1, 0.55],
      duration: 260,
      loop: true,
      alternate: true,
      ease: steps(1),
      delay: stagger(4),
    });
  }

  // Walks a rounded rectangle inset from the plaque's own edge and drops a
  // bulb every FRAME_SPACING along it, then staggers them in that same
  // walked order - which is the whole trick. A chase is one strand of light
  // moving round a loop; staggering bulbs in the order the loop was walked
  // is what makes that true here instead of four rows blinking in place.
  private renderFrame(host: HTMLDivElement, marquee: HTMLElement): void {
    const w = marquee.clientWidth - FRAME_INSET * 2;
    const h = marquee.clientHeight - FRAME_INSET * 2;
    if (w <= 0 || h <= 0) return;
    const radius = Math.min(FRAME_RADIUS, w / 2, h / 2);
    const straightX = w - radius * 2;
    const straightY = h - radius * 2;
    const cornerLength = (Math.PI * radius) / 2;
    const perimeter = straightX * 2 + straightY * 2 + cornerLength * 4;
    const count = Math.max(8, Math.round(perimeter / FRAME_SPACING));

    // A point `t` along a quarter-circle corner, `t` measured in the same
    // arc-length units as everything else here - `t / radius` converts arc
    // length to the radians it sweeps.
    const corner = (cx: number, cy: number, startAngle: number, t: number): Bulb => {
      const angle = startAngle + t / radius;
      return { x: FRAME_INSET + cx + radius * Math.cos(angle), y: FRAME_INSET + cy + radius * Math.sin(angle) };
    };
    // Eight segments walked clockwise from the top edge's left end: a
    // straight side, then the quarter-circle corner into the next one.
    const segments: { length: number; at: (t: number) => Bulb }[] = [
      { length: straightX, at: (t) => ({ x: FRAME_INSET + radius + t, y: FRAME_INSET }) },
      { length: cornerLength, at: (t) => corner(w - radius, radius, -Math.PI / 2, t) },
      { length: straightY, at: (t) => ({ x: FRAME_INSET + w, y: FRAME_INSET + radius + t }) },
      { length: cornerLength, at: (t) => corner(w - radius, h - radius, 0, t) },
      { length: straightX, at: (t) => ({ x: FRAME_INSET + w - radius - t, y: FRAME_INSET + h }) },
      { length: cornerLength, at: (t) => corner(radius, h - radius, Math.PI / 2, t) },
      { length: straightY, at: (t) => ({ x: FRAME_INSET, y: FRAME_INSET + h - radius - t }) },
      { length: cornerLength, at: (t) => corner(radius, radius, Math.PI, t) },
    ];
    const pointAt = (distance: number): Bulb => {
      let remaining = distance;
      for (const segment of segments) {
        if (remaining <= segment.length) return segment.at(remaining);
        remaining -= segment.length;
      }
      return segments[0].at(0);
    };

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const { x, y } = pointAt((perimeter * i) / count);
      appendBulb(fragment, x, y);
    }
    host.appendChild(fragment);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // A much lower floor than the letters get, and on purpose: the frame
    // isn't a word that has to stay legible, it's a chase, and a chase
    // reads as one only if most of the loop is dark at any instant with a
    // travelling band of light passing through - the letters' 0.55 floor
    // would make every bulb look lit all the time, and there was nothing
    // left to walk round the frame.
    this.frameAnimation = animate(host.querySelectorAll<HTMLElement>('.bulb'), {
      opacity: [1, 0.08],
      duration: 220,
      loop: true,
      alternate: true,
      ease: steps(1),
      delay: stagger(14),
    });
  }
}

// Styled inline rather than through main-menu.scss: Angular's emulated
// encapsulation scopes component styles by stamping an attribute onto
// elements the template compiler creates, and a span built by
// `document.createElement` here never gets one - a `.bulb { ... }` rule in
// the stylesheet would silently match nothing. Found by checking a live
// bulb's computed style and seeing browser defaults looking back. The one
// place both the letters and the frame get their bulbs from, so the two
// can't end up looking like different things.
function appendBulb(parent: Node, x: number, y: number): void {
  const span = document.createElement('span');
  // Kept for the querySelectorAll calls above, not for any CSS rule.
  span.className = 'bulb';
  span.style.position = 'absolute';
  span.style.left = `${x}px`;
  span.style.top = `${y}px`;
  span.style.width = `${BULB_SIZE}px`;
  span.style.height = `${BULB_SIZE}px`;
  span.style.margin = `${-BULB_SIZE / 2}px 0 0 ${-BULB_SIZE / 2}px`;
  span.style.borderRadius = '50%';
  span.style.background = '#ffd166';
  span.style.boxShadow = BULB_SHADOW;
  parent.appendChild(span);
}
