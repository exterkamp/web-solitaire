// A random number generator you can ask for the same numbers twice.
//
// Math.random is right for the game and wrong for a test: anything that deals
// from a distribution can only be checked by dealing a great many times and
// looking at what came out, and that is a flaky test unless the sequence is
// fixed. Everything here takes a `() => number` so the game passes Math.random
// and a test passes one of these.
//
// mulberry32: small, fast, and far better distributed than anything built out
// of Math.sin, which is the usual thing people reach for.
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
