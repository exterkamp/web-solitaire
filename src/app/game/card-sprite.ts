import Phaser from 'phaser';
import { CARD_WIDTH, CARD_HEIGHT, RED_SUITS, Rank, Suit, SUITS } from './config';
import { Card } from './deck';
import {
  DeckTheme,
  DEFAULT_BACK_COLOR,
  DEFAULT_DECK_THEME,
  deckThemePath,
} from './deck-theme';
import { CARD_INDEX_FONT, TEXT_OVERSAMPLE } from './fonts';

// One card, drawn.
//
// Ported from Nertz, which is where all of the measurements below were
// arrived at, and cut down on the way: that deck carries bought modifiers,
// four players' colours and a fifth suit, none of which exist here. What is
// left is the part that makes a card legible at 60x84 on a phone, which is
// the same problem in both games.

// The index and the mark badges. Not the body face the rest of the app's
// numbers use - see the note on CARD_INDEX_FONT in fonts.ts for why a card
// corner is its own problem.
const CARD_FONT = CARD_INDEX_FONT;

// Only the top-left corner is indexed - a mirrored bottom-right copy is
// redundant once the card is legible at a glance, and dropping it freed up
// the room to make everything else bigger.

// 27, measured rather than picked: Archivo at 27px puts down the same 19px
// of ink that Helvetica at 28 did, which is the proportion the corner was
// laid out against and what CORNER_INK_HALF_HEIGHT below was measured from.
// Every rank spans that same 19 except Q, whose tail drops 3 below the
// baseline and is decorative rather than distinguishing.
const CORNER_FONT_SIZE = 27;

// Half-height of the corner index's actual *ink* at CORNER_FONT_SIZE,
// measured off a rendered card rather than taken from the Text object's
// height. A font box is substantially taller than the glyphs inside it -
// all the leading above the cap and below the baseline is empty - and
// sizing the fan off the box is what used to leave a band of blank card
// under every index in a stack.
const CORNER_INK_HALF_HEIGHT = 9.7;
// Gap from the card's top edge to the top of that ink. Small, but not
// smaller than the corner radius, or the first glyph starts to poke into
// the rounded corner.
const CORNER_INK_TOP_MARGIN = 6;
// Matching gap under the ink, which is all the fan needs to leave below an
// index for it to read as deliberate rather than clipped.
const CORNER_INK_BOTTOM_MARGIN = 4;

const CORNER_CENTER_Y = CARD_HEIGHT / 2 - (CORNER_INK_TOP_MARGIN + CORNER_INK_HALF_HEIGHT);

// How much of a card a fanned tableau pile reveals of the card below it:
// the index and its two margins, and nothing else.
export const CARD_PEEK_HEIGHT =
  CORNER_INK_TOP_MARGIN + 2 * CORNER_INK_HALF_HEIGHT + CORNER_INK_BOTTOM_MARGIN;

// What a face-down card in a tableau pile shows of itself. There is nothing
// to read on the back, so it only has to be visibly a card: enough to see
// its edge and its shadow, and no more, because every unit spent here is a
// unit the face-up cards below it do not get on a 900-unit screen.
export const CARD_BACK_PEEK_HEIGHT = 11;

// The center of a 2-10 card is one big suit glyph, not an accurate pip
// count - a real pip layout for a 10 needs 5 rows of tiny glyphs to fit,
// which reads as a blurry cluster rather than a legible card at this size.
// A single big icon (same treatment Aces get) trades "shows the exact
// count" for "instantly readable," which matters far more at the small
// sizes cards render at here.
const CENTER_SUIT_SIZE = 48;
const CENTER_SUIT_CENTER_Y = 12.5;

// Suits are drawn from their own artwork rather than the font's Unicode
// glyphs. In most typefaces the club and the spade are near-identical
// blobs at card size - same mass, same stem - and telling them apart is
// exactly what the game asks of you at a glance. These are shaped to be
// distinguishable instead: the spade is one solid pointed mass, the club
// three round lobes with the notches between them left open.
//
// One asset per suit, drawn white and recoloured into its own texture by
// colouredSuitKey below, since a suit is only ever one flat colour. It was a
// Phaser tint until that turned out to need WebGL.
const SUIT_ART_FILES: Record<Suit, string> = {
  spades: 'spade',
  hearts: 'heart',
  diamonds: 'diamond',
  clubs: 'club',
};
const SUIT_RED = 0xcf2436;
const SUIT_BLACK = 0x1a1a1a;

function suitTintFor(suit: Suit): number {
  return RED_SUITS.has(suit) ? SUIT_RED : SUIT_BLACK;
}

function rankColorFor(suit: Suit): string {
  return RED_SUITS.has(suit) ? '#cf2436' : '#1a1a1a';
}

function suitArtKey(suit: Suit): string {
  return `suit-${SUIT_ART_FILES[suit]}`;
}

// The pip drawn from the font instead, for when the artwork did not arrive.
//
// The whole reason these are SVGs is that a typeface's club and spade are the
// same blob at card size - so this is a worse pip on purpose, and only ever
// reached when the better one is missing. A slightly ambiguous club beats a
// solid block, which is not a card at all.
const SUIT_GLYPHS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

// A pip-shaped hole. The last resort, so that "no pip" is a card missing its
// suit rather than Phaser's placeholder pretending to be one.
function blankSuitKey(scene: Phaser.Scene): string {
  const key = 'suit-blank';
  if (!scene.textures.exists(key)) scene.textures.createCanvas(key, 2, 2);
  return key;
}

function glyphSuitKey(scene: Phaser.Scene, suit: Suit, colour: number): string {
  const key = `suit-glyph-${suit}-${colour.toString(16)}`;
  if (scene.textures.exists(key)) return key;

  const size = 200;
  const texture = scene.textures.createCanvas(key, size, size);
  // Only reachable if the key is already taken, which the line above rules
  // out - but both callers hand what comes back straight to add.image, and
  // add.image answers a key it does not know with an opaque placeholder. So
  // the contract here is that the key returned always exists, even when that
  // means an empty square.
  if (!texture) return blankSuitKey(scene);

  const ctx = texture.getContext();
  ctx.fillStyle = Phaser.Display.Color.IntegerToColor(colour).rgba;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // serif rather than the display face: these four glyphs are the one thing
  // every system serif is guaranteed to have, and a pip that fell back to
  // tofu would be the block this exists to avoid.
  //
  // Measured and scaled rather than sized by eye, because a suit character
  // carries a lot of its own padding and how much differs by font. Two
  // passes: one to find what the glyph actually fills, one to draw it at the
  // size that fills the canvas.
  const glyph = SUIT_GLYPHS[suit];
  const probe = 100;
  ctx.font = `${probe}px serif`;
  const m = ctx.measureText(glyph);
  const inkWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const inkHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  // Older engines leave the actualBoundingBox metrics undefined. 0.86 is what
  // the measured path lands on for a diamond, so it is the right guess to
  // fall back to.
  const fits = inkWidth > 0 && inkHeight > 0;
  const scale = fits ? Math.min(size / inkWidth, size / inkHeight) : size * 0.0086;
  ctx.font = `${Math.round(probe * scale)}px serif`;
  // Centre on the ink, not on the baseline: the two are not the same point
  // for a glyph that sits high in its em box.
  if (fits) {
    const after = ctx.measureText(glyph);
    const left = after.actualBoundingBoxLeft, right = after.actualBoundingBoxRight;
    const up = after.actualBoundingBoxAscent, down = after.actualBoundingBoxDescent;
    ctx.fillText(glyph, size / 2 + (left - right) / 2, size / 2 + (up - down) / 2);
  } else {
    ctx.fillText(glyph, size / 2, size / 2);
  }
  texture.refresh();
  return key;
}

function colouredSuitKey(scene: Phaser.Scene, suit: Suit, colour: number): string {
  const key = `${suitArtKey(suit)}-${colour.toString(16)}`;
  if (scene.textures.exists(key)) return key;

  // The artwork may not be there.
  //
  // textures.get() answers with Phaser's __MISSING placeholder rather than
  // nothing when a key was never loaded, and that placeholder is *opaque* -
  // so the source-in fill below, which exists to paint a shape, paints the
  // whole rectangle instead. One suit's SVG failing to arrive turned every
  // card of that suit into a solid red or black block, and it looked far more
  // like a deliberate design than a failed request.
  if (!scene.textures.exists(suitArtKey(suit))) return glyphSuitKey(scene, suit, colour);

  const source = scene.textures.get(suitArtKey(suit)).getSourceImage();
  const width = source.width;
  const height = source.height;
  const texture = scene.textures.createCanvas(key, width, height);
  // createCanvas returns null if the key is taken or the texture cannot be
  // made. The white original is a poor pip but a better outcome than none.
  if (!texture) return suitArtKey(suit);

  const ctx = texture.getContext();
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  // Keep the shape that was just drawn, replace everything it is made of.
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = Phaser.Display.Color.IntegerToColor(colour).rgba;
  ctx.fillRect(0, 0, width, height);
  texture.refresh();
  return key;
}

// The back pattern: a bordered frame, a lattice field and a central rosette,
// the three things a traditional card back is built from - here as guilloche,
// the lathe-turned line work on a banknote.
//
// Drawn in ink on transparency and laid over a solid fill, so one asset
// serves every colour rather than one file per colour. Nothing in it may be
// opaque behind the pattern: the fill showing through is the whole of what
// the deck colour setting changes.
const CARD_BACK_TEXTURE = 'card-back';

// Hairline edge on face-up cards, so a fanned run doesn't merge into one
// white shape. Barely visible on a card by itself, which is the point.
const CARD_EDGE_COLOR = 0xc9c9c9;

// A card lying on the felt under an overhead lamp throws a short shadow.
// Faked as a few stacked rounded rects, each a little larger and fainter
// than the last, which is a cheap stand-in for a blur - and it costs no
// extra game object, since it's drawn into the card's own texture.
const SHADOW_COLOR = 0x000000;
const SHADOW_OFFSET_Y = 2.5;
const SHADOW_LAYERS = [
  { grow: 0.5, alpha: 0.20 },
  { grow: 2.0, alpha: 0.11 },
  { grow: 3.8, alpha: 0.06 },
];

// Room around the card body for the shadow to spread into. The widest layer
// grows 3.8 and the whole thing is shifted 2.5 down, so 7 clears it on every
// side and keeps the padding symmetric - which matters because the card body
// then sits dead centre of the texture.
const BG_PAD = 7;

// Every card has one of two backgrounds: a face, or a back in the deck's
// colour. They're baked into textures once instead of being drawn per card
// with Graphics.
//
// This is the single biggest thing for frame rate here. Phaser re-walks a
// Graphics object's command list every frame, and fillRoundedRect
// tessellates its corners into triangles each time; as textures they're
// plain quads that batch.
function backgroundTextureKey(faceUp: boolean, borderColor: number): string {
  const scale = CardSprite.textResolution;
  return faceUp ? `cardbg-face-${scale}` : `cardbg-back-${borderColor}-${scale}`;
}

function ensureBackgroundTexture(
  scene: Phaser.Scene, faceUp: boolean, borderColor: number,
): string {
  const key = backgroundTextureKey(faceUp, borderColor);
  if (scene.textures.exists(key)) return key;

  // Drawn at the device's pixel ratio and displayed back down to board
  // units, for the same reason Text carries a resolution: the root container
  // scales everything up, and a 1:1 texture would soften.
  const scale = CardSprite.textResolution;
  const w = CARD_WIDTH + 2 * BG_PAD;
  const h = CARD_HEIGHT + 2 * BG_PAD;
  const g = new Phaser.GameObjects.Graphics(scene);
  g.scale = scale;

  for (const layer of SHADOW_LAYERS) {
    g.fillStyle(SHADOW_COLOR, layer.alpha);
    g.fillRoundedRect(
      BG_PAD - layer.grow,
      BG_PAD - layer.grow + SHADOW_OFFSET_Y,
      CARD_WIDTH + 2 * layer.grow,
      CARD_HEIGHT + 2 * layer.grow,
      6 + layer.grow,
    );
  }
  g.fillStyle(faceUp ? 0xfdfdfd : borderColor, 1);
  g.fillRoundedRect(BG_PAD, BG_PAD, CARD_WIDTH, CARD_HEIGHT, 6);
  // Face-down cards need a border in the deck's own colour since a solid
  // fill is all they show. Face-up cards get a hairline grey edge instead:
  // fanned out in a tableau pile, one white card covering another leaves no
  // visible seam, and the whole run reads as a single tall card with a
  // column of indices printed down it.
  g.lineStyle(faceUp ? 1 : 2, faceUp ? CARD_EDGE_COLOR : borderColor, 1);
  g.strokeRoundedRect(BG_PAD, BG_PAD, CARD_WIDTH, CARD_HEIGHT, 6);

  g.generateTexture(key, Math.ceil(w * scale), Math.ceil(h * scale));
  g.destroy();
  return key;
}

const CORNER_LEFT_MARGIN = 5;
const CORNER_SUIT_GAP = 1;
const CORNER_SUIT_SIZE = 20;

// J/Q/K carry an illustrated figure across the bottom of the card, bleeding
// to the left, right and bottom edges, with this card's own index above it.
//
// It is the upper half of Dmitry Fomin's CC0 English pattern cards - see
// public/cards/ATTRIBUTION.md. Those are double-ended, so the top half is one
// whole figure and the bottom half is the same figure upside down; the
// source's own index and pips are painted out in the bake, because the deck
// reads better when every card's index is the same one.
//
// There's one per rank *and suit*, twelve in all, because the court cards of
// a French-suited deck aren't interchangeable: each is a specific person with
// attributes that survived centuries of copying. The King of diamonds is
// Caesar, the only king in profile and the only one with an axe; the King of
// hearts is Charlemagne, whose raised sword earned him "the suicide king";
// the Jacks of spades and hearts are the other two one-eyed royals.
//
// They can't be recolored with a tint the way the suit glyphs are - the gold
// has to stay gold - so the color is baked in per file.
const FACE_ART_RANKS: Partial<Record<Rank, string>> = {
  J: 'jack',
  Q: 'queen',
  K: 'king',
};

function faceArtKey(rank: Rank, suit: Suit, theme: DeckTheme): string | undefined {
  const name = FACE_ART_RANKS[rank];
  return name ? `face-${theme}-${name}-${suit}` : undefined;
}

// The deck in play, and the colour its backs are printed in.
//
// Module-level rather than passed to every constructor: there is exactly one
// deck on a solitaire table, sprites are made in several places, and the
// alternative is threading a theme through all of them to reach the two lines
// that read it. Set by the scene before any sprite is built.
let currentTheme: DeckTheme = DEFAULT_DECK_THEME;
let currentBackColor: number = DEFAULT_BACK_COLOR;

export function setDeck(theme: DeckTheme, backColor: number): void {
  currentTheme = theme;
  currentBackColor = backColor;
}

function backTextureKey(theme: DeckTheme): string {
  return `${CARD_BACK_TEXTURE}-${theme}`;
}

/**
 * Loads the suit and J/Q/K artwork; call from a scene's preload() before any
 * CardSprite is constructed there.
 *
 * The court art and the back are pre-rendered bitmaps; the suit glyphs are
 * still SVG. The split is about what each one has to do: a suit glyph is
 * recoloured per card, so it has to stay a shape the renderer can fill,
 * while the court art is a finished picture with its own stock, grain and
 * ink, none of which survives being tinted.
 *
 * One theme, not seven. Each is about 680kB, and loading the lot to show one
 * deck would be five megabytes for a game that is otherwise small enough to
 * open on a train.
 */
export function preloadCardArt(scene: Phaser.Scene, theme: DeckTheme): void {
  for (const name of Object.values(FACE_ART_RANKS)) {
    for (const suit of SUITS) {
      scene.load.image(`face-${theme}-${name}-${suit}`,
                       deckThemePath(theme, `${name}-${suit}.webp`));
    }
  }
  scene.load.image(backTextureKey(theme), deckThemePath(theme, 'back.webp'));
  for (const suit of SUITS) {
    scene.load.svg(suitArtKey(suit), `/cards/suits/${SUIT_ART_FILES[suit]}.svg`,
                   { width: 200, height: 200 });
  }
}

/**
 * The white suit artwork, for anything that wants a pip that is not on a
 * card - the ghost printed in an empty foundation, which is the felt's own
 * marking rather than a card and so is neither red nor black.
 */
export function ghostSuitKey(scene: Phaser.Scene, suit: Suit): string {
  return scene.textures.exists(suitArtKey(suit))
    ? suitArtKey(suit)
    : glyphSuitKey(scene, suit, 0xffffff);
}

/** Draws a card as vector shapes, text and - for J/Q/K - an illustration. */
export class CardSprite extends Phaser.GameObjects.Container {
  // Phaser Text objects pre-rasterize to a bitmap at their own font size; the
  // scene scales its whole root container up by devicePixelRatio for HiDPI
  // screens, so text needs a matching resolution or that upscale blurs it
  // same as the canvas would without it. Set once by the scene before any
  // cards are created.
  static textResolution = 1;

  card: Card;
  private bg: Phaser.GameObjects.Image;
  private cornerRank: Phaser.GameObjects.Text;
  private cornerSuit: Phaser.GameObjects.Image;
  private centerSuit?: Phaser.GameObjects.Image;
  private faceArt?: Phaser.GameObjects.Image;
  private back: Phaser.GameObjects.Image;
  private displayFace?: boolean;

  constructor(scene: Phaser.Scene, x: number, y: number, card: Card) {
    super(scene, x, y);
    this.card = card;

    this.bg = scene.add
      .image(0, 0, ensureBackgroundTexture(scene, true, currentBackColor))
      .setDisplaySize(CARD_WIDTH + 2 * BG_PAD, CARD_HEIGHT + 2 * BG_PAD);

    const resolution = CardSprite.textResolution;
    const cornerStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: CARD_FONT,
      fontSize: `${CORNER_FONT_SIZE}px`,
      fontStyle: 'bold',
      color: rankColorFor(card.suit),
      resolution: resolution * TEXT_OVERSAMPLE,
    };

    // Rank then suit across the top-left corner, laid out left to right from
    // the card's edge. That keeps every rank's index starting at the same
    // place no matter how wide its digits are.
    this.cornerRank = scene.add.text(
      -CARD_WIDTH / 2 + CORNER_LEFT_MARGIN,
      -CORNER_CENTER_Y,
      card.rank,
      cornerStyle,
    ).setOrigin(0, 0.5);
    this.cornerSuit = scene.add.image(
      this.cornerRank.x + this.cornerRank.width + CORNER_SUIT_GAP,
      -CORNER_CENTER_Y,
      colouredSuitKey(scene, card.suit, suitTintFor(card.suit)),
    ).setDisplaySize(CORNER_SUIT_SIZE, CORNER_SUIT_SIZE).setOrigin(0, 0.5);

    this.add(this.bg);

    // Laid straight over the coloured fill the background draws, and under
    // everything on the face, so flipping is only a question of which of the
    // two is visible.
    this.back = scene.add.image(0, 0, backTextureKey(currentTheme))
      .setDisplaySize(CARD_WIDTH, CARD_HEIGHT);
    this.add(this.back);

    // Face content: a court figure for J/Q/K, or one big suit for everything
    // else. Both sit below the index, which is added last so it draws over
    // either of them.
    // A court portrait, if the deck this card belongs to actually arrived.
    //
    // The exists() check is what makes an uncached deck survive being played
    // offline. Only the default deck is fetched when the game is installed -
    // seven of them is five megabytes - so a player who picks another one and
    // then loses the network has a board whose court art was never
    // downloaded. Without this they would get Phaser's missing-texture
    // placeholder on twelve cards; with it they get the same big suit the
    // number cards wear, which is a plainer card rather than a broken one.
    const artKey = faceArtKey(card.rank, card.suit, currentTheme);
    if (artKey && scene.textures.exists(artKey)) {
      // Full card width, height from the texture's own proportions, flush
      // with the bottom edge. Taking the aspect from the texture rather than
      // naming a height here keeps this in step with however the art was
      // cropped, and that crop is chosen to fit the figure.
      const tex = scene.textures.get(artKey).getSourceImage();
      const artHeight = (CARD_WIDTH * tex.height) / tex.width;
      this.faceArt = scene.add
        .image(0, CARD_HEIGHT / 2 - artHeight / 2, artKey)
        .setDisplaySize(CARD_WIDTH, artHeight);
      this.add(this.faceArt);
    } else {
      this.centerSuit = scene.add.image(
        0, CENTER_SUIT_CENTER_Y, colouredSuitKey(scene, card.suit, suitTintFor(card.suit)),
      ).setDisplaySize(CENTER_SUIT_SIZE, CENTER_SUIT_SIZE);
      this.add(this.centerSuit);
    }

    this.add(this.cornerRank);
    this.add(this.cornerSuit);

    this.setSize(CARD_WIDTH, CARD_HEIGHT);
    this.redraw();
  }

  setFaceUp(faceUp: boolean): this {
    this.card.faceUp = faceUp;
    this.redraw();
    return this;
  }

  /**
   * Draws the side asked for without touching the card's own faceUp state.
   *
   * A card turning over in mid-air has to show whichever side is pointing at
   * the camera, but it hasn't been flipped - it still belongs to its pile the
   * way it did. Pass undefined to go back to following the card.
   */
  setDisplayFace(faceUp: boolean | undefined): this {
    if (this.displayFace === faceUp) return this;
    this.displayFace = faceUp;
    this.redraw();
    return this;
  }

  private redraw(): void {
    const faceUp = this.displayFace ?? this.card.faceUp;

    // Flipping is just a swap between two baked textures.
    this.bg.setTexture(ensureBackgroundTexture(this.scene, faceUp, currentBackColor));
    this.bg.setDisplaySize(CARD_WIDTH + 2 * BG_PAD, CARD_HEIGHT + 2 * BG_PAD);

    this.back.setVisible(!faceUp);
    this.cornerRank.setVisible(faceUp);
    this.cornerSuit.setVisible(faceUp);
    this.centerSuit?.setVisible(faceUp);
    this.faceArt?.setVisible(faceUp);
  }
}
