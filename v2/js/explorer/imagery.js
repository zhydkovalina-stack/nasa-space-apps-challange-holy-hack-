/* Quick-look images in memory: download once, reuse for the globe overlay, the pixel probe,
   time series and change maps. Full quick-looks are ~2000 × 2000 px PNGs of 2–5 MB whose black
   background is transparent (PNG tRNS), so decoded pixels outside the swath have alpha 0. */

const BLOB_MAX = 14, BMP_MAX = 3;
const blobs = new Map(), bmps = new Map();

function touch(map, key) { const v = map.get(key); map.delete(key); map.set(key, v); return v; }

export function getBlob(url) {
  if (blobs.has(url)) return touch(blobs, url);
  const pr = fetch(url).then((r) => { if (!r.ok) throw new Error(`image ${r.status}`); return r.blob(); });
  pr.catch(() => blobs.delete(url));
  blobs.set(url, pr);
  while (blobs.size > BLOB_MAX) blobs.delete(blobs.keys().next().value);
  return pr;
}
export const hasBlob = (url) => blobs.has(url);

// decoded bitmaps: a tiny LRU (each one is ~16 MB decoded)
export function bitmap(url) {
  if (bmps.has(url)) return touch(bmps, url);
  const pr = getBlob(url).then((b) => createImageBitmap(b));
  pr.catch(() => bmps.delete(url));
  bmps.set(url, pr);
  while (bmps.size > BMP_MAX) {
    const k = bmps.keys().next().value;
    bmps.get(k).then((b) => b.close?.(), () => {});
    bmps.delete(k);
  }
  return pr;
}
// a one-off decode that is closed by the caller (time series walks through many images)
export const decodeOnce = (url) => getBlob(url).then((b) => createImageBitmap(b));

const probeCv = document.createElement("canvas");
const probeCx = probeCv.getContext("2d", { willReadFrequently: true });

// mean colour in a (2r+1)² window around lon/lat; null outside the image or swath
export function sample(bmp, rect, lon, lat, r = 2) {
  const x = Math.floor(((lon - rect.w) / (rect.e - rect.w)) * bmp.width);
  const y = Math.floor(((rect.n - lat) / (rect.n - rect.s)) * bmp.height);
  if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) return null;
  const n = 2 * r + 1;
  probeCv.width = n; probeCv.height = n;
  probeCx.clearRect(0, 0, n, n);
  probeCx.drawImage(bmp, x - r, y - r, n, n, 0, 0, n, n);
  const d = probeCx.getImageData(0, 0, n, n).data;
  let R = 0, G = 0, B = 0, c = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { R += d[i]; G += d[i + 1]; B += d[i + 2]; c++; }
  if (c < Math.ceil((n * n) / 3)) return null;
  return { r: R / c, g: G / c, b: B / c, n: c, x, y };
}

const ch = { r: (d, i) => d[i], g: (d, i) => d[i + 1], all: (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3 };

// Change between two quick-looks of the same frame, on A's grid. B is placed by its own lat/lon box.
// Returns a canvas (orange = brighter in B, blue = darker in B, unchanged = transparent) and stats.
//
// Radar quick-looks are speckled and each is stretched on its own, so a fixed grey-level threshold
// mostly maps noise. Instead the difference image is measured first: its median (the overall
// offset between the two stretches) is removed, and its spread (σ ≈ 1.4826 × median absolute
// deviation, robust to the real changes) sets the scale. Pixels beyond `k`·σ are flagged.
export async function changeMap(A, B, { channel = "g", k = 2.5, maxW = 1000 } = {}) {
  const W = Math.min(maxW, A.bmp.width), H = Math.round((W * A.bmp.height) / A.bmp.width);
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return [c, c.getContext("2d", { willReadFrequently: true })]; };
  const [, ax] = mk(), [, bx] = mk(), [oc, ox] = mk();
  ax.filter = bx.filter = "blur(2px)";   // tame speckle before differencing
  ax.drawImage(A.bmp, 0, 0, W, H);
  const sx = W / (A.rect.e - A.rect.w), sy = H / (A.rect.n - A.rect.s);
  bx.drawImage(B.bmp, (B.rect.w - A.rect.w) * sx, (A.rect.n - B.rect.n) * sy, (B.rect.e - B.rect.w) * sx, (B.rect.n - B.rect.s) * sy);
  const a = ax.getImageData(0, 0, W, H).data, b = bx.getImageData(0, 0, W, H).data;
  const out = ox.createImageData(W, H), o = out.data, f = ch[channel] || ch.g;

  const hd = new Uint32Array(511);   // histogram of d = B − A, offset by 255
  let overlap = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 250 || b[i + 3] < 250) continue;
    hd[Math.round(f(b, i) - f(a, i)) + 255]++; overlap++;
  }
  if (!overlap) return { canvas: oc, rect: A.rect, stats: { overlap: 0, up: 0, down: 0, shift: 0, sigma: 0 } };
  const quantile = (h, q) => { let c = 0; for (let v = 0; v < h.length; v++) { c += h[v]; if (c >= q * overlap) return v; } return h.length - 1; };
  const shift = quantile(hd, 0.5) - 255;
  const hm = new Uint32Array(256);   // histogram of |d − median|
  for (let v = 0; v < 511; v++) if (hd[v]) hm[Math.min(255, Math.abs(v - 255 - shift))] += hd[v];
  const sigma = Math.max(1, 1.4826 * quantile(hm, 0.5));
  const thr = k * sigma;

  let up = 0, down = 0;
  const UP = [255, 154, 60], DOWN = [79, 157, 255];   // orange / blue, the two poles of a diverging pair
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 250 || b[i + 3] < 250) continue;
    const d = f(b, i) - f(a, i) - shift, m = Math.abs(d);
    if (m < thr) continue;
    const c = d > 0 ? UP : DOWN;
    d > 0 ? up++ : down++;
    o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2];
    o[i + 3] = Math.min(255, 130 + ((m - thr) / (2 * sigma)) * 125);
  }
  ox.putImageData(out, 0, 0);
  return { canvas: oc, rect: A.rect, stats: { overlap, up, down, shift, sigma } };
}

export const canvasBlob = (cv) => new Promise((res) => cv.toBlob(res, "image/png"));
