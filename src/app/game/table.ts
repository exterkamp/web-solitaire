import Phaser from 'phaser';
import { DISPLAY_FONT, DISPLAY_WEIGHT, TEXT_OVERSAMPLE } from './fonts';

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

const FELT_TEXTURE = 'table-felt';
const NOISE_TEXTURE = 'table-felt-nap';

// Used as the Phaser canvas clear colour so the corners match the felt
// before anything is drawn over them.
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

function rgba(c: { r: number; g: number; b: number }, a: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

function ensureNoiseTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(NOISE_TEXTURE)) return;
  const texture = scene.textures.createCanvas(NOISE_TEXTURE, NOISE_TILE, NOISE_TILE);
  if (!texture) return;
  const ctx = texture.getContext();
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
  texture.refresh();
}

function ensureFeltTexture(scene: Phaser.Scene, w: number, h: number, scale: number): void {
  if (scene.textures.exists(FELT_TEXTURE)) scene.textures.remove(FELT_TEXTURE);
  const texture = scene.textures.createCanvas(FELT_TEXTURE, w, h);
  if (!texture) return;
  const ctx = texture.getContext();

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

  drawRail(ctx, w, h, RAIL_WIDTH * scale);
  texture.refresh();
}

// A polished rail around the edge: a dark outer lip, the wood itself shaded
// so it reads as rounded, and a specular line along the top where the lamp
// catches it.
function drawRail(ctx: CanvasRenderingContext2D, w: number, h: number, width: number): void {
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

// Lays the table down behind everything else. Call first in create(), before
// anything is added to the scene, so it sits at the bottom of the display
// list. Works in canvas pixels rather than board units: the felt grain is
// the one thing in the game that should be drawn at the device's real
// resolution instead of being scaled up with the rest of the board.
export function drawTableSurface(scene: Phaser.Scene, pixelRatio: number): void {
  const w = scene.scale.width;
  const h = scene.scale.height;

  ensureNoiseTexture(scene);
  ensureFeltTexture(scene, w, h, pixelRatio);

  scene.add.image(0, 0, FELT_TEXTURE).setOrigin(0, 0);

  // The nap sits over the felt but inside the rail, so the wood stays
  // polished rather than picking up cloth grain.
  const inset = RAIL_WIDTH * pixelRatio;
  scene.add
    .tileSprite(inset, inset, w - 2 * inset, h - 2 * inset, NOISE_TEXTURE)
    .setOrigin(0, 0)
    .setAlpha(NOISE_ALPHA);
}


// --- table dressing ------------------------------------------------------

// The lettering on a casino layout is condensed serif, all caps, widely
// letter-spaced, and flanked by engraved scrollwork. That's what makes the
// felt read as a printed layout rather than as a label floating over a
// background, and it costs nothing but a Text style and a few strokes.
const LABEL_GOLD = 0xd8b471;
const LABEL_GOLD_CSS = '#e3c489';

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
function drawFlourish(g: Phaser.GameObjects.Graphics, x: number, y: number, dir: number): void {
  const length = 34;
  const tip = x + dir * length;

  // Tapered stroke, drawn as a filled lens so it thins toward the curl the
  // way an engraved line does. A constant-width line just reads as a rule.
  g.fillStyle(LABEL_GOLD, 0.9);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + dir * length * 0.55, y - 1.5);
  g.lineTo(tip, y - 0.4);
  g.lineTo(tip, y + 0.4);
  g.lineTo(x + dir * length * 0.55, y + 1.5);
  g.closePath();
  g.fillPath();

  // Lozenge at the inner end, next to the text.
  g.fillStyle(LABEL_GOLD, 0.95);
  g.beginPath();
  g.moveTo(x, y - 3);
  g.lineTo(x + dir * 4.5, y);
  g.lineTo(x, y + 3);
  g.lineTo(x - dir * 4.5, y);
  g.closePath();
  g.fillPath();

  // Curl at the outer end, turning back on itself.
  g.lineStyle(1.4, LABEL_GOLD, 0.9);
  const curl = spiralPoints(tip + dir * 4.5, y - 2.5, 5.2, 0.85, dir);
  g.beginPath();
  g.moveTo(curl[0][0], curl[0][1]);
  for (const [px, py] of curl.slice(1)) g.lineTo(px, py);
  g.strokePath();
}

// A section heading in the style of a printed layout. Returns the objects so
// the caller can put them in whichever container it keeps its board in.
export function drawSectionLabel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  resolution: number,
): Phaser.GameObjects.GameObject[] {
  const text = scene.add.text(x, y, label.toUpperCase(), {
    fontFamily: DISPLAY_FONT,
    fontSize: '15px',
    fontStyle: DISPLAY_WEIGHT,
    color: LABEL_GOLD_CSS,
    resolution: resolution * TEXT_OVERSAMPLE,
  }).setOrigin(0.5);
  // Letter spacing is what sells it - casino lettering is set wide. Phaser
  // counts the trailing gap in the width too, so nudge back by half of it
  // to keep the text optically centred on x.
  const spacing = 4;
  text.setLetterSpacing(spacing);
  text.setX(x - spacing / 2);

  const g = scene.add.graphics();
  const gap = text.width / 2 + 12;
  drawFlourish(g, x - gap, y, -1);
  drawFlourish(g, x + gap, y, 1);

  return [g, text];
}


// --- where a pile goes ----------------------------------------------------

// An empty pile is printed on the felt rather than left blank, because in
// Klondike an empty column is a resource - the place a king can go - and it
// has to look like a slot waiting for a card rather than like table.
//
// Faint, and stroked rather than filled: a filled rectangle at any alpha
// reads as a card face-down, and the board already has plenty of those.
const SLOT_LINE = 0xfdfdfd;
const SLOT_ALPHA = 0.18;
const SLOT_RADIUS = 6;

export function drawSlot(
  scene: Phaser.Scene, x: number, y: number, width: number, height: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.lineStyle(1.5, SLOT_LINE, SLOT_ALPHA);
  g.strokeRoundedRect(x - width / 2, y - height / 2, width, height, SLOT_RADIUS);
  return g;
}

// The arrow on the empty stock: the one slot whose meaning is not "put a
// card here" but "press to turn the deck over". Drawn as a ring with a break
// and an arrowhead, which is the shape everything else in the world uses for
// this and so needs no label.
export function drawRecycleMark(
  scene: Phaser.Scene, x: number, y: number, radius: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.lineStyle(2, SLOT_LINE, 0.32);
  g.beginPath();
  g.arc(x, y, radius, Phaser.Math.DegToRad(40), Phaser.Math.DegToRad(320), false);
  g.strokePath();

  // The head sits at the open end of the ring, pointing the way round it.
  const tipAngle = Phaser.Math.DegToRad(320);
  const tx = x + Math.cos(tipAngle) * radius;
  const ty = y + Math.sin(tipAngle) * radius;
  g.fillStyle(SLOT_LINE, 0.32);
  g.beginPath();
  g.moveTo(tx + 5, ty - 1);
  g.lineTo(tx - 4, ty - 4);
  g.lineTo(tx - 1, ty + 5);
  g.closePath();
  g.fillPath();
  return g;
}
