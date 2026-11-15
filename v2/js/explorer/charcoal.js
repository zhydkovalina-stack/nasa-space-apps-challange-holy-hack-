/* The Explorer's base map, one tile at a time: Esri's Dark Gray Canvas recoloured onto the
   site's charcoal and shaded with Esri's dark hillshade. Shared by the background worker
   (charcoal-worker.js, the normal path) and the main thread (fallback when workers or
   OffscreenCanvas are missing).

   The Dark Gray tiles hold water at grey ≈36, land ≈66–72 and roads/edges above; the
   hillshade is ≈95 on flat ground at every zoom. */

const CHARCOAL = [[0, "#060607"], [36, "#09090a"], [50, "#141417"], [66, "#1c1c21"], [74, "#1f1f24"], [90, "#2e2e35"], [130, "#55555f"], [255, "#8a8a95"]];

const LUT = (() => {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), out = new Uint8ClampedArray(768);
  for (let v = 0, k = 0; v < 256; v++) {
    while (k < CHARCOAL.length - 2 && v > CHARCOAL[k + 1][0]) k++;
    const [l0, c0] = CHARCOAL[k], [l1, c1] = CHARCOAL[k + 1], t = Math.min(1, Math.max(0, (v - l0) / (l1 - l0)));
    const a = rgb(c0), b = rgb(c1);
    for (let c = 0; c < 3; c++) out[v * 3 + c] = a[c] + (b[c] - a[c]) * t;
  }
  return out;
})();

/** Recolour one tile. `makeCanvas(w, h)` returns an OffscreenCanvas (worker) or a <canvas>. */
export async function recolour(baseBlob, hillBlob, makeCanvas) {
  const a = await createImageBitmap(baseBlob);
  const h = hillBlob ? await createImageBitmap(hillBlob).catch(() => null) : null;
  const W = a.width, H = a.height;
  const cv = makeCanvas(W, H), cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(a, 0, 0); a.close?.();
  const img = cx.getImageData(0, 0, W, H), d = img.data;
  let s = null;
  if (h) {
    const hc = makeCanvas(W, H), hx = hc.getContext("2d", { willReadFrequently: true });
    hx.drawImage(h, 0, 0, W, H); h.close?.();
    s = hx.getImageData(0, 0, W, H).data;
  }
  for (let i = 0; i < d.length; i += 4) {
    const k = (((d[i] + d[i + 1] + d[i + 2]) / 3) | 0) * 3;
    const f = s ? Math.min(2, Math.max(0.45, 1 + ((s[i] + s[i + 1] + s[i + 2]) / 3 - 95) / 14)) : 1;
    d[i] = LUT[k] * f; d[i + 1] = LUT[k + 1] * f; d[i + 2] = LUT[k + 2] * f; d[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return cv;
}
