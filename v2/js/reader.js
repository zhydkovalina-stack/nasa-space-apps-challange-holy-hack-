/* Radar reader: a radar image of Amazon flooding in Peru (PIA26112, UAVSAR, NASA/JPL-Caltech: the kind of
   image NISAR makes) on the left, a plain-language map derived from it on the right, with a draggable seam
   and a hover "what is this?" tip. Colour meanings from NASA's caption: black = open water, grey-green =
   tropical forest, dark green = low-lying or floating plants, red and pink = flooded vegetation. */
(function () {
  const BBOX = [0, 0, 1, 1], W = 900, H = 638, URL = "img/pia26112.jpg";
  const CLS = {
    water:    { col: [52, 22, 98], name: "Open water", why: "black: the pulse bounced away" },
    forest:   { col: [86, 118, 178], name: "Tropical forest", why: "grey-green: leaves and branches scatter the pulse" },
    floating: { col: [176, 160, 205], name: "Low or floating plants", why: "dark green: a weak, low echo" },
    flooded:  { col: [181, 44, 92], name: "Flooded forest", why: "red / pink: water under the trees bounces the pulse back up the trunks" }
  };
  const KEYS = Object.keys(CLS);
  const PLACES = [];                                 // no place labels on this scene

  const box = document.getElementById("compare"), rad = document.getElementById("rad"), lab = document.getElementById("lab");
  const tip = document.getElementById("tip"), loading = document.getElementById("read-loading");
  [rad, lab].forEach((c) => { c.width = W; c.height = H; });
  let classes = null, px = null;

  function classify(r, g, b, a) {
    if (a < 10) return -1;
    const lum = (r + g + b) / 3;
    if (lum < 38) return 0;                                      // black: open water
    if ((r > g * 1.25 && r > b * 0.9) || (b > g * 1.15 && r > g * 1.1)) return 3;   // red, pink, magenta: flooded vegetation
    if (lum < 95 && Math.abs(r - g) < 30) return 2;              // dark green / olive: low or floating plants
    return 1;                                                    // grey-green: tropical forest
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const rc = rad.getContext("2d");
    rc.fillStyle = "#150a24"; rc.fillRect(0, 0, W, H);
    rc.drawImage(img, 0, 0, W, H);
    px = rc.getImageData(0, 0, W, H).data;
    // raw classes, then a 3x3 majority filter so the map reads as areas, not speckle
    const raw = new Int8Array(W * H);
    for (let i = 0; i < W * H; i++) raw[i] = classify(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]);
    classes = new Int8Array(W * H);
    const counts = [0, 0, 0, 0];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = [0, 0, 0, 0]; let any = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy)), xx = Math.min(W - 1, Math.max(0, x + dx)), c = raw[yy * W + xx];
        if (c >= 0) { v[c]++; any = true; }
      }
      const c = any ? v.indexOf(Math.max(...v)) : -1;
      classes[y * W + x] = c;
      if (c >= 0) counts[c]++;
    }
    const lc = lab.getContext("2d"), out = lc.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const c = classes[i];
      if (c < 0) { out.data.set([21, 10, 36, 255], i * 4); continue; }
      const col = CLS[KEYS[c]].col, x = i % W, y = (i / W) | 0;
      const shade = (x + y) % 4 === 0 ? 0.86 : 1;                 // faint dither texture
      out.data.set([col[0] * shade, col[1] * shade, col[2] * shade, 255], i * 4);
    }
    lc.putImageData(out, 0, 0);
    lc.font = "bold 13px Nasalization, sans-serif";
    for (const [n, lat, lon] of PLACES) {
      const x = ((lon - BBOX[0]) / (BBOX[2] - BBOX[0])) * W, y = ((BBOX[3] - lat) / (BBOX[3] - BBOX[1])) * H;
      lc.strokeStyle = "#07040d"; lc.lineWidth = 3; lc.beginPath(); lc.arc(x, y, 5, 0, 7); lc.stroke();
      lc.fillStyle = "#f6ebe1"; lc.beginPath(); lc.arc(x, y, 3, 0, 7); lc.fill();
      const tw = lc.measureText(n.toUpperCase()).width;
      lc.fillStyle = "rgba(7,4,13,.85)"; lc.fillRect(x + 9, y - 10, tw + 10, 20);
      lc.fillStyle = "#f6ebe1"; lc.fillText(n.toUpperCase(), x + 14, y + 5);
    }
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    KEYS.forEach((k, i) => (document.querySelector(`.pct[data-k="${k}"]`).textContent = Math.round((counts[i] / total) * 100) + "%"));
    loading.remove();
  };
  img.onerror = () => (loading.textContent = "The radar image did not load. Try reloading.");
  img.src = URL;

  // seam drag + hover tip
  let dragging = false;
  const setCut = (clientX) => {
    const r = box.getBoundingClientRect();
    box.style.setProperty("--cut", Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)) + "%");
  };
  box.addEventListener("pointerdown", (e) => { dragging = true; box.setPointerCapture(e.pointerId); setCut(e.clientX); });
  box.addEventListener("pointerup", () => (dragging = false));
  box.addEventListener("pointermove", (e) => {
    if (dragging) setCut(e.clientX);
    if (!classes) return;
    const r = box.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * W), y = Math.floor(((e.clientY - r.top) / r.height) * H);
    const c = classes[y * W + x];
    if (c == null || c < 0) { tip.hidden = true; return; }
    const k = CLS[KEYS[c]];
    tip.innerHTML = `${k.name}<br><span style="color:#8a84a8">radar ${k.why}</span>`;
    tip.style.left = e.clientX - r.left + "px"; tip.style.top = e.clientY - r.top + "px"; tip.hidden = false;
  });
  box.addEventListener("pointerleave", () => (tip.hidden = true));
  box.tabIndex = 0;
  box.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const cur = parseFloat(getComputedStyle(box).getPropertyValue("--cut")) || 50;
    box.style.setProperty("--cut", Math.min(100, Math.max(0, cur + (e.key === "ArrowLeft" ? -5 : 5))) + "%");
    e.preventDefault();
  });
})();
