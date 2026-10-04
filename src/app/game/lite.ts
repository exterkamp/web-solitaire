// Lite mode: draw the board at 1x, with unsupersampled text.
//
// The board is rasterized at devicePixelRatio times its logical size and the
// text on it at twice that again, which is what makes it sharp on a modern
// phone and what an old one cannot hold. A page that uses more memory than iOS
// will give it is killed and reloaded by the browser, and what it reloads is
// the same page - a loop with no error to read. Lite mode costs roughly a
// fifth to a ninth of the pixels.
//
// The player's choice is one of three, kept in localStorage:
//   auto   (nothing stored)  lite if the device looks like it needs it, or if
//                            a board has already been lost on this one
//   lite   ('1')             always
//   full   ('0')             never, whatever the device looks like
//
// ?lite=1 and ?lite=0 set the last two from the address bar, which is how a
// link can get a phone out of a loop it cannot reach Settings from.
//
// "A board has already been lost" is a guess: a board that started and was not
// seen running for a few seconds is taken to have been killed, and the next
// load is lite. Closing the tab during a load looks the same, and the cost of
// being wrong is a softer board until the player picks Full.
//
// The cards' own index text is drawn by phaser-card-engine at a fixed 2x
// oversample that lite mode cannot reach from here; at a pixel ratio of 1 it is
// a handful of small textures.

import { TEXT_OVERSAMPLE } from './fonts';

export type Quality = 'auto' | 'lite' | 'full';

const MODE_KEY = 'solitaire.lite';
const BOOT_KEY = 'solitaire.boot';
const LOST_KEY = 'solitaire.liteLost';
// How long a board has to survive before it is trusted, and how long ago a
// start can be and still count as a loss rather than yesterday's closed tab.
const SURVIVE_MS = 4000;
const STALE_MS = 2 * 60 * 1000;

let lite = false;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the choice just doesn't persist then.
  }
}

/**
 * What the device tells us about itself. Every field is optional because none
 * of them is reliable everywhere: Safari does not expose deviceMemory at all.
 */
export interface DeviceHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  devicePixelRatio?: number;
  userAgent?: string;
}

/**
 * Would this device be better off in lite mode?
 *
 * There is no way to ask an iPhone how much memory it has, so this is a
 * proxy, and it errs toward "soft but working". Any one of three is enough:
 *   - deviceMemory of 2GB or less, where the browser says (Chrome on Android)
 *   - an iPhone, iPad or iPod on iOS older than 16: anything stuck on 15 or
 *     below is a 2GB-or-less device, and phones with more were all given 16
 *   - two or fewer cores on a screen of 2x or more, which describes the same
 *     older, small phones where neither of the above is available
 */
export function looksLowEnd(hints: DeviceHints): boolean {
  if (hints.deviceMemory !== undefined && hints.deviceMemory <= 2) return true;

  const ios = /\b(iPhone|iPad|iPod)\b.*?\bOS (\d+)_/.exec(hints.userAgent ?? '');
  if (ios && Number(ios[2]) < 16) return true;

  return (
    hints.hardwareConcurrency !== undefined &&
    hints.hardwareConcurrency <= 2 &&
    (hints.devicePixelRatio ?? 1) >= 2
  );
}

function deviceHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: nav.userAgent,
  };
}

export function getQuality(): Quality {
  const stored = read(MODE_KEY);
  return stored === '1' ? 'lite' : stored === '0' ? 'full' : 'auto';
}

export function setQuality(quality: Quality): void {
  write(MODE_KEY, quality === 'lite' ? '1' : quality === 'full' ? '0' : null);
  // Choosing is the way out of a loss verdict: whatever was decided for the
  // player, they have now said what they want.
  write(LOST_KEY, null);
  apply();
}

function apply(hints: DeviceHints = deviceHints()): void {
  const quality = getQuality();
  lite =
    quality === 'lite' ||
    (quality === 'auto' && (read(LOST_KEY) === '1' || looksLowEnd(hints)));
}

/** Called once, before the app is built. */
export function initLite(
  search: string = window.location.search,
  hints: DeviceHints = deviceHints(),
): void {
  const asked = new URLSearchParams(search).get('lite');
  if (asked === '1') write(MODE_KEY, '1');
  if (asked === '0') write(MODE_KEY, '0');
  if (asked === '1' || asked === '0') write(LOST_KEY, null);

  const started = Number(read(BOOT_KEY));
  if (started && Date.now() - started < STALE_MS && getQuality() === 'auto') {
    write(LOST_KEY, '1');
  }
  write(BOOT_KEY, null);

  apply(hints);
}

/** Test seam: set the state directly, without touching storage. */
export function setLite(on: boolean): void {
  lite = on;
}

export function isLite(): boolean {
  return lite;
}

/** What the canvas is rasterized at, per logical pixel. The one place that asks. */
export function renderScale(): number {
  return lite ? 1 : window.devicePixelRatio || 1;
}

/** How much denser than the board text is drawn. */
export function textOversample(): number {
  return lite ? 1 : TEXT_OVERSAMPLE;
}

/** A board is about to be built. If this page dies before markBooted fires, the next load is lite. */
export function markBooting(): void {
  write(BOOT_KEY, String(Date.now()));
}

/**
 * The board has been dealt (called from each scene's create()) and has
 * stayed up. Waiting is the point: a kill
 * from memory pressure usually arrives a moment after the first frame, as the
 * rest of the textures land.
 */
export function markBooted(): void {
  setTimeout(() => write(BOOT_KEY, null), SURVIVE_MS);
}
