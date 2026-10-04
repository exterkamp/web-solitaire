// What the game leans on that an older iPhone does not have.
//
// Every browser on iOS is WebKit, so the iOS version decides this, not the
// browser's. `Array.prototype.at` and `Object.hasOwn` both arrived in iOS
// 15.4: the main menu reaches `.at` while drawing its frame lights, and
// Angular's own injector calls `Object.hasOwn` during bootstrap.
//
// Added only where it is missing, and only this: a blanket polyfill bundle
// would be paid for by every player to help a few.

export function installPolyfills(): void {
  if (typeof Object.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      configurable: true,
      writable: true,
      value: (obj: object, key: PropertyKey): boolean =>
        Object.prototype.hasOwnProperty.call(obj, key),
    });
  }
  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true,
      writable: true,
      value: function at<T>(this: ArrayLike<T>, index: number): T | undefined {
        const n = Math.trunc(index) || 0;
        const i = n < 0 ? this.length + n : n;
        return i < 0 || i >= this.length ? undefined : this[i];
      },
    });
  }
}
