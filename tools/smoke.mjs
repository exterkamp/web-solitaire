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
    this.process = spawn('google-chrome', [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
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
  async drag(from, to) {
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
    await sleep(200);
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

async function main() {
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
  await sleep(400);
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

  // A card dragged out of the waste onto the pile that will take it.
  //
  // Rigged rather than waited for: a dealt game may not offer a drag for
  // several draws, and a test that plays until one appears is a test that
  // sometimes doesn't. What is being checked is the gesture, not the deal -
  // the pick-up, the pointer following, the drop landing on the right pile
  // and the rules agreeing.
  const dragSetup = await browser.evaluate(`(() => {
    const state = ${STATE};
    const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const all = [...state.stock, ...state.waste, ...state.foundations.flat(), ...state.tableau.flat()];
    const king = all.find((c) => c.rank === 'K' && c.suit === 'spades');
    const queen = all.find((c) => c.rank === 'Q' && c.suit === 'hearts');
    const rest = all.filter((c) => c !== king && c !== queen);
    king.faceUp = true;
    queen.faceUp = true;
    state.foundations = [[], [], [], []];
    state.tableau = [[king], [], [], [], [], [], []];
    state.waste = [queen];
    state.stock = rest.map((c) => ({ ...c, faceUp: false }));
    ${SCENE}.renderBoard(false);
    ${SCENE}.publish();
    return { king: king.id, queen: queen.id };
  })()`);
  check(!!dragSetup.queen, 'a position with one obvious drag in it');

  const wasteAt = await browser.evaluate(onPage(`${SCENE}.pileBase({ kind: 'waste', index: 0 })`));
  const kingAt = await browser.evaluate(onPage(`${SCENE}.pileBase({ kind: 'tableau', index: 0 })`));
  await browser.drag(wasteAt, kingAt);
  const landed = await browser.evaluate(`${STATE}.tableau[0].map((c) => c.id).join(',')`);
  check(landed === `${dragSetup.king},${dragSetup.queen}`, `the dragged card lands on the king (${landed})`);
  check(await browser.evaluate(`${STATE}.waste.length`) === 0, 'and leaves the waste behind it');

  await browser.screenshot(shot);
  console.log(`  --   board written to ${shot}`);

  // A game rigged one card short of won, then finished and watched. This is
  // the end of the game - the finish, the cascade, the win panel, the record
  // book - and none of it is reachable in a smoke test any other way.
  await browser.evaluate(`(() => {
    const state = ${STATE};
    const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const suits = ['spades','hearts','diamonds','clubs'];
    const all = [...state.stock, ...state.waste, ...state.foundations.flat(), ...state.tableau.flat()];
    for (const card of all) card.faceUp = true;
    state.stock = [];
    state.waste = [];
    state.foundations = suits.map((suit) =>
      all.filter((c) => c.suit === suit).sort((a, b) => ranks.indexOf(a.rank) - ranks.indexOf(b.rank)).slice(0, 12));
    state.tableau = suits.map((suit) => all.filter((c) => c.suit === suit && c.rank === 'K'))
      .concat([[], [], []]);
    ${SCENE}.renderBoard(false);
    ${SCENE}.publish();
    return true;
  })()`);
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

  if (!await browser.until(`!!document.querySelector('.win')`, 'the win panel', 30000)) {
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

  return finish(browser);
}

function finish(browser) {
  const noisy = browser.logs.filter((l) => l.level === 'error' || l.level === 'warning');
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
