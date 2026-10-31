/** Deterministic PRNG (mulberry32) so `npm run seed` produces identical data every time. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    float: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    weighted: <T extends string>(weights: Record<T, number>): T => {
      const entries = Object.entries(weights) as [T, number][];
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [k, w] of entries) {
        r -= w;
        if (r <= 0) return k;
      }
      return entries[entries.length - 1][0];
    },
    /** Log-normal around `median` with spread `sigma`. */
    lognormal: (median: number, sigma: number) => {
      const u1 = Math.max(next(), 1e-9);
      const u2 = next();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return median * Math.exp(sigma * z);
    },
  };
  return rng;
}
export type Rng = ReturnType<typeof createRng>;
