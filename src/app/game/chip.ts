import Phaser from 'phaser';
import { DISPLAY_FONT, DISPLAY_WEIGHT } from './fonts';

// A score, in chips, the way a table actually keeps one - not a number in
// the bar but a stack sitting on the felt, the way the felt itself is
// generated rather than shipped as an image (see table.ts). Five
// denominations, each its own colour, the same convention a real casino
// uses so a stack can be read at a glance without counting: white, red,
// blue and purple climbing in value, and the highest one in black with a
// gold edge - the one colour this app otherwise reserves for "this is
// selected", borrowed here because a $100 chip earns it the same way a
// real one does.
export const CHIP_VALUES: readonly number[] = [100, 50, 10, 5, 1];

interface ChipPalette {
  readonly body: string;
  readonly edge: string;
  readonly text: string;
}

const CHIP_PALETTES: Record<number, ChipPalette> = {
  100: { body: '#1c1a1d', edge: '#ffd166', text: '#ffd166' },
  50: { body: '#5b3a86', edge: '#f2ede2', text: '#f2ede2' },
  10: { body: '#2857a6', edge: '#f2ede2', text: '#f2ede2' },
  5: { body: '#b83a2e', edge: '#f2ede2', text: '#f2ede2' },
  1: { body: '#f2ede2', edge: '#8a7a5c', text: '#3a3128' },
};

// Logical size, the same units a card's width is measured in - about
// half a card across, so a whole stack of them still reads as something
// sitting beside the game rather than competing with it.
const CHIP_DIAMETER = 34;
// Oversampled the same way the felt's nap texture is: generated once, at a
// fixed high resolution, then scaled down per instance with
// setDisplaySize - crisp at any device pixel ratio without regenerating a
// texture per screen.
const CHIP_OVERSAMPLE = 4;

// The body a chip falls and stacks with is not its visual face. A real chip
// is a couple of millimetres thick against an inch and a half across, and a
// physics body sized to the full face - a disc stacked on a disc, touching
// at a single point - is what a coin does, not what a chip does: it rolls
// off rather than resting. Sized to the chip's actual footprint instead, a
// flattened box a few units tall, it stacks the way a stack of boxes does in
// any physics demo: solidly while it's centred, and toppling once it isn't -
// which is the whole feature. The face texture is drawn full-size on top of
// this regardless, so the mismatch is never visible - only felt, in how it
// falls.
const CHIP_BODY_WIDTH = 30;
const CHIP_THICKNESS = 7;
// Rounded slightly so a corner doesn't snag on the one below it mid-topple.
const CHIP_CHAMFER = 1.5;

function chipTextureKey(value: number): string {
  return `chip-${value}`;
}

const CHIP_SHADOW_KEY = 'chip-shadow';
// Cast a few units down and to the right of the chip that owns it - away
// from the same upper-left light the dome shading answers to. A pile reads
// as stacked objects rather than flat overlapping circles mostly because of
// this: the shading on one chip's face says which way is up, and its
// shadow falling across the one under it is what says there's a gap between
// them at all.
const CHIP_SHADOW_OFFSET = 3;

function drawChipShadowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(CHIP_SHADOW_KEY)) return;
  const size = CHIP_DIAMETER * CHIP_OVERSAMPLE;
  const texture = scene.textures.createCanvas(CHIP_SHADOW_KEY, size, size);
  if (!texture) return;
  const ctx = texture.getContext();
  const r = size / 2;
  const blur = ctx.createRadialGradient(r, r, r * 0.55, r, r, r);
  blur.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
  blur.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = blur;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  texture.refresh();
}

// Simple RGB lerp toward black or white, for the shading below - there's no
// need for anything more perceptually careful than this at chip size.
function mix(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const t = (c: number) => Math.round(c + (target - c) * amount);
  return `rgb(${t(r)}, ${t(g)}, ${t(b)})`;
}
const lighten = (hex: string, amount: number) => mix(hex, 255, amount);
const darken = (hex: string, amount: number) => mix(hex, 0, amount);

function drawChipTexture(scene: Phaser.Scene, value: number): void {
  const key = chipTextureKey(value);
  if (scene.textures.exists(key)) return;
  const size = CHIP_DIAMETER * CHIP_OVERSAMPLE;
  const texture = scene.textures.createCanvas(key, size, size);
  if (!texture) return;
  const ctx = texture.getContext();
  const r = size / 2;
  const { body, edge, text } = CHIP_PALETTES[value];

  // The body: a dome rather than a flat disc, lit from the same
  // upper-left the felt's own lamp favours (see table.ts's LIGHT_CENTER).
  // Pushed harder than the first pass - a tighter, brighter highlight and a
  // darker falloff read as curved from across the felt; the first version's
  // subtler gradient survived being scaled down to chip size as barely more
  // than a flat tint.
  const dome = ctx.createRadialGradient(r * 0.6, r * 0.46, r * 0.04, r, r, r * 1.05);
  dome.addColorStop(0, lighten(body, 0.45));
  dome.addColorStop(0.4, lighten(body, 0.1));
  dome.addColorStop(0.75, body);
  dome.addColorStop(1, darken(body, 0.5));
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fill();

  // The rim: a dark groove first, then the edge spots a real chip's mould
  // leaves round its circumference - eight rather than more, which at this
  // size read as spots rather than a second ring.
  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = darken(body, 0.5);
  ctx.beginPath();
  ctx.arc(r, r, r - ctx.lineWidth, 0, Math.PI * 2);
  ctx.stroke();

  // A raised edge catches light on the side facing it and loses it on the
  // side away - a lit arc opposite a shadowed one is what tells a flat ring
  // apart from a bevelled one. Both drawn over the groove, upper-left and
  // lower-right to match the dome above.
  ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.032;
  ctx.strokeStyle = lighten(body, 0.55);
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(r, r, r - ctx.lineWidth * 1.4, Math.PI * 0.95, Math.PI * 1.65);
  ctx.stroke();
  ctx.strokeStyle = darken(body, 0.6);
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(r, r, r - ctx.lineWidth * 1.4, -0.05, Math.PI * 0.65);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const spots = 8;
  ctx.fillStyle = edge;
  for (let i = 0; i < spots; i++) {
    const angle = (i / spots) * Math.PI * 2;
    ctx.save();
    ctx.translate(r + Math.cos(angle) * r * 0.84, r + Math.sin(angle) * r * 0.84);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillRect(-size * 0.028, -size * 0.09, size * 0.056, size * 0.18);
    ctx.restore();
  }

  // The inlay: a thin ring setting the denomination apart from the rim,
  // the way a real chip's printed face is inset from its edge spots.
  ctx.strokeStyle = edge;
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.6, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = text;
  ctx.font = `${DISPLAY_WEIGHT} ${size * 0.34}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), r, r + size * 0.02);

  texture.refresh();
}

/** Generates all five chip textures and their shared shadow, once - safe to call every scene start. */
export function ensureChipTextures(scene: Phaser.Scene): void {
  for (const value of CHIP_VALUES) drawChipTexture(scene, value);
  drawChipShadowTexture(scene);
}

// A score broken into the fewest chips that add up to it - the greedy
// change-making a cashier does, which is optimal here because every
// denomination divides the one above it evenly (100/50/10/5/1). Rounded
// and floored first: a score is always a whole number by the time this is
// called, but nothing about the type says so.
export function chipCounts(score: number): { value: number; count: number }[] {
  let remaining = Math.max(0, Math.floor(score));
  const counts: { value: number; count: number }[] = [];
  for (const value of CHIP_VALUES) {
    const count = Math.floor(remaining / value);
    if (count > 0) counts.push({ value, count });
    remaining -= count * value;
  }
  return counts;
}

// The same, flattened into one chip per entry, highest denomination first -
// the order a cashier actually racks a tray in, biggest on the felt first so
// the ones that follow have something to lean on.
function chipList(score: number): number[] {
  return chipCounts(score).flatMap((stack) => Array<number>(stack.count).fill(stack.value));
}

// A single shared shove - one direction, scaled by height up a tidy column -
// turned out to look like exactly what it was: one column, leaning one way,
// in a straight line. Every score produced the same shape. What a dropped
// handful of chips actually looks like is each one landing wherever it
// lands - so that's what this does instead: no column to begin with, no
// shove to knock it over. Every chip gets its own random spot to fall from,
// its own spin, its own drift, and piles up (or doesn't) on whatever's
// already there. Two chips of a score this small look like two chips
// dropped from a hand; twenty look like a spilled tray - both for the same
// reason, because nothing here was staged to look like either.
const POUR_WIDTH = CHIP_BODY_WIDTH * 2.6;

/** A physics chip and the shadow that tracks it - see spawnChipStack. */
export interface ChipBody {
  chip: Phaser.Physics.Matter.Image;
  shadow: Phaser.GameObjects.Image;
}

// Drops the whole score in one pile and lets gravity sort out what that
// looks like. Returns what it created so the scene can destroy it next time
// the score changes - a pile is rebuilt from scratch on every update rather
// than diffed, the same choice restack() makes for the cards themselves.
//
// Each chip comes paired with a shadow rather than one shadow per pile,
// because the pile is the thing that has no fixed shape - two chips lying
// apart need two separate shadows on the felt between them, not one blob
// under wherever their bounding box happens to be.
export function spawnChipStack(
  scene: Phaser.Scene,
  x: number,
  y: number,
  score: number,
  scale: number,
): ChipBody[] {
  const objects: ChipBody[] = [];
  chipList(score).forEach((value, i) => {
    const offsetX = Phaser.Math.FloatBetween(-POUR_WIDTH / 2, POUR_WIDTH / 2) * scale;
    // Staggered rather than level, so chips arrive a beat apart instead of
    // all landing - and fighting the solver for room - on the same instant.
    const offsetY = i * CHIP_THICKNESS * 0.7 * scale;
    const shadow = scene.add
      .image(x + offsetX, y - offsetY, CHIP_SHADOW_KEY)
      .setDisplaySize(CHIP_DIAMETER * scale, CHIP_DIAMETER * scale)
      .setDepth(999);
    const chip = scene.matter.add
      .image(x + offsetX, y - offsetY, chipTextureKey(value), undefined, {
        shape: {
          type: 'rectangle',
          width: CHIP_BODY_WIDTH * scale,
          height: CHIP_THICKNESS * scale,
        },
        chamfer: { radius: CHIP_CHAMFER * scale },
        friction: 0.3,
        frictionStatic: 0.35,
        restitution: 0.2,
      })
      .setDisplaySize(CHIP_DIAMETER * scale, CHIP_DIAMETER * scale)
      .setAngle(Phaser.Math.FloatBetween(-180, 180))
      .setDepth(1000);
    chip.setVelocity(Phaser.Math.FloatBetween(-1.5, 1.5), Phaser.Math.FloatBetween(-0.5, 1));
    chip.setAngularVelocity(Phaser.Math.FloatBetween(-0.2, 0.2));
    objects.push({ chip, shadow });
  });
  return objects;
}

/** Keeps every shadow under the chip that casts it - call once a frame. */
export function trackChipShadows(chips: readonly ChipBody[]): void {
  for (const { chip, shadow } of chips) {
    shadow.setPosition(chip.x + CHIP_SHADOW_OFFSET, chip.y + CHIP_SHADOW_OFFSET);
  }
}
