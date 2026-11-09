import { Board, BorderPattern, FeltPaint, Sprite, paintFelt as paintOnFelt, paintFeltFrame } from '@exterkamp/felt';
import type { GameId } from './table-game';
import { DISPLAY_FONT, DISPLAY_WEIGHT } from './fonts';

// The table the game is played on: felt, the pool of light falling on it,
// and the rail around the edge. Modelled on a casino craps table, which is
// doing four separate things that a flat fill isn't:
//
//   * The felt is a deep teal-green, not a pure green. Pure green reads as
//     "default canvas colour"; the blue in it is most of why a real table
//     looks like cloth.
//   * It has a visible nap - a fine grain that catches the light.
//   * There's a hard pool of light over the middle falling off to near
//     black at the corners, which is what gives the surface any depth.
//   * A polished wood rail frames it.
//
// All of it is generated rather than shipped as an image: it's a handful of
// gradients and a noise tile, which costs less than the download would and
// scales to whatever resolution the device canvas happens to be.

// Used as the canvas clear colour so the corners match the felt before
// anything is drawn over them.
export const FELT_CLEAR_COLOR = '#07241f';

// Felt, from the middle of the lit area out to the unlit corners.
const FELT_LIT = { r: 32, g: 96, b: 78 };
const FELT_BASE = { r: 15, g: 58, b: 48 };
const FELT_EDGE = { r: 6, g: 32, b: 27 };

// Where the overhead lamp hangs. Slightly above centre, over the
// foundations, because that's where the action is and where the eye should
// be pulled - the same reason the light on a real table isn't centred on
// the felt but on the layout.
const LIGHT_CENTER_Y = 0.42;
const LIGHT_RADIUS = 0.78;

// The nap. One small tile of per-pixel noise, repeated: felt grain has no
// structure at this scale, so there's nothing in a tile for the eye to
// latch onto and the repeat is invisible.
const NOISE_TILE = 128;
const NOISE_ALPHA = 0.11;

// Polished mahogany, in logical units of rail width.
const RAIL_WIDTH = 14;

// The largest picture one atlas page holds, less its gutters. The surface is
// the one picture on the board the size of the board, and on a dense phone
// the board is bigger than a page: it is painted at whatever density fits
// and drawn stretched. Gradients and grain survive that; nothing else on the
// board is painted this way.
const SURFACE_MAX_PX = 2040;

type Pen = CanvasRenderingContext2D;

function rgba(c: { r: number; g: number; b: number }, a: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

function noiseTile(): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = NOISE_TILE;
  tile.height = NOISE_TILE;
  const ctx = tile.getContext('2d')!;
  const image = ctx.createImageData(NOISE_TILE, NOISE_TILE);
  for (let i = 0; i < image.data.length; i += 4) {
    // Monochrome speckle. The alpha of the whole layer does the dimming, so
    // this only has to carry the grain's shape.
    const v = 120 + Math.random() * 135;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return tile;
}

// The felt itself, in board units: base, the pool of light, the vignette.
function paintFelt(ctx: Pen, w: number, h: number): void {
  ctx.fillStyle = rgba(FELT_BASE, 1);
  ctx.fillRect(0, 0, w, h);

  // The pool of light. Drawn as a wide soft gradient rather than a hard
  // spot: a lamp over a table lights most of the cloth and only really
  // falls away at the far corners.
  const cx = w / 2;
  const cy = h * LIGHT_CENTER_Y;
  const radius = Math.hypot(w, h) * LIGHT_RADIUS;
  const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  pool.addColorStop(0, rgba(FELT_LIT, 1));
  pool.addColorStop(0.45, rgba(FELT_BASE, 1));
  pool.addColorStop(1, rgba(FELT_EDGE, 1));
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, w, h);

  // Vignette, squared off into the corners so the darkening follows the
  // rectangle of the screen rather than sitting as an obvious circle.
  const vignette = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.25, cx, cy, radius * 0.95);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(0.7, 'rgba(0, 0, 0, 0.18)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

// A polished rail around the edge: a dark outer lip, the wood itself shaded
// so it reads as rounded, and a specular line along the top where the lamp
// catches it.
function drawRail(ctx: Pen, w: number, h: number, width: number): void {
  // Cross-section of a rounded rail, outer lip inward: shadowed edge, the
  // bulk of the wood, the crown catching the lamp, then falling back into
  // shadow where it meets the felt.
  const bands: [number, number, string][] = [
    [0.00, 0.10, '#1d0b05'],
    [0.10, 0.30, '#4d2213'],
    [0.30, 0.52, '#7e3d21'],
    [0.52, 0.70, '#b0602f'],
    [0.70, 0.84, '#8a4522'],
    [0.84, 1.00, '#341509'],
  ];
  for (const [from, to, color] of bands) {
    const a = width * from;
    const b = width * to;
    ctx.fillStyle = color;
    ctx.fillRect(a, a, w - 2 * a, b - a);                     // top
    ctx.fillRect(a, h - b, w - 2 * a, b - a);                 // bottom
    ctx.fillRect(a, a, b - a, h - 2 * a);                     // left
    ctx.fillRect(w - b, a, b - a, h - 2 * a);                 // right
  }
  // Specular highlight along the inner lip, brightest at the top where the
  // lamp is, so the rail doesn't read as a flat printed border.
  const gloss = ctx.createLinearGradient(0, 0, 0, h);
  gloss.addColorStop(0, 'rgba(255, 214, 170, 0.55)');
  gloss.addColorStop(0.45, 'rgba(255, 214, 170, 0.16)');
  gloss.addColorStop(1, 'rgba(255, 214, 170, 0.05)');
  ctx.fillStyle = gloss;
  const inner = width * 0.72;
  const t = Math.max(1, width * 0.1);
  ctx.fillRect(inner, inner, w - 2 * inner, t);
  ctx.fillRect(inner, h - inner - t, w - 2 * inner, t);
  ctx.fillRect(inner, inner, t, h - 2 * inner);
  ctx.fillRect(w - inner - t, inner, t, h - 2 * inner);
}

// Lays the table down behind everything else: one picture the size of the
// board, at the bottom of the draw order. The grain is laid in device pixels
// rather than board units - it is the one thing on the table that should be
// as fine as the screen, not scaled up with the rest of the board.
export function drawTableSurface(board: Board): Sprite {
  const w = board.width;
  const h = board.height;
  const density = Math.min(board.pixelRatio, SURFACE_MAX_PX / w, SURFACE_MAX_PX / h);
  const pw = Math.floor(w * density);
  const ph = Math.floor(h * density);
  const region = board.atlas.obtain(`table-surface-${w}x${h}@${pw}`, pw, ph, (pen) => {
    const ctx = pen as Pen;
    ctx.save();
    ctx.scale(pw / w, ph / h);
    paintFelt(ctx, w, h);
    ctx.restore();

    // The nap sits over the felt but inside the rail, so the wood stays
    // polished rather than picking up cloth grain.
    const inset = RAIL_WIDTH * density;
    const nap = ctx.createPattern(noiseTile(), 'repeat');
    if (nap) {
      ctx.save();
      ctx.globalAlpha = NOISE_ALPHA;
      ctx.fillStyle = nap;
      ctx.fillRect(inset, inset, pw - 2 * inset, ph - 2 * inset);
      ctx.restore();
    }

    ctx.save();
    ctx.scale(pw / w, ph / h);
    drawRail(ctx, w, h, RAIL_WIDTH);
    ctx.restore();
  });
  return board.image(region, { x: w / 2, y: h / 2, width: w, height: h, depth: -1_000_000 });
}


// --- table dressing ------------------------------------------------------

// The lettering on a casino layout is condensed serif, all caps, widely
// letter-spaced, and flanked by engraved scrollwork. That's what makes the
// felt read as a printed layout rather than as a label floating over a
// background.
const LABEL_GOLD = 'rgba(216, 180, 113, 1)';
const LABEL_GOLD_CSS = '#e3c489';
const LABEL_SIZE = 15;
const LABEL_SPACING = 4;
// The room one flourish takes beside the text: the gap, the stroke, the curl.
const FLOURISH_ROOM = 12 + 34 + 12;

// A scroll curl, generated as a polyline rather than from arcs so the
// spiral actually tightens instead of stepping between fixed radii.
function spiralPoints(
  cx: number, cy: number, startRadius: number, turns: number, dir: number,
): [number, number][] {
  const steps = 28;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = Math.PI / 2 + dir * t * turns * Math.PI * 2;
    const r = startRadius * (1 - 0.72 * t);
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return points;
}

// One flourish: a tapered engraved stroke running away from the text, a
// lozenge where it meets it, and a curl at the far end. `dir` is -1 for the
// flourish left of the label, +1 for the one on the right.
function drawFlourish(g: Pen, x: number, y: number, dir: number): void {
  const length = 34;
  const tip = x + dir * length;

  // Tapered stroke, drawn as a filled lens so it thins toward the curl the
  // way an engraved line does. A constant-width line just reads as a rule.
  g.fillStyle = LABEL_GOLD;
  g.globalAlpha = 0.9;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + dir * length * 0.55, y - 1.5);
  g.lineTo(tip, y - 0.4);
  g.lineTo(tip, y + 0.4);
  g.lineTo(x + dir * length * 0.55, y + 1.5);
  g.closePath();
  g.fill();

  // Lozenge at the inner end, next to the text.
  g.globalAlpha = 0.95;
  g.beginPath();
  g.moveTo(x, y - 3);
  g.lineTo(x + dir * 4.5, y);
  g.lineTo(x, y + 3);
  g.lineTo(x - dir * 4.5, y);
  g.closePath();
  g.fill();

  // Curl at the outer end, turning back on itself.
  g.globalAlpha = 0.9;
  g.strokeStyle = LABEL_GOLD;
  g.lineWidth = 1.4;
  const curl = spiralPoints(tip + dir * 4.5, y - 2.5, 5.2, 0.85, dir);
  g.beginPath();
  g.moveTo(curl[0][0], curl[0][1]);
  for (const [px, py] of curl.slice(1)) g.lineTo(px, py);
  g.stroke();
  g.globalAlpha = 1;
}

/**
 * A section heading in the style of a printed layout, centred on x, y.
 *
 * Painted once, so the display face has to be loaded first - see fontsReady.
 * Letter-spaced by hand, a letter at a time, because canvas letterSpacing is
 * not in every Safari this game still runs on.
 */
export function drawSectionLabel(board: Board, x: number, y: number, label: string): Sprite {
  const text = label.toUpperCase();
  const font = `${DISPLAY_WEIGHT} ${LABEL_SIZE}px ${DISPLAY_FONT}`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const advances = [...text].map((ch) => measure.measureText(ch).width);
  const textWidth = advances.reduce((a, b) => a + b, 0) + LABEL_SPACING * Math.max(0, advances.length - 1);
  const width = Math.ceil(textWidth + 2 * FLOURISH_ROOM);
  const height = 30;
  return board.graphic(width, height, (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    g.font = font;
    g.fillStyle = LABEL_GOLD_CSS;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    let at = cx - textWidth / 2;
    [...text].forEach((ch, i) => {
      g.fillText(ch, at, cy);
      at += advances[i] + LABEL_SPACING;
    });
    const gap = textWidth / 2 + 12;
    drawFlourish(g, cx - gap, cy, -1);
    drawFlourish(g, cx + gap, cy, 1);
  }, { key: `section-label-${text}`, x, y });
}


// --- where a pile goes ----------------------------------------------------

// An empty pile is printed on the felt rather than left blank, because in
// Klondike an empty column is a resource - the place a king can go - and it
// has to look like a slot waiting for a card rather than like table.
//
// Faint, and stroked rather than filled: a filled rectangle at any alpha
// reads as a card face-down, and the board already has plenty of those.
const SLOT_LINE = 'rgba(253, 253, 253, 0.18)';
const SLOT_RADIUS = 6;

function outline(
  board: Board, key: string, x: number, y: number, width: number, height: number,
  line: number, color: string,
): Sprite {
  const pad = Math.ceil(line);
  return board.graphic(width + pad * 2, height + pad * 2, (g) => {
    g.strokeStyle = color;
    g.lineWidth = line;
    g.beginPath();
    g.roundRect(pad, pad, width, height, SLOT_RADIUS);
    g.stroke();
  }, { key: `${key}-${width}x${height}`, x, y, depth: -1000 });
}

export function drawSlot(board: Board, x: number, y: number, width: number, height: number): Sprite {
  return outline(board, 'slot', x, y, width, height, 1.5, SLOT_LINE);
}

/** The gold a pile lights up in when a dragged run would be taken by it. Starts hidden. */
export function drawHighlight(board: Board, x: number, y: number, width: number, height: number): Sprite {
  const sprite = outline(board, 'slot-highlight', x, y, width, height, 2.5, 'rgba(255, 209, 102, 0.95)');
  sprite.depth = -900;
  sprite.visible = false;
  return sprite;
}

// The arrow on the empty stock: the one slot whose meaning is not "put a
// card here" but "press to turn the deck over". Drawn as a ring with a break
// and an arrowhead, which is the shape everything else in the world uses for
// this and so needs no label.
export function drawRecycleMark(board: Board, x: number, y: number, radius: number): Sprite {
  const size = radius * 2 + 12;
  return board.graphic(size, size, (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const color = 'rgba(253, 253, 253, 0.32)';
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, radius, (40 * Math.PI) / 180, (320 * Math.PI) / 180, false);
    g.stroke();

    // The head sits at the open end of the ring, pointing the way round it.
    const tipAngle = (320 * Math.PI) / 180;
    const tx = cx + Math.cos(tipAngle) * radius;
    const ty = cy + Math.sin(tipAngle) * radius;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(tx + 5, ty - 1);
    g.lineTo(tx - 4, ty - 4);
    g.lineTo(tx - 1, ty + 5);
    g.closePath();
    g.fill();
  }, { key: `recycle-${radius}`, x, y, depth: -1000 });
}


// --- the printed border ----------------------------------------------------

// Each game's felt is printed with its own running border just inside the
// rail - one of felt's band ornaments, in the label's gold and worn into the
// nap - so the twelve tables read as twelve layouts rather than one cloth
// with different cards on it. Picked to suit the game where one suits:
// peaks for Tri Peaks, waves for Seahaven, the stepped dentil for Pyramid.
export const TABLE_PATTERNS: Record<GameId, BorderPattern> = {
  klondike: 'greek-key',
  freecell: 'interlace',
  yukon: 'rope',
  canfield: 'bead-and-reel',
  spider: 'interlace',
  spiderette: 'guilloche',
  scorpion: 'running-dog',
  seahaven: 'scallop',
  calculation: 'bead-and-reel',
  lucie: 'scallop',
  tripeaks: 'chevron',
  pyramid: 'dentil',
  golf: 'rope',
  blackhole: 'guilloche',
  acesup: 'greek-key',
  pokersquares: 'dentil',
  cribbagesquares: 'running-dog',
  blackjack: 'chevron',
};

// Faint: it is printing on the cloth, under the slots and the cards, and has
// to lose to both of them.
const BORDER_ALPHA = 0.42;
const BORDER_DEPTH = -1100;
const BORDER_BAND = 8;
const BORDER_GAP = 4;
const ROSETTE_SIZE = 150;

/**
 * Prints the game's border round the felt, inside the rail, and a rosette
 * at the head of the table - the felt a tall screen leaves bare above the
 * layout, which slides up over it as the tableau needs the room. Left off
 * (`rosette: false`) where the layout's own lettering would sit on it.
 * Fixed to the table, not the layout: it does not slide with the markings.
 */
export function paintTableBorder(board: Board, game: GameId, rosette = true): FeltPaint[] {
  const inset = RAIL_WIDTH + BORDER_GAP;
  const paint = { color: LABEL_GOLD_CSS, wear: 0.35, alpha: BORDER_ALPHA };
  // A frame's `depth` is its band's, across; where it sorts is set after.
  const marks = paintFeltFrame(board, TABLE_PATTERNS[game], {
    ...paint,
    x: board.width / 2, y: board.height / 2,
    width: board.width - inset * 2, height: board.height - inset * 2,
    depth: BORDER_BAND, stroke: 1.1,
  });
  if (rosette) marks.push(paintOnFelt(board, { path: rosettePath(), viewBox: [200, 200], width: ROSETTE_SIZE, stroke: 0.9 },
    { ...paint, alpha: 0.2, x: board.width / 2, y: inset + BORDER_BAND + 24 + ROSETTE_SIZE / 2 }));
  for (const mark of marks) mark.depth = BORDER_DEPTH;
  return marks;
}

/**
 * A guilloché rosette in a 200 x 200 box, generated rather than drawn:
 * strands of one wave round a circle, each a little out of phase with the
 * last, weaving a net between two plain rings.
 */
function rosettePath(): string[] {
  const c = 100;
  const curve = (r: (t: number) => number) => {
    let d = '';
    for (let i = 0; i <= 240; i++) {
      const t = (i / 240) * Math.PI * 2;
      d += `${i ? 'L' : 'M'}${(c + r(t) * Math.cos(t)).toFixed(2)} ${(c + r(t) * Math.sin(t)).toFixed(2)}`;
    }
    return `${d}Z`;
  };
  const strands = Array.from({ length: 6 }, (_, k) => curve((t) => 72 + 14 * Math.sin(12 * t + (k * Math.PI) / 3)));
  const heart = Array.from({ length: 4 }, (_, k) => curve((t) => 30 + 12 * Math.sin(8 * t + (k * Math.PI) / 2)));
  return [curve(() => 92), curve(() => 52), ...strands, ...heart];
}
