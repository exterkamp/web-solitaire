// One browser, one game, played end to end.
//
// The rules have unit tests and the board does not, because a board is a
// canvas: there is nothing in it to assert about except pixels. What this
// does instead is play the game through the real thing - a real Chrome, a
// real deal, real taps at real coordinates - and check the state behind it
// after each one. It catches the class of fault a unit test cannot see at
// all: a scene that throws on start, art that 404s, a tap that lands on
// nothing, a win that never reaches the page.
//
//   npx ng build
//   (cd dist/web-solitaire/browser && python3 -m http.server 4380) &
//   node tools/smoke.mjs --host=http://localhost:4380
//
// Exits non-zero on the first thing it doesn't like, and writes a screenshot
// of the board to /tmp/solitaire-smoke.png either way - which is the only
// part of this a person still has to look at.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const host = flag('host', 'http://localhost:4380');
const shot = flag('shot', '/tmp/solitaire-smoke.png');
// The screen's pixel ratio, which is not cosmetic here: the scene scales its
// root container by it, so every coordinate the board works in is multiplied
// by this number on the way to the canvas and divided by it on the way back.
// A hit area that is right at 1 and wrong at 2 is a board that works on a
// laptop and not on a phone, so it is worth being able to ask for both.
const dpr = flag('dpr', '1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const problems = [];
const check = (ok, what) => {
  if (!ok) problems.push(what);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
};

// A headless Chrome, driven over the debugging protocol. No dependency on a
// driver library: this is a few hundred lines of JSON over a socket, and a
// smoke test that needs its own install is a smoke test nobody runs.
class Browser {
  constructor(port) {
    this.port = port;
    this.pending = new Map();
    this.nextId = 1;
    this.logs = [];
    // Where in the log the network was cut, so the console check can tell a
    // real fault from the noise of having no network on purpose.
    this.offlineFrom = Infinity;
    this.process = spawn('google-chrome', [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      `--force-device-scale-factor=${dpr}`,
      '--window-size=480,900', `--remote-debugging-port=${port}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'solitaire-smoke-'))}`,
      'about:blank',
    ], { stdio: 'ignore' });
  }

  async attach() {
    let page;
    for (let i = 0; i < 40 && !page; i++) {
      try {
        const list = await (await fetch(`http://localhost:${this.port}/json/list`)).json();
        page = list.find((t) => t.type === 'page');
      } catch {
        await sleep(500);
      }
    }
    if (!page) throw new Error('Chrome never came up');
    this.socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve);
      this.socket.addEventListener('error', reject);
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        // An error comes back with no result at all, which is worth turning
        // into a rejection here rather than a null dereference elsewhere.
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      // Anything the page said for itself. The console is half the point of
      // running a real browser: a thrown error in a Phaser callback is
      // swallowed by the engine and shows up nowhere else.
      if (message.method === 'Runtime.consoleAPICalled') {
        this.logs.push({
          level: message.params.type,
          text: message.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
        });
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.logs.push({
          level: 'error',
          text: message.params.exceptionDetails.exception?.description ?? 'exception',
        });
      }
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async go(url) {
    await this.send('Page.navigate', { url });
  }

  // Everything the test knows about the page comes through here. Returns the
  // value as JSON, so the caller works with plain data rather than with
  // remote object handles.
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(() => { try { return JSON.stringify(${expression}); } catch (e) { return JSON.stringify({ __error: String(e) }); } })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const raw = result.result?.value;
    const parsed = raw === undefined ? undefined : JSON.parse(raw);
    if (parsed && parsed.__error) throw new Error(parsed.__error);
    return parsed;
  }

  // Waits until the board has stopped moving: nothing in hand, nothing in
  // flight.
  //
  // Both halves were learned the hard way on a machine with no GPU. Phaser
  // processes queued input in its game loop, so a release can sit unprocessed
  // for the best part of a second, and a press arriving while the board still
  // thinks a card is in hand is ignored - correctly, and fatally for a test
  // that sleeps 200ms and assumes the best.
  //
  // The tweens matter for a stranger reason. A card turns over by being
  // squashed to nothing and back out, as two tweens end to end, so for one
  // frame in the middle it is exactly zero wide - and a zero-wide card cannot
  // be hit, because the hit test divides by that scale. One frame is nothing
  // at sixty of them a second and a full second here, which made every
  // gesture aimed at a freshly turned card a coin toss.
  async settle(scene) {
    await this.until(
      `!${scene}.drag && ${scene}.tweens.getTweens().length === 0`,
      'the board to come to rest',
      30000,
    );
  }

  async until(expression, what, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return true;
      await sleep(150);
    }
    check(false, `timed out waiting for ${what}`);
    return false;
  }

  // A real press and release at a point on the page, which is the only way to
  // test that a card is where the board thinks it is: the scene's own hit
  // testing is between these two events and nothing else exercises it.
  async tap(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
      });
      await sleep(40);
    }
  }

  // A press, a few moves and a release - a gesture rather than a click. The
  // moves matter: the board only treats a press as a drag once it has
  // travelled, so a press-and-release at a distance is read as a tap on the
  // card it started on and tests the wrong path entirely.
  async drag(from, to, scene) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1, buttons: 1,
    });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        button: 'left',
        buttons: 1,
      });
      await sleep(25);
    }
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1, buttons: 0,
    });
    await this.settle(scene);
    await sleep(200);
  }

  // Presses, asks the board what it picked up, and lets go without moving.
  // The answer is the whole of what a hit area is for.
  async grab(point, scene) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1, buttons: 1,
    });
    await sleep(60);
    const held = await this.evaluate(
      `${scene}.drag ? ${scene}.drag.sprites[0].card.id + ' x' + ${scene}.drag.count : 'nothing'`,
    );
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1, buttons: 0,
    });
    await this.settle(scene);
    return held;
  }

  // A throw, stamped rather than raced.
  //
  // Each event carries an explicit timestamp `gap` milliseconds after the
  // last, because the board decides what a flick is from the times on the
  // events - and on a machine with no GPU, a round trip through the
  // debugging protocol into a renderer drawing one frame a second takes the
  // best part of a second per event. Dispatching as fast as this script can
  // manage produced a gesture the board correctly judged to be very slow.
  //
  // So the speed here is stated rather than achieved, which is the honest
  // thing for a test to do with a quantity the test cannot produce: what is
  // being checked is that the board reads a gesture of a given speed the way
  // it should, not that Chrome can be made to move a mouse quickly.
  async flick(from, to, scene, gap = 12) {
    const start = Date.now() / 1000;
    const at = (i) => start + (i * gap) / 1000;
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1, buttons: 1,
      timestamp: at(0),
    });
    // What the press picked up, before the throw moves it anywhere. Half the
    // ways a flick can fail are really the press failing, and the two look
    // identical from the state afterwards.
    const held = await this.until(`!!${scene}.drag`, 'the flicked card to be picked up', 15000)
      ? await this.evaluate(`${scene}.drag.sprites[0].card.id + ' x' + ${scene}.drag.count`)
      : 'nothing';
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        button: 'left',
        buttons: 1,
        timestamp: at(i),
      });
    }
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1, buttons: 0,
      timestamp: at(steps + 1),
    });
    await this.settle(scene);
    await sleep(300);
    return held;
  }

  // Pulls the plug. Everything after this is served by the service worker or
  // not at all, which is the whole of what "installed" means.
  async goOffline() {
    await this.send('Network.enable');
    await this.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    this.offlineFrom = this.logs.length;
  }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }

  close() {
    this.socket?.close();
    this.process.kill();
  }
}

// The scene, reached the way anything outside the page reaches it. Its fields
// are private in TypeScript and perfectly ordinary at runtime, which is what
// makes this possible at all - and is a deliberate liberty: a test tool is
// allowed to know more than a caller.
const SCENE = `window.__game.scene.getScene('solitaire')`;
const STATE = `${SCENE}.session.state`;

// A point on the board, in page coordinates.
//
// Three transforms deep, and every one of them has to be right for a tap to
// land: board units to canvas pixels (the scene scales its root container by
// the device pixel ratio), canvas pixels to CSS pixels (Phaser's Scale.FIT
// fits the canvas into whatever box the page gave it), and CSS pixels to the
// page (where that box is). Getting this wrong is a test that misses the
// card and reports that the board ignored it.
const onPage = (expression) => `(() => {
  const at = ${expression};
  const canvas = document.querySelector('canvas');
  const box = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const scale = box.width / canvas.width;
  return { x: box.left + at.x * ratio * scale, y: box.top + at.y * ratio * scale };
})()`;

// A position dealt by hand.
//
// `body` is JavaScript run in the page with `state` in scope; it rearranges
// the cards, and this takes care of the rest.
//
// The killAll matters and is not tidiness. A press that picks a card up and
// finds nowhere to put it tweens the card back where it came from, and that
// tween outlives the press by a couple of hundred milliseconds. Rearranging
// the state underneath it means the tween then finishes by dragging the
// sprite back to where the card used to be - so the next press lands on an
// empty patch of felt and the board looks broken when it is only out of date.
// A player cannot produce this, because every snap-back returns a card to the
// place it still belongs; only a test that moves cards without telling the
// board can.
const rig = (body) => `(() => {
  ${SCENE}.tweens.killAll();
  const state = ${STATE};
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const suits = ['spades','hearts','diamonds','clubs'];
  const all = [...state.stock, ...state.waste, ...state.foundations.flat(), ...state.tableau.flat()];
  const pick = (rank, suit) => all.find((c) => c.rank === rank && c.suit === suit);
  const answer = (() => { ${body} })();
  ${SCENE}.renderBoard(false);
  ${SCENE}.publish();
  return answer ?? true;
})()`;

async function main() {
  console.log(`  --   device pixel ratio ${dpr}`);
  // A port nobody else is on. A fixed one looked fine and was not: a Chrome
  // left over from an earlier run still answers on it, and the test then
  // drives *that* browser - with the last run's localStorage in it, which is
  // how the record book came to be counting three wins in a one-win test.
  const browser = new Browser(9300 + Math.floor(Math.random() * 400));
  await browser.attach();

  await browser.go(host);
  if (!await browser.until(`!!document.querySelector('.menu h1')`, 'the menu')) return finish(browser);
  check(
    await browser.evaluate(`document.querySelector('.menu h1').textContent.trim()`) === 'Solitaire',
    'the menu names the game',
  );

  // Deal, the way a player does: by pressing the button.
  await browser.evaluate(`(document.querySelector('a[href="/play"]').click(), true)`);
  if (!await browser.until(`!!window.__game && !!${SCENE} && !!${SCENE}.session`, 'the board')) {
    return finish(browser);
  }
  // The board is run at twenty times speed for the rest of this.
  //
  // Not a convenience. Headless Chrome has no GPU, so Phaser falls back to
  // software rendering and this board draws about one frame a second - a
  // figure that is nothing to do with this game, since Nertz's board measures
  // the same on the same machine. Phaser's clock advances with the frames, so
  // at that rate a deal takes half a minute of wall time and a self-finishing
  // game takes several minutes.
  //
  // Scaling the two clocks makes every animation land in a handful of frames
  // without touching a single duration in the game itself. What is being
  // tested is what the board does, not how long it takes to look good doing
  // it.
  await browser.evaluate(`(${SCENE}.tweens.timeScale = 20, ${SCENE}.time.timeScale = 20, true)`);

  // The deal has to land before anything is asked about positions, and it is
  // waited on rather than slept through - a frame rate this variable makes a
  // fixed sleep a coin toss.
  if (!await browser.until(`${SCENE}.busy === false`, 'the deal to land', 60000)) {
    return finish(browser);
  }

  const dealt = await browser.evaluate(`({
    tableau: ${STATE}.tableau.map((p) => p.length),
    faceUp: ${STATE}.tableau.map((p) => p.filter((c) => c.faceUp).length),
    stock: ${STATE}.stock.length,
    sprites: ${SCENE}.sprites.size,
  })`);
  check(JSON.stringify(dealt.tableau) === '[1,2,3,4,5,6,7]', 'seven piles, one to seven cards');
  check(JSON.stringify(dealt.faceUp) === '[1,1,1,1,1,1,1]', 'one card turned up in each');
  check(dealt.stock === 24, 'twenty-four cards left in the stock');
  check(dealt.sprites === 52, 'fifty-two cards drawn');

  // Every piece of art the deck asked for arrived. A missing court is a card
  // with a blank face, which nothing else here would notice.
  const missing = await browser.evaluate(
    `Object.keys(${SCENE}.textures.list).filter((k) => k.startsWith('face-') || k.startsWith('suit-')).length`,
  );
  check(missing >= 16, `the deck's art loaded (${missing} textures)`);

  // A real tap on the stock, at the coordinates the board says it is at.
  const stock = await browser.evaluate(onPage(`${SCENE}.pileBase({ kind: 'stock', index: 0 })`));
  const before = await browser.evaluate(`${STATE}.waste.length`);
  await browser.tap(stock.x, stock.y);
  await browser.settle(SCENE);
  const after = await browser.evaluate(`${STATE}.waste.length`);
  check(after > before, `tapping the stock turns a card (${before} -> ${after})`);

  // And the page noticed. The board tells the page through a callback out of
  // a Phaser event, which is about as far outside Angular as code in this app
  // gets - so this is the check that the two halves of the screen are still
  // talking to each other.
  check(
    await browser.evaluate(`document.querySelectorAll('.hud__value')[2].textContent.trim()`) === '1',
    'the move counter follows the board',
  );

  // What a press picks up, all over a card and all down a pile.
  //
  // This is the check that a hit area is where its card is, and it is here
  // because it once was not: Phaser adds a container's display origin to the
  // local point before testing it, so a hit box written as a rectangle around
  // the sprite's middle sits half a card up and half a card left of the card
  // it belongs to. The board still worked well enough for a test that only
  // ever pressed the middle of a lone card - which is exactly what the drag
  // below was doing - and was unplayable for anybody actually holding it.
  await browser.evaluate(rig(`
    const run = [pick('K', 'spades'), pick('Q', 'hearts'), pick('J', 'spades')];
    for (const card of run) card.faceUp = true;
    state.foundations = [[], [], [], []];
    state.tableau = [run, [], [], [], [], [], []];
    state.waste = [];
    state.stock = all.filter((c) => !run.includes(c)).map((c) => ((c.faceUp = false), c));
  `));
  await browser.settle(SCENE);

  const runAt = await browser.evaluate(`${STATE}.tableau[0].map((c) => {
    const sprite = ${SCENE}.sprites.get(c.id);
    return { id: c.id, x: sprite.x, y: sprite.y };
  })`);

  // The top card of the pile is the one that is fully visible, so a press
  // anywhere on it - all four quadrants, not just the middle - is a press on
  // that card and nothing else.
  const top = runAt[2];
  for (const [label, dx, dy] of [
    ['middle', 0, 0],
    ['upper left', -22, -32],
    ['lower right', 22, 32],
    ['lower left', -22, 32],
  ]) {
    const held = await browser.grab(
      await browser.evaluate(onPage(`({ x: ${top.x + dx}, y: ${top.y + dy} })`)),
      SCENE,
    );
    check(held === `${top.id} x1`, `a press on the ${label} of a card picks up that card (${held})`);
  }

  // And a press on the sliver of a buried card picks up that card and
  // everything on top of it - which is how a run gets moved at all.
  for (const [label, card, expect] of [
    ['the king', runAt[0], 3],
    ['the queen', runAt[1], 2],
  ]) {
    const held = await browser.grab(
      await browser.evaluate(onPage(`({ x: ${card.x}, y: ${card.y - 30} })`)),
      SCENE,
    );
    check(held === `${card.id} x${expect}`, `a press on ${label}'s index lifts the run (${held})`);
  }

  // A card dragged out of the waste onto the pile that will take it.
  //
  // Rigged rather than waited for: a dealt game may not offer a drag for
  // several draws, and a test that plays until one appears is a test that
  // sometimes doesn't. What is being checked is the gesture, not the deal -
  // the pick-up, the pointer following, the drop landing on the right pile
  // and the rules agreeing.
  const dragSetup = await browser.evaluate(rig(`
    const king = pick('K', 'spades');
    const queen = pick('Q', 'hearts');
    king.faceUp = true;
    queen.faceUp = true;
    state.foundations = [[], [], [], []];
    state.tableau = [[king], [], [], [], [], [], []];
    state.waste = [queen];
    state.stock = all.filter((c) => c !== king && c !== queen).map((c) => ((c.faceUp = false), c));
    return { king: king.id, queen: queen.id };
  `));
  await browser.settle(SCENE);
  check(!!dragSetup.queen, 'a position with one obvious drag in it');

  const wasteAt = await browser.evaluate(onPage(`${SCENE}.pileBase({ kind: 'waste', index: 0 })`));
  const kingAt = await browser.evaluate(onPage(`${SCENE}.pileBase({ kind: 'tableau', index: 0 })`));
  await browser.drag(wasteAt, kingAt, SCENE);
  const landed = await browser.evaluate(`${STATE}.tableau[0].map((c) => c.id).join(',')`);
  check(landed === `${dragSetup.king},${dragSetup.queen}`, `the dragged card lands on the king (${landed})`);
  check(await browser.evaluate(`${STATE}.waste.length`) === 0, 'and leaves the waste behind it');

  // A card thrown at the foundations from halfway down the board, and let go
  // nowhere near them.
  //
  // Releasing short of the foundation row is the whole point of the check: if
  // the ace still gets home, it got there because the gesture said so rather
  // than because the card was dropped on the right pile.
  const flickSetup = await browser.evaluate(rig(`
    const ace = pick('A', 'spades');
    const five = pick('5', 'hearts');
    ace.faceUp = true;
    five.faceUp = true;
    state.foundations = [[], [], [], []];
    state.tableau = [[five], [], [], [ace], [], [], []];
    state.waste = [];
    state.stock = all.filter((c) => c !== ace && c !== five).map((c) => ((c.faceUp = false), c));
    return { ace: ace.id };
  `));
  await browser.settle(SCENE);

  const aceAt = await browser.evaluate(onPage(`${SCENE}.pileBase({ kind: 'tableau', index: 3 })`));
  const thrown = await browser.flick(aceAt, { x: aceAt.x, y: aceAt.y - 150 }, SCENE);
  const home = await browser.evaluate(`${STATE}.foundations[0].map((c) => c.id).join(',')`);
  check(
    home === flickSetup.ace,
    `a flick sends the ace home from mid-board (held ${thrown}, foundation has ${home || 'nothing'})`,
  );

  // The same throw with nowhere to land. A flick that the foundations will
  // not take has to behave like any other release - which here means the
  // card goes back where it came from, not somewhere near the top of the
  // screen.
  const stayed = await browser.evaluate(rig(`
    const five = pick('5', 'hearts');
    five.faceUp = true;
    state.foundations = [[], [], [], []];
    state.tableau = [[five], [], [], [], [], [], []];
    // Every card goes back somewhere. An earlier rig left the ace on a
    // foundation that this one wiped, so the deck quietly lost a card - and
    // the position the win check builds later came out with a king already
    // home and a duplicate of it on the table, which cannot be finished and
    // took a minute to say so.
    state.waste = [];
    state.stock = all.filter((c) => c !== five).map((c) => ((c.faceUp = false), c));
    return { five: five.id };
  `));
  await browser.settle(SCENE);
  const fiveAt = await browser.evaluate(onPage(`${SCENE}.pileBase({ kind: 'tableau', index: 0 })`));
  await browser.flick(fiveAt, { x: fiveAt.x, y: fiveAt.y - 150 }, SCENE);
  check(
    await browser.evaluate(`${STATE}.tableau[0].map((c) => c.id).join(',')`) === stayed.five,
    'a flick with no home leaves the card where it was',
  );
  check(
    await browser.evaluate(`Math.round(${SCENE}.sprites.get('${stayed.five}').y)`)
      === await browser.evaluate(`Math.round(${SCENE}.pileBase({ kind: 'tableau', index: 0 }).y)`),
    'and puts the card back on its pile rather than leaving it in the air',
  );

  // The empty stock, pressed.
  //
  // Turning the waste back into a deck is the one move on this board made on
  // a pile with nothing in it, and for a while it could not be made at all:
  // presses were handled by card sprites, an empty pile has none, and the
  // slot with the recycle arrow printed on it was doing nothing but
  // promising.
  await browser.evaluate(rig(`
    const waste = all.slice(0, 5).map((c) => ((c.faceUp = true), c));
    state.stock = [];
    state.waste = waste;
    state.foundations = [[], [], [], []];
    state.tableau = [all.slice(5).map((c) => ((c.faceUp = false), c)), [], [], [], [], [], []];
  `));
  await browser.settle(SCENE);
  const stockAt = await browser.evaluate(onPage(`${SCENE}.pileBase({ kind: 'stock', index: 0 })`));
  await browser.tap(stockAt.x, stockAt.y);
  await browser.settle(SCENE);
  const recycled = await browser.evaluate(`({
    stock: ${STATE}.stock.length,
    waste: ${STATE}.waste.length,
    passes: ${STATE}.passes,
  })`);
  check(
    recycled.stock === 5 && recycled.waste === 0 && recycled.passes === 1,
    `pressing an empty stock turns the waste back over (${JSON.stringify(recycled)})`,
  );

  // Draw three, and what you can see of it.
  //
  // The rule a waste fan has to satisfy is not "the cards are visibly
  // separate" - a sideways fan managed that and still told you nothing,
  // because a card carries its index in its top-left corner only and a fan to
  // the left shows you right-hand edges. So this checks the thing that
  // matters: each covered card's top edge is clear of the card in front of
  // it by enough to read an index off, and the playable card is still in the
  // slot beside the stock.
  await browser.evaluate(`(${SCENE}.newGame(3), true)`);
  await browser.settle(SCENE);
  const stockNow = await browser.evaluate(onPage(`${SCENE}.pileBase({ kind: 'stock', index: 0 })`));
  await browser.tap(stockNow.x, stockNow.y);
  await browser.settle(SCENE);
  const fan = await browser.evaluate(`(() => {
    const at = ${STATE}.waste.map((c) => {
      const sprite = ${SCENE}.sprites.get(c.id);
      return { x: Math.round(sprite.x), y: Math.round(sprite.y) };
    });
    const slot = ${SCENE}.pileBase({ kind: 'waste', index: 0 });
    return { at, slot: { x: Math.round(slot.x), y: Math.round(slot.y) } };
  })()`);
  check(fan.at.length === 3, `a draw of three turns three (${fan.at.length})`);
  check(
    fan.at.every((card) => card.x === fan.slot.x),
    'the fan runs straight down its column, not across into the next one',
  );
  // Down the screen, so each step is a card further along the waste sitting
  // lower than the one before it. 26 is the index's ink plus its margin -
  // less than that and the rank is clipped.
  const steps = fan.at.slice(1).map((card, i) => card.y - fan.at[i].y);
  check(
    steps.every((step) => step >= 26),
    `each card behind shows enough of itself to read (${steps.join(', ')} units)`,
  );
  check(
    fan.at[fan.at.length - 1].y === fan.slot.y,
    'and the card you can play is the one in the slot',
  );

  // Back to drawing one, which is the mode the rest of this plays in - and a
  // second deal, which is worth having happen at least once.
  await browser.evaluate(`(${SCENE}.newGame(1), true)`);
  await browser.settle(SCENE);

  await browser.screenshot(shot);
  console.log(`  --   board written to ${shot}`);

  // A game rigged one card short of won, then finished and watched. This is
  // the end of the game - the finish, the cascade, the win panel, the record
  // book - and none of it is reachable in a smoke test any other way.
  await browser.evaluate(rig(`
    for (const card of all) card.faceUp = true;
    state.stock = [];
    state.waste = [];
    state.foundations = suits.map((suit) =>
      all.filter((c) => c.suit === suit)
        .sort((a, b) => ranks.indexOf(a.rank) - ranks.indexOf(b.rank))
        .slice(0, 12));
    state.tableau = suits
      .map((suit) => all.filter((c) => c.suit === suit && c.rank === 'K'))
      .concat([[], [], []]);
  `));
  await sleep(300);
  check(await browser.evaluate(`${SCENE}.session.canFinish`), 'the finish is offered once nothing is hidden');

  const winsBefore = await browser.evaluate(
    `(JSON.parse(localStorage.getItem('solitaire.stats.v1') || '{}').byDraw?.['1']?.won) ?? 0`,
  );

  if (!await browser.until(`!!document.querySelector('.action--go')`, 'the finish button')) {
    return finish(browser);
  }
  await browser.evaluate(`(document.querySelector('.action--go').click(), true)`);
  if (!await browser.until(`${SCENE}.session.won`, 'the last card going home', 60000)) {
    return finish(browser);
  }
  check(true, 'the game finishes itself');

  // Generous, because this one waits on the board's own clock: the win panel
  // is held back 1.4 seconds so the cascade gets a moment to itself, and a
  // second of board time is a long time on a machine drawing one frame of
  // fifty-two falling cards a second.
  if (!await browser.until(`!!document.querySelector('.win')`, 'the win panel', 90000)) {
    return finish(browser);
  }
  const won = await browser.evaluate(`({
    total: document.querySelector('.win__line--total dd').textContent.trim(),
    stats: JSON.parse(localStorage.getItem('solitaire.stats.v1') || 'null'),
  })`);
  check(!!won.total, `the win panel says what it was worth (${won.total})`);
  const mode = won.stats?.byDraw?.['1'];
  check(
    mode?.won === winsBefore + 1 && mode?.played === mode?.won,
    `the record book counts the win (${JSON.stringify(mode)})`,
  );

  // --- and now with the network off ------------------------------------
  //
  // The point of installing this game is that it works on a train. There is
  // no server to lose touch with - the whole thing is files and
  // localStorage - so the only question is whether the browser still has the
  // files, and the only way to answer it is to take the network away and see.
  const controlled = await browser.until(
    `!!(navigator.serviceWorker && navigator.serviceWorker.controller)`,
    'the service worker to take over the page',
    60000,
  );
  check(controlled, 'a service worker is running the page');
  if (!controlled) return finish(browser);

  // Installed is not the same as ready: the worker fetches the app and the
  // default deck in the background, and going offline before it has finished
  // would be testing the wrong thing. A court card from that deck is the last
  // thing in, so it is the thing to wait for.
  const stocked = await browser.until(
    `caches.keys()
      .then((names) => Promise.all(names.map((n) => caches.open(n).then((c) => c.match('/cards/art/press/king-spades.webp')))))
      .then((hits) => hits.some(Boolean))`,
    'the deck to be cached',
    90000,
  );
  check(stocked, 'the deck it deals by default is kept for later');

  await browser.goOffline();
  // A fresh navigation to the menu, not a reload: the browser is sitting on
  // /play by now, and reloading that would have proved a smaller thing. This
  // asks the service worker for a route it has never served as a document -
  // there is no /play or / file in the build, only index.html - so answering
  // it at all means the offline app can be entered by address, not just
  // resumed.
  await browser.go(`${host}/`);
  if (!await browser.until(`!!document.querySelector('.menu h1')`, 'the menu, offline', 45000)) {
    return finish(browser);
  }
  check(true, 'the menu opens with no network');

  await browser.evaluate(`(document.querySelector('a[href="/play"]').click(), true)`);
  if (!await browser.until(`!!window.__game && !!${SCENE} && !!${SCENE}.session`, 'the board, offline', 60000)) {
    return finish(browser);
  }
  await browser.evaluate(`(${SCENE}.tweens.timeScale = 20, ${SCENE}.time.timeScale = 20, true)`);
  await browser.until(`${SCENE}.busy === false`, 'the offline deal to land', 60000);
  const offlineDeal = await browser.evaluate(`({
    sprites: ${SCENE}.sprites.size,
    tableau: ${STATE}.tableau.map((p) => p.length),
    courts: Object.keys(${SCENE}.textures.list).filter((k) => k.startsWith('face-')).length,
  })`);
  check(offlineDeal.sprites === 52, `a whole deck deals offline (${offlineDeal.sprites})`);
  check(
    JSON.stringify(offlineDeal.tableau) === '[1,2,3,4,5,6,7]',
    'into the seven piles it should',
  );
  // Twelve court cards and a back, from the cache rather than from anywhere.
  check(offlineDeal.courts === 12, `with its court cards (${offlineDeal.courts} of 12)`);

  return finish(browser);
}

function finish(browser) {
  // A browser with no network logs a failure for every request that does not
  // come out of a cache, and the offline section above arranges for exactly
  // that - the worker's own check for a new version is one. Those are
  // expected; anything else logged after the plug was pulled is not, and
  // still fails this.
  const expected = /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|Failed to fetch|NetworkError/i;
  const noisy = browser.logs.filter(
    (l, i) =>
      (l.level === 'error' || l.level === 'warning') &&
      !(i >= browser.offlineFrom && expected.test(l.text)),
  );
  for (const log of noisy) console.log(`  --   console ${log.level}: ${log.text}`);
  check(!noisy.some((l) => l.level === 'error'), 'nothing went wrong in the console');

  browser.close();
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exit(1);
  }
  console.log('\nall good');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
