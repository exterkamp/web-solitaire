// The pictures in the README, taken by playing the game.
//
// A screenshot in a repository goes stale the moment somebody moves a button,
// and the only defence is to make retaking them a command rather than an
// afternoon. This drives the same headless Chrome the smoke test does, at a
// phone's size and pixel ratio, and writes webp because these are photographs
// of a canvas and a png of one is four times the size for no visible gain.
//
//   node tools/screenshots.mjs [--host=http://localhost:8083]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const host = process.argv.find((a) => a.startsWith('--host='))?.slice(7) ?? 'http://localhost:8083';
// `--only=freecell` retakes one picture. Handy, because the thing that makes a
// shot worth retaking is usually one board looking wrong rather than six.
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const wanted = (name) => !only || only.split(',').includes(name);
const out = new URL('../docs/screenshots/', import.meta.url).pathname;
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

const SCENE = `window.__game.scene.getScene('solitaire')`;

// A point on the board, in page coordinates: board units to canvas pixels (the
// scene scales its root by the device pixel ratio), canvas pixels to CSS
// pixels (Phaser fits the canvas into the box the page gave it), and then into
// the page. Same three transforms the smoke test makes, for the same reason -
// a tap that misses the card is a screenshot of nothing happening.
const onPage = (expression) => `(() => {
  const canvas = document.querySelector('canvas');
  const box = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const scale = box.width / canvas.width;
  const place = (at) => ({ x: box.left + at.x * ratio * scale, y: box.top + at.y * ratio * scale });
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
  await until(`!${SCENE}.drag && ${SCENE}.tweens.getTweens().length === 0`, 'the board to rest', 8000);
}

// A few moves, played the way a player would play them - real presses at the
// coordinates the board says its cards are at, each one taken or ignored on
// the game's own terms. A fresh deal is the picture every solitaire README
// already has; the reason to look at this one is what the game looks like
// once it is under way.
async function playAWhile(rounds) {
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

async function board(game, rounds, name = game) {
  await send('Page.navigate', { url: `${host}/play/${game}` });
  if (!await until(`!!window.__game && !!${SCENE} && !!${SCENE}.session`, game)) return;
  // Headless Chrome has no GPU and runs this board at about a frame a second,
  // so the deal is a twenty-second animation unless the clocks are wound on.
  await evaluate(`(${SCENE}.tweens.timeScale = 20, ${SCENE}.time.timeScale = 20, true)`);
  await until(`${SCENE}.busy === false && ${SCENE}.tweens.getTweens().length === 0`, `${game} deal`);
  // Long enough for the last frame of the deal to be on the canvas rather
  // than merely scheduled.
  await sleep(600);
  await playAWhile(rounds);
  // Long enough for the last frame to be on the canvas rather than merely
  // scheduled - headless Chrome draws this board about once a second.
  await sleep(1500);
  await shoot(name);
}

console.log(`shooting ${host} at ${WIDTH}x${HEIGHT} @${DPR}x`);

if (wanted('menu')) {
  await send('Page.navigate', { url: `${host}/` });
  await until("!!document.querySelector('.menu h1')", 'the menu');
  await sleep(800);
  await shoot('menu');
}

if (wanted('setup-klondike')) {
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
// anyway. Fifty-two cards face up is the whole pitch for that game.
//
// Pyramid gets two rounds and they are nearly all deck turns, because tapping
// does almost nothing in that game by design: a pair is two cards and has to
// be dragged. Its picture is a pyramid, which is what it should be.
for (const [game, rounds] of [
  ['klondike', 4], ['freecell', 0], ['yukon', 3], ['spiderette', 3], ['scorpion', 3],
  ['tripeaks', 3], ['pyramid', 2], ['golf', 3], ['acesup', 3],
]) {
  if (wanted(game)) await board(game, rounds);
}

done(0);
