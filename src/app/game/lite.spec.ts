import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeviceHints, getQuality, initLite, isLite, looksLowEnd, markBooted, markBooting, renderScale,
  setLite, setQuality, textOversample,
} from './lite';

// vitest runs in node, so the two browser globals lite.ts touches are faked.
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as unknown as Storage;
}

const MODERN: DeviceHints = {
  deviceMemory: 8,
  hardwareConcurrency: 8,
  devicePixelRatio: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
};
const OLD_IPHONE: DeviceHints = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15',
  devicePixelRatio: 2,
};

describe('looksLowEnd', () => {
  it('leaves a modern phone alone', () => {
    expect(looksLowEnd(MODERN)).toBe(false);
  });

  it('takes a browser at its word about memory', () => {
    expect(looksLowEnd({ deviceMemory: 2 })).toBe(true);
    expect(looksLowEnd({ deviceMemory: 4 })).toBe(false);
  });

  it('catches an iPhone or iPad stuck on iOS before 16, in any browser', () => {
    expect(looksLowEnd(OLD_IPHONE)).toBe(true);
    expect(looksLowEnd({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X)' })).toBe(true);
    expect(looksLowEnd({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' })).toBe(false);
    expect(looksLowEnd({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X)' })).toBe(true);
  });

  it('does not take an old Android or a desktop for an old iPhone', () => {
    expect(looksLowEnd({ userAgent: 'Mozilla/5.0 (Linux; Android 9) Chrome/120', deviceMemory: 4 })).toBe(false);
    expect(looksLowEnd({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(false);
  });

  it('counts few cores only on a screen of 2x or more', () => {
    expect(looksLowEnd({ hardwareConcurrency: 2, devicePixelRatio: 2 })).toBe(true);
    expect(looksLowEnd({ hardwareConcurrency: 2, devicePixelRatio: 1 })).toBe(false);
    expect(looksLowEnd({ hardwareConcurrency: 4, devicePixelRatio: 3 })).toBe(false);
  });
});

describe('lite mode', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    setLite(false);
  });

  it('is off by default on a capable device and draws at the device ratio', () => {
    initLite('', MODERN);
    expect(isLite()).toBe(false);
    expect(getQuality()).toBe('auto');
    expect(textOversample()).toBe(2);
    expect(renderScale()).toBe(3);
  });

  it('turns itself on, unasked, for a device that looks old', () => {
    initLite('', OLD_IPHONE);
    expect(isLite()).toBe(true);
    expect(getQuality()).toBe('auto');
    expect(renderScale()).toBe(1);
    expect(textOversample()).toBe(1);
  });

  it('?lite=1 turns it on and remembers it', () => {
    initLite('?lite=1', MODERN);
    expect(isLite()).toBe(true);
    expect(getQuality()).toBe('lite');
    initLite('', MODERN);
    expect(isLite()).toBe(true);
  });

  it('?lite=0 turns it off, is remembered, and beats the device guess', () => {
    initLite('?lite=0', OLD_IPHONE);
    expect(isLite()).toBe(false);
    expect(getQuality()).toBe('full');
    expect(textOversample()).toBe(2);
    initLite('', OLD_IPHONE);
    expect(isLite()).toBe(false);
  });

  it('goes lite for deviceMemory <= 2 and for few cores on a dense screen', () => {
    initLite('', { deviceMemory: 2 });
    expect(isLite()).toBe(true);
    initLite('', { hardwareConcurrency: 2, devicePixelRatio: 2 });
    expect(isLite()).toBe(true);
  });

  it('a board that started and never reported in sends the next load lite', () => {
    initLite('', MODERN);
    markBooting();
    initLite('', MODERN);
    expect(isLite()).toBe(true);
    // Still automatic: it is a verdict on a board, not a choice the player made.
    expect(getQuality()).toBe('auto');
  });

  it('a board that stays up for the survival window does not', () => {
    vi.useFakeTimers();
    try {
      markBooting();
      markBooted();
      vi.advanceTimersByTime(4001);
      initLite('', MODERN);
      expect(isLite()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an old start mark is a closed tab, not a loss', () => {
    localStorage.setItem('solitaire.boot', String(Date.now() - 10 * 60 * 1000));
    initLite('', MODERN);
    expect(isLite()).toBe(false);
  });

  it('a lost board does not override an explicit choice of full', () => {
    markBooting();
    initLite('?lite=0', MODERN);
    expect(isLite()).toBe(false);
  });

  it('full overrides a lost board and every device rule', () => {
    markBooting();
    initLite('', OLD_IPHONE);
    setQuality('full');
    expect(isLite()).toBe(false);
  });

  it('choosing a quality clears an earlier lost-board verdict', () => {
    markBooting();
    initLite('', MODERN);
    expect(isLite()).toBe(true);
    setQuality('auto');
    expect(isLite()).toBe(false);
    expect(localStorage.getItem('solitaire.liteLost')).toBeNull();
  });

  it('setQuality applies at once, and lite and full are remembered', () => {
    initLite('', MODERN);
    setQuality('lite');
    expect(isLite()).toBe(true);
    expect(localStorage.getItem('solitaire.lite')).toBe('1');
    setQuality('full');
    expect(isLite()).toBe(false);
    expect(localStorage.getItem('solitaire.lite')).toBe('0');
    setQuality('auto');
    expect(localStorage.getItem('solitaire.lite')).toBeNull();
  });
});
