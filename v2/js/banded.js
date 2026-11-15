/* Banded gradients with grain (replaces the old dotted/halftone gradients).
   Any element with data-band gets a canvas painted behind its content:
     data-band="columns"  vertical columns, each fading dark → warm → light; the dark top runs
                          deepest in the middle columns (stepped curtain)
     data-band="rings"    concentric hard-edged colour steps, light centre → dark edge
                          (data-shape="square" for square steps, data-tone="warm" for the warm ramp)
   Colours come from the site palette (sampled from the NISAR interferogram). */
window.Banded = (function () {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const COOL = ["#e7ecff", "#c9d4ff", "#8f9cf2", "#6a5ad6", "#5a45c2", "#3a1d6e", "#2c1450", "#1a0a2e", "#07040d"].map(hex);
  const WARM = ["#fff3dc", "#ffd9b0", "#ffbb82", "#f08a58", "#de6a3e", "#9a3044", "#4d1648", "#2c1450", "#07040d"].map(hex);
  const ramp = (stops, t) => {                       // smooth sample of a colour ramp, t ∈ [0,1]
    const u = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1), i = Math.floor(u), k = u - i;
    return stops[i].map((v, c) => v + (stops[i + 1][c] - v) * k);
  };

  function paint(el) {
    let cv = el.querySelector(":scope > canvas.band");
    if (!cv) {
      cv = document.createElement("canvas"); cv.className = "band"; cv.setAttribute("aria-hidden", "true");
      el.prepend(cv);
    }
    const r = el.getBoundingClientRect();
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    const W = Math.max(1, Math.round(r.width * scale)), H = Math.max(1, Math.round(r.height * scale));
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H), d = img.data;
    const type = el.dataset.band, grain = +(el.dataset.grain ?? 18), floor = +(el.dataset.light ?? 0);   // floor: stop before the lightest colours
    const stops = el.dataset.tone === "cool" ? COOL : el.dataset.tone === "warm" ? WARM : type === "columns" ? WARM : COOL;

    if (type === "columns") {
      const n = +(el.dataset.cols || 9);
      for (let x = 0; x < W; x++) {
        const i = Math.min(n - 1, Math.floor((x / W) * n));
        const c = 1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2 || 1);      // 1 in the middle column, 0 at the edges
        const dark = 0.08 + 0.55 * c;                                       // how far the dark top reaches down
        for (let y = 0; y < H; y++) {
          const t = y / H;
          const u = t < dark ? 0 : (t - dark) / (1 - dark);
          const col = ramp(stops, floor + (1 - floor) * (1 - Math.min(1, u * 1.1)));   // dark at top → light at bottom
          const p = (y * W + x) * 4, n0 = (Math.random() - 0.5) * grain;
          d[p] = col[0] + n0; d[p + 1] = col[1] + n0; d[p + 2] = col[2] + n0; d[p + 3] = 255;
        }
      }
    } else {                                                                // rings / squares, hard steps
      const steps = +(el.dataset.steps || 8), sq = el.dataset.shape === "square";
      const cx = W * (+(el.dataset.cx ?? 0.5)), cy = H * (+(el.dataset.cy ?? 0.5));
      const R = Math.max(cx, W - cx, cy, H - cy);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (x - cx) / R, dy = (y - cy) / R;
        const dist = sq ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy * 1.15);
        const band = Math.min(steps - 1, Math.floor(dist * steps));
        const t = band / (steps - 1);
        const col = ramp(stops, el.dataset.invert ? 1 - t : t);       // invert: dark centre → light edge
        const p = (y * W + x) * 4, n0 = (Math.random() - 0.5) * grain;
        d[p] = col[0] + n0; d[p + 1] = col[1] + n0; d[p + 2] = col[2] + n0; d[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function init() {
    const els = [...document.querySelectorAll("[data-band]")];
    els.forEach(paint);
    let t = null;
    addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => els.forEach(paint), 200); });
    document.fonts?.ready.then(() => els.forEach(paint));            // repaint once the title font has its final width
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  return { paint, ramp, COOL, WARM };
})();
