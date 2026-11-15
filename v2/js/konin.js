/* Konin lakes subpage: satellite images recoloured into the site palette, swipe compares in the
   style of the main page's radar reader, place markers, and the Jóźwin pit sparkline.
   Images and data are read from ../site/ (the team's original Konin StoryMap), so both share one copy. */
(function () {
  const BASE = "../site/";
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  // dark → light: the original interferogram palette (void → plum → violet → indigo → periwinkle → ice); water uses the golden highlight
  const COOL = ["#07040d", "#150a24", "#24123f", "#3a1d6e", "#5a45c2", "#7480e0", "#8f9cf2", "#b8c2f8", "#d6defc"].map(hex);
  const WARM = ["#2a1704", "#5a3508", "#9a630c", "#d8960f", "#ffbe0b", "#ffd866", "#fff0c2"].map(hex);
  const ramp = (stops, t, steps) => {
    t = Math.min(0.9999, Math.max(0, t));
    if (steps) t = Math.floor(t * steps) / (steps - 1);                 // hard colour steps, like the banded gradients
    const u = Math.min(0.9999, t) * (stops.length - 1), i = Math.floor(u), k = u - i;
    return stops[i].map((v, c) => v + (stops[i + 1][c] - v) * k);
  };

  // Place names (lat, lon). Sources: Polish Wikipedia / OpenStreetMap.
  const MARKERS = {
    region: [["Lake Wilczyńskie", 52.482, 18.116], ["Lake Powidzkie", 52.409, 17.933], ["Jóźwin IIB pit", 52.416, 18.166], ["Tomisławice pit", 52.462, 18.524], ["Konin", 52.229, 18.245]],
    lakes: [["Wilczyńskie", 52.482, 18.116], ["Budzisławskie", 52.461, 18.05], ["Ostrowskie", 52.528, 18.124]],
    pit: [["Jóźwin IIB", 52.416, 18.166], ["Kazimierz", 52.373, 18.153]],
  };

  const loadImg = (file) => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = BASE + "img/" + file; });

  // paint an image into a canvas, recoloured
  //   ramp:  brightness → stepped cool ramp (water dark, fields indigo, forest/sand light)
  //   water: the team's water-frequency map (grey land, blue water) → dim ramp for land, warm ramp for water
  function paint(im, mode) {
    const cv = document.createElement("canvas"); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(im, 0, 0);
    const img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data, n = cv.width * cv.height;
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
    // stretch between the 2nd and 98th percentile so every image uses the whole ramp
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[lum[i] | 0]++;
    const pct = (p) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= n * p) return v; } return 255; };
    const lo = pct(0.02), hi = Math.max(lo + 1, pct(0.98));
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const grain = (Math.random() - 0.5) * 10;
      let c;
      const t = (lum[i] - lo) / (hi - lo);
      if (mode === "water") {
        const blue = (b - (r + g) / 2) / 160;                          // 0 = grey land, 1 = water on every pass
        c = blue > 0.12 ? ramp(WARM, 0.25 + 0.75 * Math.min(1, blue), 6) : ramp(COOL, 0.06 + t * 0.4, 7);
      } else c = ramp(COOL, 0.04 + Math.pow(Math.max(0, t), 1.25) * 0.74, 7);   // stop at periwinkle: dark map, glowing land
      d[i * 4] = c[0] + grain; d[i * 4 + 1] = c[1] + grain; d[i * 4 + 2] = c[2] + grain; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function addMarkers(box) {
    const [lon0, lat0, lon1, lat1] = box.dataset.bbox.split(",").map(Number);
    for (const [name, lat, lon] of MARKERS[box.dataset.markers] || []) {
      if (lon < lon0 || lon > lon1 || lat < lat0 || lat > lat1) continue;
      const m = document.createElement("div"); m.className = "kmark";
      const x = (lon - lon0) / (lon1 - lon0);
      m.style.left = x * 100 + "%";
      if (x > 0.7) m.classList.add("flip");                            // label on the left near the right edge
      m.style.top = ((lat1 - lat) / (lat1 - lat0)) * 100 + "%";
      m.innerHTML = `<i></i><span>${name}</span>`;
      box.appendChild(m);
    }
  }
  const loading = (box) => { const l = document.createElement("div"); l.className = "loading"; l.textContent = "Loading NISAR imagery"; box.appendChild(l); return l; };

  document.querySelectorAll(".kmap").forEach(async (box) => {
    const l = loading(box);
    try { box.prepend(paint(await loadImg(box.dataset.src), box.dataset.tint)); l.remove(); addMarkers(box); }
    catch { l.textContent = "Image unavailable"; }
  });

  document.querySelectorAll(".kcompare").forEach(async (box) => {
    const l = loading(box);
    try {
      const [a, b] = await Promise.all([loadImg(box.dataset.a), loadImg(box.dataset.b)]);
      box.prepend(paint(a, box.dataset.tint), paint(b, box.dataset.tintB || box.dataset.tint));
      box.style.setProperty("--ar", (a.naturalWidth / a.naturalHeight).toFixed(3));   // the one-screen layout sizes the map from this
      l.remove();
      const seam = document.createElement("div"); seam.className = "seam"; seam.dataset.label = box.dataset.label; box.appendChild(seam);
      const range = document.createElement("input");
      Object.assign(range, { type: "range", min: 0, max: 100, value: 50 }); range.setAttribute("aria-label", box.dataset.label.replace("⟷", "versus"));
      range.addEventListener("input", () => box.style.setProperty("--cut", range.value + "%"));
      box.appendChild(range);
      addMarkers(box);
    } catch { l.textContent = "Image unavailable"; }
  });

  // ---------- numbers from the team's data ----------
  const getJSON = (u) => fetch(BASE + "data/" + u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const fmt = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  Promise.all([getJSON("nisar_mt.json"), getJSON("sme2.json")]).then(([mt, soil]) => {
    if (mt?.lakes?.stable_ha) document.getElementById("kn-stable").textContent = Math.round(mt.lakes.stable_ha) + " ha";
    const pct = soil?.change?.["057"]?.pct_drier;
    if (pct != null) document.getElementById("kn-soil").textContent = Math.round(pct) + "%";

    // Jóźwin pit: open water per pass, descending track 80 (the track that sees the pit floor best)
    const pts = (mt?.pit?.series || []).filter((r) => r.track === "080").map((r) => [r.date, r.water_ha]);
    if (pts.length < 2) return;
    const first = pts[0], last = pts[pts.length - 1];
    document.getElementById("kn-pit-now").textContent = Math.round(last[1]) + " ha";
    document.getElementById("kn-pit-sub").textContent = `+${Math.round(last[1] - first[1])} ha since ${fmt(first[0])} · track 80`;
    const W = 420, H = 150, m = { l: 34, r: 10, t: 10, b: 22 };
    const t = (d) => new Date(d + "T12:00:00Z").getTime(), x0 = t(first[0]), x1 = t(last[0]);
    const yMax = Math.ceil(Math.max(...pts.map((p) => p[1])) / 100) * 100;
    const sx = (d) => m.l + ((t(d) - x0) / (x1 - x0)) * (W - m.l - m.r), sy = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">`;
    for (let v = 0; v <= yMax; v += yMax / 2) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="rgba(255,255,255,.09)"/><text x="${m.l - 6}" y="${sy(v) + 3}" text-anchor="end">${v}</text>`;
    for (const mo of ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]) s += `<text x="${sx(mo)}" y="${H - 6}" text-anchor="middle">${new Date(mo).toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}</text>`;
    const line = pts.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ");
    s += `<polygon points="${sx(first[0])},${sy(0)} ${line} ${sx(last[0])},${sy(0)}" fill="rgba(238,255,26,.1)"/>`;
    s += `<polyline points="${line}" fill="none" stroke="#eeff1a" stroke-width="2"/>`;
    for (const p of pts) s += `<rect x="${sx(p[0]) - 3}" y="${sy(p[1]) - 3}" width="6" height="6" fill="#07040d" stroke="#eeff1a"><title>${fmt(p[0])}: ${Math.round(p[1])} ha</title></rect>`;
    document.getElementById("kn-pit-chart").innerHTML = s + "</svg>";
  });
})();
