/**
 * Batas bawah interval kepercayaan Wilson (Wilson 1927), z = 1,96 (95%):
 *
 *   W = (p + z²/2n − z·√(p(1−p)/n + z²/4n²)) / (1 + z²/n),  p = naik/n, n = naik + turun
 *
 * Puisi dengan sedikit suara positif tidak langsung mengalahkan puisi dengan
 * banyak suara yang sebagian besar positif. n boleh pecahan (suara berbobot).
 */
export const Z = 1.96;

export function wilson(naik, turun, z = Z) {
  const n = naik + turun;
  if (!(n > 0)) return 0;
  const p = naik / n;
  const z2 = z * z;
  const w = (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return Math.min(1, Math.max(0, w));
}
