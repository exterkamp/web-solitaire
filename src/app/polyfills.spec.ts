import { describe, expect, it } from 'vitest';
import { installPolyfills } from './polyfills';

describe('installPolyfills', () => {
  it('adds at() where it is missing', () => {
    const realAt = Array.prototype.at;
    try {
      // @ts-expect-error simulating an engine without it
      delete Array.prototype.at;
      expect([].hasOwnProperty.call(Array.prototype, 'at')).toBe(false);

      installPolyfills();

      expect([1, 2, 3].at(-1)).toBe(3);
      expect([1, 2, 3].at(0)).toBe(1);
      expect([1, 2, 3].at(5)).toBeUndefined();
      expect([1, 2, 3].at(-4)).toBeUndefined();
    } finally {
      Object.defineProperty(Array.prototype, 'at', { value: realAt, configurable: true, writable: true });
    }
  });

  it('leaves a native at() alone', () => {
    const before = Array.prototype.at;
    installPolyfills();
    expect(Array.prototype.at).toBe(before);
  });
});
