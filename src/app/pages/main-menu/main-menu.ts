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

const CANVAS_PADDING = 4;
// Drawn at this multiple of display size before the dots are found, then
// divided back down. A font rasteriser's antialiasing blur is close to a
// fixed number of *pixels* wide regardless of how large the glyph is drawn
// - which is exactly the problem the first version of this had shipped
// against nothing but this developer's one browser: a low-resolution
// canvas puts that fixed-width blur right in the gap between two
// neighbouring dots, where it can bridge them into one blob, and how much
// of the gap it eats depends on the rasteriser - different on a phone than
// on the desktop Chrome this was tuned against. Oversampling shrinks the
// blur's share of the gap without touching anything about how the dots
// actually look on screen, which a threshold tweak alone can't do because
// it can only ever be correct for the one rendering engine it was tuned on.
const CANVAS_OVERSAMPLE = 3;
const FONT_WEIGHT = 400;
const MARQUEE_TEXT = 'SOLITAIRE';

// Third font tried here, and the first one that isn't a guess. Cinzel and
// then Jost were both asked to be something they aren't: letterforms meant
// to be filled as one continuous shape, sampled on a grid and hoped into
// looking like individual bulbs. Cinzel's serifs and thick-thin stroke
// contrast didn't survive that at all; Jost's even geometric strokes did
// better, but "better" was still a grid laid over a shape, guessing at
// where the dots should fall.
//
// Matrix Sans Print isn't a shape to sample - its letterforms are already
// discrete filled circles, drawn that way on purpose to resemble dot-matrix
// printer output and the signs at motorways and train stations (the
// family's own description, and exactly the brief here). Filled rather than
// sampled onto anything, then read back with findBulbCenters, which finds
// each isolated blob of ink and takes its centre - one bulb per dot the
// font already decided on, not a grid hoping to rediscover them. See
// public/fonts/ATTRIBUTION.md for where it's from.
const MARQUEE_FONT = "'Matrix Sans Print'";

// One bulb's whole visual identity - colour, and glow proportional to
// size - in one formula (bulbShadow, below `appendBulb`), so the frame and
// the letters can't drift into two different-looking kinds of light even
// though they're two different sizes of the same one. The frame's bulbs
// stay small: close together and meant to read as individual points
// tracing a loop. The letters' are bigger - Matrix Sans Print draws every
// stroke exactly one dot thick, which is correct for the font and thin for
// a sign, so the bulb standing in for each dot is doing the thickening a
// bolder weight would otherwise have done, and 5px is a size that still
// reads as a row of distinct bulbs rather than a solid tube at the spacing
// this font uses.
const BULB_SIZE = 3.5;
const LETTER_BULB_SIZE = 5;

// The frame: a rounded rectangle walked once, rather than the four straight
// strips this used to be. FRAME_SPACING is looser than the letters' own dot
// spacing - a border doesn't need to hold a glyph's shape, only read as a
// loop of individual lights - and FRAME_INSET keeps it off the plaque's own
// bronze edge.
const FRAME_INSET = 9;
const FRAME_RADIUS = 16;
const FRAME_SPACING = 13;
// How long one bulb's own dim-then-relight cycle takes, and roughly how far
// apart (in that same cycle) each bulb along the loop should start its own.
// "Roughly" because the frame's actual stagger is solved for below, not
// read straight off this constant - see renderFrame.
// ~15% slower than the original 440ms - one bulb's full dim-then-relight
// cycle.
const FRAME_PERIOD = 506;
// How many complete times the bright/dark pattern repeats around the ring
// at once - four separate gaps chasing together rather than one bright arc
// and one dark arc. Chosen directly as a count instead of approximated from
// a target stagger in milliseconds, because what actually reads as "the
// effect" is how many gaps are visible at once, not the delay between
// adjacent bulbs.
const FRAME_LAPS = 4;
const FRAME_FLOOR = 0.08;

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
    // Cancels the letters' loop and puts every bulb's opacity back where it
    // started, rather than leaving it wherever the animation happened to be
    // paused - not that anything reuses this element, but a leaked infinite
    // loop is a leaked infinite loop either way. The frame has nothing to
    // revert: its bulbs are plain CSS animations (see renderFrame), and
    // those stop on their own the moment the elements are removed.
    this.letterAnimation?.revert();
  }

  // Fonts load once, up front, then the letters and the frame are drawn -
  // the frame second because it needs the plaque's own settled height,
  // which depends on how tall the letters turned out to be.
  private async renderMarquee(): Promise<void> {
    const lettersHost = this.letters().nativeElement;
    const marquee = lettersHost.parentElement;
    if (!marquee) return;

    // font-display: block (see styles.scss) only promises the *page* won't
    // flash unstyled text while Matrix Sans Print arrives - a canvas asked
    // to draw before the font has actually loaded falls back to a default
    // sans silently, and bakes the wrong glyph shapes into every bulb
    // position rather than failing loudly.
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
    // Drawn well past display size, then divided back down after the dots
    // are found - see CANVAS_OVERSAMPLE's own note on why this is what
    // makes the threshold in findBulbCenters trustworthy on a device this
    // wasn't tuned against.
    const drawSize = fontSize * CANVAS_OVERSAMPLE;
    ctx.font = `${FONT_WEIGHT} ${drawSize}px ${MARQUEE_FONT}`;
    const padding = CANVAS_PADDING * CANVAS_OVERSAMPLE;
    canvas.width = Math.ceil(ctx.measureText(MARQUEE_TEXT).width) + padding * 2;
    canvas.height = Math.ceil(drawSize * 1.3);
    // Sizing the canvas clears the context back to its defaults, so the font
    // (and everything below) has to be set again after, not just before.
    ctx.font = `${FONT_WEIGHT} ${drawSize}px ${MARQUEE_FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.fillText(MARQUEE_TEXT, padding, canvas.height * 0.72);

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bulbs = findBulbCenters(data, canvas.width, canvas.height).map((bulb) => ({
      x: bulb.x / CANVAS_OVERSAMPLE,
      y: bulb.y / CANVAS_OVERSAMPLE,
    }));
    // Left to right, so the stagger below plays as a ripple running through
    // the word in reading order rather than as a scatter with no direction.
    bulbs.sort((a, b) => a.x - b.x || a.y - b.y);

    host.style.width = `${canvas.width / CANVAS_OVERSAMPLE}px`;
    host.style.height = `${canvas.height / CANVAS_OVERSAMPLE}px`;

    const fragment = document.createDocumentFragment();
    for (const bulb of bulbs) appendBulb(fragment, bulb.x, bulb.y, LETTER_BULB_SIZE);
    host.appendChild(fragment);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Floor at 0.55, not near-zero: a bulb sign's letters stay readable the
    // whole time, with individual bulbs sparkling rather than the word
    // itself going dark. A near-zero floor was tried first and made the
    // stagger read as a single spotlight sweeping over an otherwise
    // invisible word rather than a lit word with life in it.
    //
    // Two explicit legs (dim, then relight) rather than `alternate: true` -
    // the same fix the frame needed for the same reason. Alternate reverses
    // the whole tween every other loop, and reversing the tween reverses
    // the stagger with it: the ripple ran left-to-right while dimming and
    // right-to-left while relighting, so it read as marching back and forth
    // through the word rather than running one direction continually.
    // Spelling both legs out forward means every loop replays the
    // identical sequence, so the sweep direction never flips.
    this.letterAnimation = animate(host.querySelectorAll<HTMLElement>('.bulb'), {
      opacity: [{ to: 0.55, duration: 260 }, { to: 1, duration: 260 }],
      loop: true,
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

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // anime.js's `loop` treats a whole staggered call as one block and
    // repeats the block - fine for the letters, which are a line with no
    // wraparound, but wrong for a closed loop: it meant bulb 0 didn't
    // restart on its own fixed rhythm, it sat lit and idle until the *last*
    // bulb finished (which could be a couple of seconds later), then the
    // entire ring snapped back to its start together. That snap was the
    // jitter - and it only ever showed up here, not in the letters, because
    // only here are the first and last bulb physically next to each other,
    // so a restart that isn't perfectly continuous is visible as one.
    //
    // Plain CSS animations don't have that problem: each bulb gets its own
    // independent, perpetually looping animation with no shared timeline to
    // resync. What still has to be solved is the seam itself - bulb
    // `count - 1` and bulb `0` are adjacent on the ring, so the delay
    // between them has to be the same as any other adjacent pair. Since
    // each bulb's own cycle repeats every FRAME_PERIOD, that's only true if
    // `count * stagger` lands on an exact multiple of FRAME_PERIOD - which
    // is guaranteed here rather than hoped for, because the stagger is
    // solved backwards from FRAME_LAPS (an integer by definition) instead
    // of the other way round.
    const staggerMs = (FRAME_PERIOD * FRAME_LAPS) / count;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const { x, y } = pointAt((perimeter * i) / count);
      const bulb = appendBulb(fragment, x, y);
      if (reducedMotion) continue;
      bulb.style.setProperty('--bulb-floor', String(FRAME_FLOOR));
      bulb.style.animation = `marquee-blink ${FRAME_PERIOD}ms linear infinite`;
      bulb.style.animationDelay = `${i * staggerMs}ms`;
    }
    host.appendChild(fragment);
  }
}

// One bulb per dot already drawn in the glyphs, not a grid laid over them
// afterwards and hoping the spacing lines up: Matrix Sans Print's
// letterforms are isolated filled circles by design (see MARQUEE_FONT's own
// note), so finding each one is a flood fill - walk every filled pixel that
// hasn't been visited yet, follow it into everything touching it, and take
// the blob's centre. The font already decided where the dots go; this only
// finds them. 4-connected rather than 8: a diagonal step looks close enough
// to the gap between two dots that it isn't worth risking a merge across it.
//
// The alpha threshold has to be well above "any ink at all" - checked at
// 128 first, which found 24 blobs for a word that should have roughly five
// times that many. Adjacent dots' antialiasing was faint but not zero in
// the gap between them, which a low threshold reads as one continuous blob
// rather than two dots that happen to be close.
//
// Fixed at a number tuned on one browser the first time this shipped, and
// that was the actual mistake, not the number itself - a phone's rendering
// pipeline is not this developer's Linux Chrome, and a threshold picked
// against one rasteriser's antialiasing has no reason to be right about
// another's. Solved as a fraction of whatever the *brightest* pixel this
// canvas actually produced turns out to be, rather than an absolute number
// assumed to mean "fully opaque" - self-calibrating to whatever ceiling
// this particular rendering pipeline happens to have, on this particular
// device, rather than the one this was tested on.
function findBulbCenters(data: Uint8ClampedArray, width: number, height: number): Bulb[] {
  let maxAlpha = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > maxAlpha) maxAlpha = data[i];
  const threshold = maxAlpha * 0.8;

  const visited = new Uint8Array(width * height);
  const filled = (x: number, y: number) => data[(y * width + x) * 4 + 3] > threshold;
  const bulbs: Bulb[] = [];
  const stack: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (visited[start] || !filled(x, y)) continue;
      visited[start] = 1;
      stack.push(start);
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      while (stack.length) {
        const idx = stack.pop()!;
        const cx = idx % width;
        const cy = (idx / width) | 0;
        sumX += cx;
        sumY += cy;
        count++;
        const neighbors: [number, number][] = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx] || !filled(nx, ny)) continue;
          visited[nIdx] = 1;
          stack.push(nIdx);
        }
      }
      bulbs.push({ x: sumX / count, y: sumY / count });
    }
  }
  return bulbs;
}

// Styled inline rather than through main-menu.scss: Angular's emulated
// encapsulation scopes component styles by stamping an attribute onto
// elements the template compiler creates, and a span built by
// `document.createElement` here never gets one - a `.bulb { ... }` rule in
// the stylesheet would silently match nothing. Found by checking a live
// bulb's computed style and seeing browser defaults looking back. The one
// place both the letters and the frame get their bulbs from, so the two
// can't end up looking like different things.
// The glow scales with the bulb rather than being a fixed shadow string, so
// LETTER_BULB_SIZE's bigger bulbs get a proportionally bigger halo instead
// of the frame's tight one stretched onto something 40% larger than it was
// measured for.
function bulbShadow(size: number): string {
  const innerBlur = size * 0.86;
  const innerSpread = size * 0.29;
  const outerBlur = size * 2;
  const outerSpread = size * 0.43;
  return (
    `0 0 ${innerBlur}px ${innerSpread}px rgba(255, 209, 102, 0.9), ` +
    `0 0 ${outerBlur}px ${outerSpread}px rgba(255, 209, 102, 0.45)`
  );
}

function appendBulb(parent: Node, x: number, y: number, size = BULB_SIZE): HTMLSpanElement {
  const span = document.createElement('span');
  // Kept for the querySelectorAll calls above, not for any CSS rule.
  span.className = 'bulb';
  span.style.position = 'absolute';
  span.style.left = `${x}px`;
  span.style.top = `${y}px`;
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
  span.style.borderRadius = '50%';
  span.style.background = '#ffd166';
  span.style.boxShadow = bulbShadow(size);
  parent.appendChild(span);
  return span;
}
