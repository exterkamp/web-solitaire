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
  const dome = ctx.createRadialGradient(r * 0.62, r * 0.5, r * 0.1, r, r, r);
  dome.addColorStop(0, lighten(body, 0.28));
  dome.addColorStop(0.72, body);
  dome.addColorStop(1, darken(body, 0.38));
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

/** Generates all five chip textures, once - safe to call every scene start. */
export function ensureChipTextures(scene: Phaser.Scene): void {
  for (const value of CHIP_VALUES) drawChipTexture(scene, value);
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

// Drops the whole score in one pile and lets gravity sort out what that
// looks like. Every chip in play, in one column at `x`, spawned already
// stacked rather than dropped from height - each a hair off-centre from the
// one below it, which is enough to seed real instability without staging a
// drop animation this board has no headroom for. From there Matter runs the
// rest: a short stack settles roughly where it started, a tall one leans
// and spills, the way an actual tray of chips does when it's racked too
// fast. Returns what it created so the scene can destroy it next time the
// score changes - a pile is rebuilt from scratch on every update rather
// than diffed, the same choice restack() makes for the cards themselves.
export function spawnChipStack(
  scene: Phaser.Scene,
  x: number,
  y: number,
  score: number,
  scale: number,
): Phaser.Physics.Matter.Image[] {
  const chips = chipList(score);
  const objects: Phaser.Physics.Matter.Image[] = [];

  // A straight stack of boxes sits there forever - real friction holds it
  // fine at this height-to-base ratio, jitter alone or not. What tips a
  // stack of chips over is someone's hand catching the tray, so that's what
  // this gives it: one shove, one direction, chosen once per pile rather
  // than per chip. Scaled by height up the stack the way a real shove is -
  // the base barely moves, the top goes sideways - which is what turns
  // "stack of boxes" into "stack of boxes toppling" instead of "stack of
  // boxes standing at a slight angle".
  const push = (Math.random() < 0.5 ? -1 : 1) * Phaser.Math.FloatBetween(2.5, 4);

  chips.forEach((value, i) => {
    const jitterX = Phaser.Math.FloatBetween(-1.5, 1.5) * scale;
    const chip = scene.matter.add
      .image(x + jitterX, y - i * CHIP_THICKNESS * scale, chipTextureKey(value), undefined, {
        shape: {
          type: 'rectangle',
          width: CHIP_BODY_WIDTH * scale,
          height: CHIP_THICKNESS * scale,
        },
        chamfer: { radius: CHIP_CHAMFER * scale },
        friction: 0.3,
        frictionStatic: 0.35,
        restitution: 0.15,
      })
      .setDisplaySize(CHIP_DIAMETER * scale, CHIP_DIAMETER * scale)
      .setAngle(Phaser.Math.FloatBetween(-3, 3))
      .setDepth(1000);
    chip.setVelocityX(push * (i / chips.length));
    objects.push(chip);
  });
  return objects;
}
