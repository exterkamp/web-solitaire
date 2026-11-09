// The pictures in the README, taken by playing the game.
//
// A screenshot in a repository goes stale the moment somebody moves a button,
// and the only defence is to make retaking them a command rather than an
// afternoon. This drives the same headless Chrome the smoke test does, at a
// phone's size and pixel ratio, and writes webp because these are photographs
// of a canvas and a png of one is four times the size for no visible gain.
//
//   node tools/screenshots.mjs [--host=http://localhost:8083]
//   node tools/screenshots.mjs --thumbs-only          # public/game-thumbs/ only
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const host = process.argv.find((a) => a.startsWith('--host='))?.slice(7) ?? 'http://localhost:8083';
// `--only=freecell` retakes one picture. Handy, because the thing that makes a
// shot worth retaking is usually one board looking wrong rather than six.
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const wanted = (name) => !only || only.split(',').includes(name);
// For redoing the in-app thumbnails alone, without also retaking (and
// diffing) every README picture along the way.
const thumbsOnly = process.argv.includes('--thumbs-only');
const out = new URL('../docs/screenshots/', import.meta.url).pathname;
// The same shape, small: what the main menu's tiles and the setup page's
// lead image are cropped from with CSS, not two separate photo shoots.
// Shipped in the app itself, so quality and size are a budget rather than a
// README nicety - see ngsw-config.json.
const thumbOut = new URL('../public/game-thumbs/', import.meta.url).pathname;
mkdirSync(thumbOut, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A phone, and a real one: 412x915 at two device pixels to the CSS pixel is a
// mid-range Android, and the board scales itself by that ratio - so a shot
// taken at 1 would not be the picture anybody is looking at.
const WIDTH = 412, HEIGHT = 915, DPR = 2;

const port = 9300 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'shot-'));
// Detached, and killed by process group at the end. A headless Chrome left
// running is not a stray process, it is 25MB of resident memory that nobody
// is ever going to notice until the machine falls over.
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--window-size=${WIDTH},${HEIGHT}`, `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', detached: true });

const done = (code = 0) => {
  try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(code);
};
process.on('uncaughtException', (error) => { console.error(error.message); done(1); });

let page;
for (let i = 0; i < 40 && !page; i++) {
  try {
    const list = await (await fetch(`http://localhost:${port}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
  } catch { await sleep(400); }
}
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener('open', r));
let id = 1;
const pending = new Map();
socket.addEventListener('message', (e) => {
  const message = JSON.parse(e.data);
  if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
});
const send = (method, params = {}) => new Promise((r) => {
  pending.set(id, r);
  socket.send(JSON.stringify({ id: id++, method, params }));
});
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
    .result?.result?.value;
const until = async (expression, what, ms = 60000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await sleep(300);
  }
  console.log('  timed out waiting for', what);
  return false;
};

const SCENE = `window.__game`;

// A point on the board, in page coordinates: board units to CSS pixels (felt
// fits the canvas into the box the page gave it), and then into the page.
// Same two transforms the smoke test makes, for the same reason - a tap that
// misses the card is a screenshot of nothing happening.
const onPage = (expression) => `(() => {
  const canvas = ${SCENE}.board.canvas;
  const box = canvas.getBoundingClientRect();
  const scale = box.width / ${SCENE}.board.width;
  const place = (at) => ({ x: box.left + at.x * scale, y: box.top + at.y * scale });
  const found = ${expression};
  return Array.isArray(found) ? found.map(place) : place(found);
})()`;

// Wherever a card is showing its face and could be tapped: the top of every
// tableau pile, and the waste.
const FACES = `(() => {
  const scene = ${SCENE};
  const points = [];
  for (const pile of scene.table.piles(scene.session.state)) {
    if (pile.ref.kind !== 'tableau' && pile.ref.kind !== 'waste') continue;
    const top = pile.cards[pile.cards.length - 1];
    if (!top || !top.faceUp) continue;
    const sprite = scene.sprites.get(top.id);
    if (sprite) points.push({ x: sprite.x, y: sprite.y });
  }
  return points;
})()`;

async function tap(at) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: at.x, y: at.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
    await sleep(60);
  }
  await until(`!${SCENE}.drag && ${SCENE}.board.tweens.count === 0`, 'the board to rest', 8000);
}

// A few moves, played the way a player would play them - real presses at the
// coordinates the board says its cards are at, each one taken or ignored on
// the game's own terms. A fresh deal is the picture every solitaire README
// already has; the reason to look at this one is what the game looks like
// once it is under way.
// Calculation is played by dragging - every card nothing wants is put on a
// discard pile the player chooses, and a tap never does that - so a tapper
// would photograph a deal with one card turned. It plays through the session
// instead, putting each card up if it can and otherwise on the shortest pile,
// and the board is drawn from the result as if it had been played by hand.
const DISCARD_SOME = `(() => {
  const g = ${SCENE};
  for (let i = 0; i < 40; i++) {
    const s = g.session.state;
    // Anything that can go up from a discard pile, first.
    const up = g.table.autoFinishMove(s);
    if (up && up.from.kind === 'tableau') {
      g.session.play(up);
    } else if (s.waste.length) {
      const from = { kind: 'waste', index: 0 };
      const up = g.table.autoTarget(s, from, 1);
      const short = [0, 1, 2, 3].sort((a, b) => s.tableau[a].length - s.tableau[b].length)[0];
      g.session.play({ kind: 'play', from, to: up ?? { kind: 'tableau', index: short }, count: 1 });
    } else {
      g.session.play({ kind: 'draw' });
    }
  }
  g.renderBoard(false);
  g.publish();
  return true;
})()`;

// The squares games are played by pressing empty cells, which the tapper
// never does. Two-thirds of a grid, each card where it scores most, so the
// picture is a hand under way with some pairs in it.
const PLACE_SOME = `(() => {
  const g = ${SCENE}; const t = g.table;
  const cells = g.session.state.tableau.length;
  for (let i = 0; i < Math.round(cells * 0.64); i++) {
    const s = g.session.state;
    let best = -1, move;
    s.tableau.forEach((cell, at) => {
      const m = cell.length ? undefined : t.placeAt(s, { kind: 'tableau', index: at });
      if (!m) return;
      const v = t.view(t.apply(s, m).state).score;
      if (v > best) { best = v; move = m; }
    });
    g.session.play(move);
  }
  g.renderBoard(false);
  g.publish();
  return true;
})()`;

// Blackjack is played with its own buttons. A bet and a hit, so the picture
// is a hand being played: the dealer's hole card down, three cards up.
const BET_AND_HIT = `(() => {
  const g = ${SCENE};
  g.session.act('bet-20');
  if (g.session.state.phase === 'play') g.session.act('hit');
  if (g.session.state.phase !== 'play') g.session.act('bet-20');
  g.renderBoard(false);
  g.publish();
  return true;
})()`;

async function playAWhile(rounds, game) {
  if (game === 'calculation') {
    await evaluate(DISCARD_SOME);
    return;
  }
  if (game === 'blackjack') {
    await evaluate(BET_AND_HIT);
    return;
  }
  if (game === 'pokersquares' || game === 'cribbagesquares') {
    await evaluate(PLACE_SOME);
    return;
  }
  for (let round = 0; round < rounds; round++) {
    const faces = await evaluate(onPage(FACES));
    for (const at of faces ?? []) await tap(at);
    // And turn the deck, for the games that have one.
    const stock = await evaluate(
      `${SCENE}.table.slots('right').some((s) => s.ref.kind === 'stock')`,
    );
    if (stock) await tap(await evaluate(onPage(`${SCENE}.pileBase({ kind: 'stock', index: 0 })`)));
  }
}

await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR, mobile: true,
});

async function shoot(name) {
  const { result } = await send('Page.captureScreenshot', { format: 'webp', quality: 92 });
  writeFileSync(join(out, `${name}.webp`), Buffer.from(result.data, 'base64'));
  console.log(`  ${name}.webp`);
}

// The canvas alone, not the HUD around it - the felt and the cards are what
// tell two games apart, and cropping to them is what lets the same file work
// as a near-square menu tile and a wide setup-page banner: each context
// crops further with CSS `object-fit`, but neither can show board that
// wasn't in the source. `scale` below the device pixel ratio (already 2, for
// the full-size shots) is what keeps this a thumbnail rather than a second
// copy of the README picture.
async function shootThumb(name) {
  const canvas = await evaluate(`(() => {
    const box = document.querySelector('canvas').getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  })()`);
  const { result } = await send('Page.captureScreenshot', {
    format: 'webp',
    quality: 80,
    clip: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height, scale: 0.5 },
  });
  writeFileSync(join(thumbOut, `${name}.webp`), Buffer.from(result.data, 'base64'));
  console.log(`  game-thumbs/${name}.webp`);
}

// `name` is the picture to write; pass null to set a board up without
// photographing it, which is how the pause menu gets a hand behind it. Null
// rather than undefined, because passing undefined to a defaulted parameter
// is the same as passing nothing - it took the default and photographed the
// board twice. `thumb` is separate from `name` because the README shots
// (menu, pause, setup-klondike) go through here too and none of them are a
// game's in-app thumbnail.
async function board(game, rounds, name = game, thumb = false) {
  await send('Page.navigate', { url: `${host}/play/${game}` });
  if (!await until(`!!window.__game && !!${SCENE} && !!${SCENE}.session`, game)) return;
  // Headless Chrome has no GPU and runs this board at about a frame a second,
  // so the deal is a twenty-second animation unless the clocks are wound on.
  await evaluate(`(${SCENE}.timeScale = 20, true)`);
  await until(`${SCENE}.busy === false && ${SCENE}.board.tweens.count === 0`, `${game} deal`);
  // Long enough for the last frame of the deal to be on the canvas rather
  // than merely scheduled.
  await sleep(600);
  await playAWhile(rounds, game);
  // Long enough for the last frame to be on the canvas rather than merely
  // scheduled - headless Chrome draws this board about once a second.
  await sleep(1500);
  if (name && !thumbsOnly) await shoot(name);
  if (thumb) await shootThumb(game);
}

console.log(`shooting ${host} at ${WIDTH}x${HEIGHT} @${DPR}x`);

if (!thumbsOnly && wanted('menu')) {
  await send('Page.navigate', { url: `${host}/` });
  await until("!!document.querySelector('.menu h1')", 'the menu');
  await sleep(800);
  await shoot('menu');
}

// The pause menu, over a board with a hand on it - which is the only way it
// is ever seen.
if (!thumbsOnly && wanted('pause')) {
  await board('klondike', 4, null);
  await evaluate(
    "[...document.querySelectorAll('.hud__button')].find(b => b.textContent.trim() === 'Menu').click()",
  );
  await sleep(600);
  await shoot('pause');
}

if (!thumbsOnly && wanted('setup-klondike')) {
  await send('Page.navigate', { url: `${host}/setup/klondike` });
  await until("!!document.querySelector('.setup__summary')", 'the Klondike page');
  await sleep(800);
  await shoot('setup-klondike');
}

// Enough rounds to make each board look played rather than dealt, and not so
// many that a greedy tapper strips it bare. The numbers differ because the
// tapper is greedy rather than good: even one round of it parks a card in
// every one of FreeCell's four cells, which is a picture of a game going
// badly - so FreeCell is shown as dealt, which is its own best picture
// anyway. Fifty-two cards face up is the whole pitch for that game, and
// Seahaven is shown as dealt for both of those reasons at once.
//
// Pyramid gets two rounds and they are nearly all deck turns, because tapping
// does almost nothing in that game by design: a pair is two cards and has to
// be dragged. Its picture is a pyramid, which is what it should be.
for (const [game, rounds] of [
  ['klondike', 4], ['freecell', 0], ['yukon', 3], ['canfield', 3], ['spider', 3], ['spiderette', 3],
  ['scorpion', 3], ['seahaven', 0], ['calculation', 4], ['lucie', 3],
  ['tripeaks', 3], ['pyramid', 2], ['golf', 3], ['blackhole', 4], ['acesup', 3],
  ['pokersquares', 1], ['cribbagesquares', 1], ['blackjack', 1],
]) {
  if (!wanted(game)) continue;
  // Spider in two suits, black and red: one suit is a picture of nothing
  // but spades, and four is too busy at this size to read as a game.
  if (game === 'spider') {
    await send('Page.navigate', { url: `${host}/` });
    await evaluate(`localStorage.setItem('solitaire.spiderSuits', '2')`);
  }
  await board(game, rounds, game, true);
}

done(0);
