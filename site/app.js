// Place-name markers (lat, lon). Sources: Polish Wikipedia / OpenStreetMap (see References).
const MARKERS = {
  region: [
    ["Lake Powidzkie", 52.409, 17.933], ["Lake Wilczyńskie", 52.482, 18.116], ["Lake Gopło", 52.614, 18.358],
    ["Tomisławice pit", 52.462, 18.524], ["Jóźwin IIB pit", 52.416, 18.166], ["Drzewce pit", 52.273, 18.508],
    ["Konin", 52.229, 18.245], ["Pątnów power plant", 52.301, 18.236],
  ],
  lakes: [
    ["Wilczyńskie", 52.482, 18.116], ["Suszewskie", 52.482, 18.091], ["Budzisławskie", 52.461, 18.050],
    ["Kownackie", 52.493, 18.117], ["Ostrowskie", 52.528, 18.124],
  ],
  pit: [["Jóźwin IIB", 52.416, 18.166], ["Kazimierz", 52.373, 18.153]],
};

const bboxOf = (s) => s.split(",").map(Number); // lon0,lat0,lon1,lat1
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const getJSON = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// ---------- maps: markers + swipe sliders ----------
document.querySelectorAll(".map[data-markers]").forEach((map) => {
  const [lon0, lat0, lon1, lat1] = bboxOf(map.dataset.bbox);
  for (const [name, lat, lon] of MARKERS[map.dataset.markers] || []) {
    if (lon < lon0 || lon > lon1 || lat < lat0 || lat > lat1) continue;
    const m = document.createElement("div");
    m.className = "marker";
    m.style.left = ((lon - lon0) / (lon1 - lon0)) * 100 + "%";
    m.style.top = ((lat1 - lat) / (lat1 - lat0)) * 100 + "%";
    m.innerHTML = `<span>${name}</span>`;
    map.appendChild(m);
  }
});

document.querySelectorAll(".compare").forEach((c) => {
  const top = c.querySelector(".top"), range = c.querySelector("input");
  const div = document.createElement("div");
  div.className = "divider";
  c.appendChild(div);
  const set = (v) => { top.style.clipPath = `inset(0 ${100 - v}% 0 0)`; div.style.left = v + "%"; };
  range.addEventListener("input", () => set(range.value));
  set(range.value);
});

// ---------- tiny SVG line chart ----------
// series: [{name, color, points: [[x, y, lo?, hi?]], band?, line?, r?, unit?}]
function lineChart(el, { series, xType = "year", yLabel = "", yMin, yMax }) {
  const W = 860, H = 320, m = { l: 60, r: 16, t: 16, b: 40 };
  const toX = (v) => (xType === "date" ? new Date(v + "T12:00:00Z").getTime() : v);
  const all = series.flatMap((s) => s.points);
  if (!all.length) { el.innerHTML = '<p class="nodata">Data not available yet.</p>'; return; }
  const xs = all.map((p) => toX(p[0]));
  const ys = all.flatMap((p) => [p[1], p[2] ?? p[1], p[3] ?? p[1]]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = yMin ?? Math.min(...ys) * 0.95, y1 = yMax ?? Math.max(...ys) * 1.08;
  const sx = (v) => m.l + ((toX(v) - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const ticks = (a, b, n) => {
    const raw = (b - a) / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((k) => k * p).find((k) => k >= raw);
    const t = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) t.push(+v.toFixed(6));
    return t;
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${yLabel}">`;
  for (const t of ticks(y0, y1, 5)) {
    svg += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    svg += `<text class="ax" x="${m.l - 8}" y="${sy(t) + 4}" text-anchor="end">${t}</text>`;
  }
  let xt;
  if (xType === "date") {
    xt = [];
    const spanMonths = (x1 - x0) / 2.63e9;
    const stepMonths = [1, 2, 3, 6, 12, 24].find((k) => spanMonths / k <= 8) || 24;
    const d = new Date(x0); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    while (d.getTime() <= x1) { xt.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() + stepMonths); }
  } else xt = ticks(x0, x1, 9);
  for (const t of xt) {
    const lab = xType === "date" ? new Date(t).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : t;
    svg += `<text class="ax" x="${sx(t)}" y="${H - m.b + 18}" text-anchor="middle">${lab}</text>`;
  }
  const cy = m.t + (H - m.t - m.b) / 2;
  svg += `<text class="ax" x="14" y="${cy}" transform="rotate(-90 14 ${cy})" text-anchor="middle">${yLabel}</text>`;
  for (const s of series) {
    const pts = s.points;
    if (!pts.length) continue;
    if (s.band) {
      const up = pts.map((p) => `${sx(p[0])},${sy(p[3])}`), lo = pts.slice().reverse().map((p) => `${sx(p[0])},${sy(p[2])}`);
      svg += `<polygon class="band" fill="${s.color}" points="${up.concat(lo).join(" ")}"/>`;
    }
    if (s.line !== false) svg += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${pts.map((p) => `${sx(p[0])},${sy(p[1])}`).join(" ")}"/>`;
    for (const p of pts) {
      const when = xType === "date" ? fmtDate(p[0]) : p[0];
      svg += `<circle cx="${sx(p[0])}" cy="${sy(p[1])}" r="${s.r ?? 4}" fill="${s.color}"><title>${s.name} · ${when}: ${p[1]}${s.unit ?? ""}</title></circle>`;
    }
  }
  svg += "</svg>";
  const legend = series.filter((s) => s.points.length).map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("");
  el.innerHTML = svg + `<div class="chart-legend">${legend}</div>`;
}

const C = { lake: "#1f6f8b", ctrl: "#b07d2b", s1: "#8a5cc2", nisar: "#d1495b", soil: "#2a8f6a", soil2: "#c47f2c" };

// ---------- data-driven figures ----------
(async () => {
  const [lakes, powidz, s1, nisar, soil, mt] = await Promise.all([
    getJSON("data/lake_area.json"), getJSON("data/lake_area_powidzkie.json"), getJSON("data/jozwin_s1_area.json"),
    getJSON("data/nisar_water.json"), getJSON("data/sme2.json"), getJSON("data/nisar_mt.json"),
  ]);
  const yearly = (d) => (d?.years || []).filter((y) => !y.outlier && y.area_ha != null).map((y) => [y.year, Math.round(y.area_ha)]);

  // Chapter 1: lake area per year (Landsat)
  lineChart(document.getElementById("chart-lakes"), {
    yLabel: "water area (ha)", yMin: 0,
    series: [
      { name: "Lake chain (Wilczyńskie–Budzisławskie)", color: C.lake, points: yearly(lakes), unit: " ha" },
      { name: "Lake Powidzkie", color: C.ctrl, points: yearly(powidz), unit: " ha" },
    ],
  });

  // Chapter 2: Jóźwin pit open water (Sentinel-1 monthly max + NISAR per pass)
  const ns = nisar?.series || [];
  lineChart(document.getElementById("chart-pit"), {
    xType: "date", yLabel: "open water (ha)", yMin: 0,
    series: [
      { name: "Sentinel-1 (monthly max)", color: C.s1, points: (s1?.months || []).map((m) => [m.month + "-15", Math.round(m.water_ha_max)]), unit: " ha" },
      { name: "NISAR track 80 (each pass)", color: C.nisar, r: 5, unit: " ha",
        points: (mt?.pit?.series || []).filter((r) => r.track === "080").map((r) => [r.date, Math.round(r.water_ha)]) },
    ],
  });

  // Chapter 3: NISAR lake-chain open water per pass (multi-temporal filtered stack), one series per track
  const ml = mt?.lakes?.series || [];
  lineChart(document.getElementById("chart-nisar-lakes"), {
    xType: "date", yLabel: "open water (ha)", yMin: 0, yMax: 700,
    series: [...new Set(ml.map((r) => r.track))].sort().map((tr, i) => ({
      name: `NISAR track ${+tr} (${tr === "057" ? "ascending" : "descending"})`, color: i ? C.soil2 : C.nisar, r: 5, unit: " ha",
      points: ml.filter((r) => r.track === tr).map((r) => [r.date, Math.round(r.water_ha)]),
    })),
  });

  const frames = ns.filter((r) => r.track === "080" && (r.views || []).includes("region")).map((r) => r.date);
  const t = document.querySelector('.timelapse[data-source="nisar-region"]');
  if (t && frames.length) {
    const img = t.querySelector("img"), label = t.querySelector(".date");
    const controls = t.parentElement.querySelector(".tl-controls");
    const range = controls.querySelector("input"), btn = controls.querySelector(".play");
    const src = (d) => `img/nisarmt_region_${d}_t080.jpg`;
    range.max = frames.length - 1;
    frames.forEach((d) => { new Image().src = src(d); }); // preload
    const show = (i) => { img.src = src(frames[i]); label.textContent = "NISAR · " + fmtDate(frames[i]); range.value = i; };
    let timer = null;
    btn.addEventListener("click", () => {
      if (timer) { clearInterval(timer); timer = null; btn.textContent = "▶ Play"; return; }
      btn.textContent = "❚❚ Pause";
      timer = setInterval(() => show((+range.value + 1) % frames.length), 900);
    });
    range.addEventListener("input", () => show(+range.value));
    show(0);
  }

  // Drought: soil-moisture slider (driest vs wettest pass of one track) + chart
  const byTrack = {};
  (soil?.series || []).forEach((s) => (byTrack[s.track] ||= []).push(s));
  const tracks = Object.keys(byTrack).sort();
  const main = tracks.map((k) => byTrack[k]).sort((a, b) => b.length - a.length)[0] || [];
  if (main.length >= 2) {
    const dry = main.reduce((a, b) => (b.median < a.median ? b : a));
    const wet = main.reduce((a, b) => (b.median > a.median ? b : a));
    const sc = document.getElementById("soil-compare");
    sc.querySelector(".top .sm").src = "img/" + dry.file;
    sc.querySelector(".base .sm").src = "img/" + wet.file;
    sc.querySelector(".soil-l").textContent = `Driest · ${fmtDate(dry.date)}`;
    sc.querySelector(".soil-r").textContent = `Wettest · ${fmtDate(wet.date)}`;
  }
  const ch = soil?.change?.["057"];
  if (ch) {
    document.querySelector(".soil-pct").textContent = Math.round(ch.pct_drier) + "%";
    document.querySelector(".soil-med").textContent = ch.median_change.toFixed(3);
  }
  lineChart(document.getElementById("chart-soil"), {
    xType: "date", yLabel: "soil moisture (m³/m³)", yMin: 0,
    series: tracks.map((tr, i) => ({
      name: `NISAR track ${+tr} (${byTrack[tr][0].dir === "A" ? "ascending" : "descending"})`,
      color: i ? C.soil2 : C.soil, band: true, unit: " m³/m³",
      points: byTrack[tr].map((s) => [s.date, +s.median.toFixed(3), s.p25, s.p75]),
    })),
  });
})();
