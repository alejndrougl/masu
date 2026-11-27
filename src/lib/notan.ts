/**
 * El notan de la figura: dos valores y nada más. El corte es el de Otsu sobre la luminosidad de
 * la propia figura (el que mejor separa lo que recibe luz de lo que no), la frontera se limpia de
 * motas y la silueta lleva un filo medio para que un negro no se funda con el fondo.
 */
export function notanMask(L: Uint8Array, mask: Uint8Array | null, w: number, h: number): { dark: Uint8Array; cut: number } {
  const n = w * h;
  // Se suaviza antes de cortar: la frontera debe ser una forma, no la textura.
  let soft = Float32Array.from(L);
  const r = Math.max(1, Math.round(Math.max(w, h) / 260));
  for (let k = 0; k < 2; k++) {
    const next = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let c = 0;
        for (let dy = -r; dy <= r; dy += r) {
          for (let dx = -r; dx <= r; dx += r) {
            const px = x + dx;
            const py = y + dy;
            if (px < 0 || py < 0 || px >= w || py >= h) continue;
            sum += soft[py * w + px];
            c++;
          }
        }
        next[y * w + x] = sum / c;
      }
    }
    soft = next;
  }
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) continue;
    hist[Math.max(0, Math.min(255, Math.round(soft[i])))]++;
    total++;
  }
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let cut = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      cut = t + 1;
    }
  }
  let dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) dark[i] = soft[i] < cut && (!mask || mask[i]) ? 1 : 0;
  // Voto de vecinos: quita las motas sueltas de una y otra mancha sin mover la frontera grande.
  const vote = Math.max(1, Math.round(Math.max(w, h) / 220));
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mask && !mask[i]) continue;
        let on = 0;
        let c = 0;
        for (let dy = -vote; dy <= vote; dy++) {
          for (let dx = -vote; dx <= vote; dx++) {
            const px = x + dx;
            const py = y + dy;
            if (px < 0 || py < 0 || px >= w || py >= h || (mask && !mask[py * w + px])) continue;
            on += dark[py * w + px];
            c++;
          }
        }
        next[i] = on * 2 > c ? 1 : 0;
      }
    }
    dark = next;
  }
  return { dark, cut };
}
