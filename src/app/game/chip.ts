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
// How far a chip sits above the one under it in a stack - not the chip's
// own thickness so much as how much of the one below has to peek out for
// the stack to read as a stack rather than one chip with a shadow.
const CHIP_RISE = 3.5;
// Horizontal room between one denomination's column and the next.
const STACK_GAP = CHIP_DIAMETER + 6;

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

// Draws the whole tray: one column per denomination in play, highest value
// innermost (closest to the anchor) so the stack a player glances at first
// is the one carrying the most weight, the rest fanning out to its left.
// Returns what it created so the scene can destroy it next time the score
// changes - a stack is rebuilt from scratch on every update rather than
// diffed, the same choice restack() makes for the cards themselves.
export function drawChipStack(
  scene: Phaser.Scene,
  anchorX: number,
  anchorY: number,
  score: number,
): Phaser.GameObjects.Image[] {
  const objects: Phaser.GameObjects.Image[] = [];
  chipCounts(score).forEach((stack, columnIndex) => {
    const x = anchorX - columnIndex * STACK_GAP;
    for (let i = 0; i < stack.count; i++) {
      const y = anchorY - i * CHIP_RISE;
      objects.push(
        scene.add.image(x, y, chipTextureKey(stack.value)).setDisplaySize(CHIP_DIAMETER, CHIP_DIAMETER),
      );
    }
  });
  return objects;
}
