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
      expect([1, 2, 3].at(NaN)).toBe(1);
      expect([1, 2, 3].at(1.9)).toBe(2);
      expect([1, 2, 3].at(-0.5)).toBe(1);
    } finally {
      Object.defineProperty(Array.prototype, 'at', { value: realAt, configurable: true, writable: true });
    }
  });

  it('adds Object.hasOwn() where it is missing', () => {
    const realHasOwn = Object.hasOwn;
    try {
      // @ts-expect-error simulating an engine without it
      delete Object.hasOwn;
      expect(typeof Object.hasOwn).toBe('undefined');

      installPolyfills();

      expect(Object.hasOwn({ a: 1 }, 'a')).toBe(true);
      expect(Object.hasOwn({ a: 1 }, 'b')).toBe(false);
      expect(Object.hasOwn(Object.create({ inherited: 1 }), 'inherited')).toBe(false);
      expect(Object.hasOwn([1], 0)).toBe(true);
    } finally {
      Object.defineProperty(Object, 'hasOwn', { value: realHasOwn, configurable: true, writable: true });
    }
  });

  it('leaves a native Object.hasOwn() alone', () => {
    const before = Object.hasOwn;
    installPolyfills();
    expect(Object.hasOwn).toBe(before);
  });

  it('leaves a native at() alone', () => {
    const before = Array.prototype.at;
    installPolyfills();
    expect(Array.prototype.at).toBe(before);
  });
});
