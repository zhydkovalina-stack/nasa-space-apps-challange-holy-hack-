/* Amazon story: the "Through the clouds" section of index.html (and the standalone amazon.html). Brazil as a
   dot matrix with one pin; clicking it dives into a sideways story, the same way the Knurów pin works on the
   Poland map (poland.js). The zoom engine here is a copy of poland.js's, generalised to several radar sliders
   and two charts; the two could be merged. All numbers come from the team's Amazon NISAR analysis (Jun–Nov 2026). */
import { feature } from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { geoMercator, geoPath } from "https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm";
import { geoPolyconic } from "https://cdn.jsdelivr.net/npm/d3-geo-projection@4.0.0/+esm";

const wrap = document.getElementById("am-map"), cv = document.getElementById("am"), ctx = cv.getContext("2d");
const PIN = { lat: -7.05, lon: -55.35, name: "Amazon Rainforest" };          // Novo Progresso, where the story opens

/* ---------- data ---------- */
const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fmtD = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtM = (t) => new Date(t).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const nf = new Intl.NumberFormat("en-GB");

// Novo Progresso, NISAR track 103 ascending: cross-polarised (HV) echo per pass, dB
const NP_DATES = ["2026-06-21", "2026-07-15", "2026-07-27", "2026-08-20", "2026-09-01", "2026-10-07", "2026-10-19"].map(day);
const NP_SERIES = [
  { name: "Intact forest", short: "Forest", color: "#9a97a6", v: [-10.84, -10.9, -10.74, -10.94, -11.1, -11.0, -11.05] },
  { name: "NP-01, cleared slowly", short: "NP-01", color: "#7584e6", v: [-11.58, -12.44, -12.57, -13.51, -13.9, -14.66, -14.98] },
  { name: "Old pasture", short: "Pasture", color: "#9a97a6", dash: "5 4", v: [-16.79, -17.93, -17.14, -18.75, -19.22, -19.06, -19.05] },
  { name: "NP-07, cut and burned", short: "NP-07", color: "#bb820e", v: [-12.55, -12.14, -11.75, -19.99, -20.75, -20.46, -20.27] },
];
// Port of Manaus river level (m), as logged in the team's analysis
const GAUGE = Object.entries({
  "2026-06-01": 27.35, "2026-06-18": 28.18, "2026-06-23": 28.34, "2026-06-28": 28.45, "2026-06-30": 28.48, "2026-07-01": 28.50,
  "2026-07-05": 28.42, "2026-07-10": 28.30, "2026-07-17": 27.15, "2026-07-31": 24.19, "2026-08-10": 22.68, "2026-08-15": 21.78,
  "2026-08-20": 20.86, "2026-08-22": 20.48, "2026-08-27": 19.42, "2026-08-31": 18.88, "2026-09-03": 18.46, "2026-09-08": 18.02,
  "2026-09-10": 17.85, "2026-09-15": 17.46, "2026-09-20": 17.12, "2026-09-27": 16.65, "2026-09-30": 16.50, "2026-10-02": 16.49,
  "2026-10-09": 16.42, "2026-10-11": 16.38, "2026-10-14": 16.36, "2026-10-21": 16.42, "2026-10-26": 16.45, "2026-11-02": 16.40,
  "2026-11-11": 16.38 }).map(([d, v]) => [day(d), v]);
// Mamirauá, NISAR track 161 ascending: flooded forest (trunk–water double bounce) per pass, ha
const FLOOD = Object.entries({
  "2026-06-25": 77868.9, "2026-07-07": 80529.8, "2026-07-19": 86860.3, "2026-08-24": 45473.3, "2026-09-05": 16554.9,
  "2026-09-17": 26232.8, "2026-09-29": 18348.3, "2026-10-11": 9830.5, "2026-10-23": 6169.7 }).map(([d, v]) => [day(d), v]);
const gaugeAt = (t) => { for (let i = 1; i < GAUGE.length; i++) if (GAUGE[i][0] >= t) {
  const [t0, v0] = GAUGE[i - 1], [t1, v1] = GAUGE[i]; return v0 + (v1 - v0) * (t - t0) / (t1 - t0); } return GAUGE.at(-1)[1]; };

/* ---------- story parts ---------- */
const BB = { np: [-55.55, -7.25, -55.15, -6.88], cr: [-56.90, -6.95, -56.54, -6.68], mm: [-65.08, -3.26, -64.68, -2.90] };
const mk = (bb, lon, lat, label, cls = "") => `<span class="am-mk ${cls}" style="left:${((lon - bb[0]) / (bb[2] - bb[0]) * 100).toFixed(2)}%;top:${((bb[3] - lat) / (bb[3] - bb[1]) * 100).toFixed(2)}%"><i></i><b>${label}</b></span>`;
const key = (rows) => `<ul class="zoom-key">${rows.map(([c, t, d]) => `<li><i style="background:${c}"></i><span><b>${t}</b>${d ? `<small>${d}</small>` : ""}</span></li>`).join("")}</ul>`;
const stats = (rows) => `<dl class="zoom-stats">${rows.map(([t, v, u]) => `<div><dt>${t}</dt><dd>${v}<small>${u}</small></dd></div>`).join("")}</dl>`;
// one NISAR slider part: story left, radar right (same layout as the Knurów NISAR part)
const radarPart = (o) => `<div class="zoom-body am-part">
    <figure class="zoom-fig">
      <div class="zoom-tags" aria-hidden="true"><span>${o.tags[0]}</span><span>${o.tags[1]}</span></div>
      <div class="zoom-cmp am-cmp raw hud" style="--ar:${o.ar}">
        <img src="${o.a}" alt="${o.alt[0]}"><img src="${o.b}" alt="${o.alt[1]}">${o.marks || ""}<div class="seam"></div>
        <input type="range" min="0" max="100" value="50" aria-label="${o.tags[0]} versus ${o.tags[1]}"></div>
      <figcaption class="zoom-src">${o.source}</figcaption>
      ${key(o.key)}
    </figure>
    <aside class="zoom-info">
      <div class="zoom-head"><span class="zoom-lbl">${o.kicker}</span></div>
      <h3>${o.title}</h3>
      ${o.text}
      ${stats(o.stats)}
    </aside></div>`;

const RADAR_KEY = [["#51b01c", "Standing forest", "Leaves and branches scatter the pulse back"], ["#5f5a16", "Cleared land", "Pasture and fresh clearings"],
  ["#2e3830", "Burned ground"], ["#ad8e24", "Town"], ["#07040d", "River"]];

const PARTS = [
  // 1 · the cloud problem (full screen, like the 1903 postcard part)
  `<div class="kn-part am-part">
    <figure class="kn-fig">
      <div class="am-s2">
        <div><img src="img/amazon_s2_2025-12-06.jpg" alt="Sentinel-2 view, 6 December 2025: almost all cloud"><b>6 Dec 2025</b></div>
        <div><img src="img/amazon_s2_2026-01-25.jpg" alt="Sentinel-2 view, 25 January 2026: almost all cloud, forest visible at the edges"><b>25 Jan 2026</b></div>
        <div><img src="img/amazon_s2_2026-02-24.jpg" alt="Sentinel-2 view, 24 February 2026: dense cumulus over the forest"><b>24 Feb 2026</b></div>
        <div><img src="img/amazon_s2_2026-03-26.jpg" alt="Sentinel-2 view, 26 March 2026: a cloud bank covers the left two thirds"><b>26 Mar 2026</b></div>
      </div>
      <figcaption>Same 44 × 41 km around Novo Progresso, Pará, Brazil. HLS Sentinel-2 true colour (NASA/USGS, ESA Copernicus), via NASA GIBS.</figcaption></figure>
    <aside class="zoom-info"><div class="zoom-head"><span class="zoom-lbl">Amazon · Dec 2025 – Mar 2026</span></div>
      <h3>A forest under cloud</h3>
      <p>Four looks at the same patch of rainforest in the Brazilian state of Pará, taken by Europe’s Sentinel-2 satellite in the rainy season. Mostly, it saw cloud.</p>
      <p>From November to April, cloud covers 75 to 90% of the sky here. A camera satellite that passes every five days then waits, on average, two and a half to seven weeks for one clear view, and sometimes months. Whatever happens on the ground in between goes unseen.</p>
      <p class="kn-hook">This year, NASA and ISRO’s NISAR radar watched 467 ha of forest disappear here, pass by pass, through cloud and darkness.</p></aside>
  </div>`,

  // 2 · Novo Progresso: forest loss (the main NISAR slider)
  radarPart({
    kicker: "Novo Progresso · Jun–Oct 2026", title: "Forest lost, pass by pass",
    tags: ["21 Jun 2026", "19 Oct 2026"], ar: (1100 / 1020).toFixed(3),
    a: "img/amazon_np_2026-06-21.jpg", b: "img/amazon_np_2026-10-19.jpg",
    alt: ["NISAR radar, 21 June 2026: green forest with brown fishbone clearings", "NISAR radar, 19 October 2026: more brown clearings and dark burned patches"],
    marks: mk(BB.np, -55.2947, -6.9587, "NP-01 · 86.5 ha") + mk(BB.np, -55.463, -7.0083, "NP-02 · 36.7 ha") + mk(BB.np, -55.4718, -6.8897, "NP-07 · burned", "d"),
    text: `<p>NISAR’s radar sees through cloud and needs no daylight. Standing forest glows green: leaves and branches scatter its long L-band pulse back to the satellite. Cut the forest down and the echo drops. Clearings and pasture turn brown, burned ground turns dark.</p>
      <p>Between 21 June and 19 October 2026, the team found 36 new clearings in this one radar frame along the BR-163 highway: 467 ha of forest gone. The biggest, NP-01, is 86.5 ha, about 120 football pitches.</p>`,
    stats: [["Jun–Oct 2026", "36", "new clearings"], ["Forest lost", "467", "ha"], ["Largest", "86.5", "ha, NP-01"]],
    key: RADAR_KEY,
    source: "NISAR L2 GCOV, track 103 ascending, 21 Jun and 19 Oct 2026 (provisional), as rendered by NASA GIBS, about 40 m per pixel. Clearings: team analysis of 7 passes; patches of 5 ha or more whose HV echo fell against nearby intact forest.",
  }),

  // 3 · what a clearing looks like, pass by pass
  `<div class="kn-part am-part">
    <figure class="am-chart-fig">
      <ul class="am-legend" aria-hidden="true">${NP_SERIES.map((s) => `<li style="color:${s.color}"><i${s.dash ? ' class="dash"' : ""}></i><span style="color:var(--cream)">${s.name}</span></li>`).join("")}</ul>
      <div class="am-chart" id="am-chart-np"></div>
      <figcaption>NISAR cross-polarised (HV) echo, dB, on each pass of track 103 over Novo Progresso. Higher = more branches and leaves. Forest and pasture: reference areas in the same frame.</figcaption>
      <details class="am-table"><summary>Numbers</summary><table>
        <tr><th>Pass</th>${NP_SERIES.map((s) => `<th>${s.short}</th>`).join("")}</tr>
        ${NP_DATES.map((t, i) => `<tr><td>${fmtD(t)}</td>${NP_SERIES.map((s) => `<td>${s.v[i].toFixed(1)}</td>`).join("")}</tr>`).join("")}</table></details>
    </figure>
    <aside class="zoom-info"><div class="zoom-head"><span class="zoom-lbl">Novo Progresso · how a clearing looks</span></div>
      <h3>First the chainsaw, then the fire</h3>
      <p>Every pass gives a number for every patch of ground: how much of the pulse comes back. Intact forest stays flat all season. A patch being cleared slides down, pass after pass, towards the level of old pasture.</p>
      <p>NP-01 was cleared bit by bit from July to October. NP-07 fell in one step between 27 July and 20 August, below even the pasture: bare, burned ground. Late in the dry season, from August to October, felled forest is set on fire to clear it for cattle.</p>
      <p>Hover the chart to read each pass.</p></aside>
  </div>`,

  // 4 · Rio Crepori: gold mining
  radarPart({
    kicker: "Rio Crepori · Jun–Oct 2026", title: "Gold in the riverbanks",
    tags: ["21 Jun 2026", "19 Oct 2026"], ar: (1080 / 810).toFixed(3),
    a: "img/amazon_crepori_2026-06-21.jpg", b: "img/amazon_crepori_2026-10-19.jpg",
    alt: ["NISAR radar, 21 June 2026: forest along the Crepori river with brown mining scars", "NISAR radar, 19 October 2026: the mining scars along the rivers have spread"],
    marks: mk(BB.cr, -56.7687, -6.868, "GAR-25 · +50 ha") + mk(BB.cr, -56.573, -6.8691, "GAR-27 · +46 ha", "l") + mk(BB.cr, -56.8817, -6.7053, "GAR-02 · +44 ha"),
    text: `<p>West of the highway, along the Crepori river, the forest is torn open by small-scale gold mining, the garimpos, much of it illegal. Miners strip the riverbanks and dredge the beds, leaving chains of muddy ponds behind.</p>
      <p>Calm water is a mirror for radar, so the ponds show up black. Across 44 mining sites, 446 ha of riverbank and forest were newly dug up between July and October 2026, and the area of open dredging ponds nearly doubled, from 79 to 149 ha.</p>`,
    stats: [["Active", "44", "mining sites"], ["Newly dug", "446", "ha, Jul–Oct"], ["Ponds", "+88", "% open water"]],
    key: RADAR_KEY.filter(([, t]) => t !== "Town" && t !== "Burned ground").map((r) => r[1] === "Cleared land" ? ["#5f5a16", "Mining scars", "Stripped banks and spoil"] : r[1] === "River" ? ["#07040d", "Rivers & ponds"] : r),
    source: "NISAR L2 GCOV, track 103 ascending, 21 Jun and 19 Oct 2026 (provisional), as rendered by NASA GIBS, about 37 m per pixel. Mining sites and pond areas: team analysis, 3 Jul – 7 Oct 2026 (the 3 Jul image is shown wrongly coloured by GIBS, so the slider uses 21 Jun).",
  }),

  // 5 · Mamirauá: the flood drains from under the trees
  radarPart({
    kicker: "Mamirauá · Jun–Oct 2026", title: "Water under the trees",
    tags: ["25 Jun 2026", "23 Oct 2026"], ar: (1000 / 900).toFixed(3),
    a: "img/amazon_mamiraua_2026-06-25.jpg", b: "img/amazon_mamiraua_2026-10-23.jpg",
    alt: ["NISAR radar, 25 June 2026: the flooded forest between the river channels glows yellow", "NISAR radar, 23 October 2026: the same forest is green again; the flood has drained"],
    text: `<p>Each year the Amazon rises and falls by around ten metres, and huge stretches of forest stand in water for months: the várzea. From above, the green roof of the canopy looks the same either way.</p>
      <p>Radar sees underneath. When the forest floor is flooded, the pulse bounces off the water, then off the tree trunks and straight back, and the flooded forest lights up yellow. At Mamirauá, 540 km upstream of Manaus, it covered 86,860 ha in mid-July 2026. By late October only 6,170 ha were left.</p>`,
    stats: [["19 Jul 2026", "86,860", "ha flooded forest"], ["23 Oct 2026", "6,170", "ha flooded forest"], ["Change", "−93", "%"]],
    key: [["#c9d01f", "Flooded forest", "Water under the canopy"], ["#51b01c", "Dry forest"], ["#07040d", "River & lakes"]],
    source: "NISAR L2 GCOV, track 161 ascending, 25 Jun and 23 Oct 2026 (provisional; 23 Oct validated), as rendered by NASA GIBS, about 44 m per pixel. Flooded forest: team analysis of 9 passes, where the HH echo of floodplain forest exceeds that of nearby dry-land forest.",
  }),

  // 6 · the river gauge from orbit (two charts, one time axis)
  `<div class="kn-part am-part">
    <figure class="am-chart-fig">
      <div class="am-chart" id="am-chart-river"></div>
      <figcaption>Top: Port of Manaus river level, as logged by the team’s analysis. Bottom: flooded forest at Mamirauá on each NISAR pass, track 161. Dots are NISAR passes.</figcaption>
      <details class="am-table"><summary>Numbers</summary><table>
        <tr><th>NISAR pass</th><th>Flooded forest, ha</th><th>Manaus level, m</th></tr>
        ${FLOOD.map(([t, v]) => `<tr><td>${fmtD(t)}</td><td>${nf.format(Math.round(v))}</td><td>${gaugeAt(t).toFixed(2)}</td></tr>`).join("")}</table></details>
    </figure>
    <aside class="zoom-info"><div class="zoom-head"><span class="zoom-lbl">Manaus · Jul–Nov 2026</span></div>
      <h3>A river gauge in orbit</h3>
      <p>Downstream, the Port of Manaus measures the river every day. In 2026 it fell by 12.1 m, from 28.5 m on 1 July to 16.4 m in mid-October, low enough to trouble the boats that carry the city’s goods.</p>
      <p>The flooded forest at Mamirauá drained in step with it. Water passes Mamirauá first, so in this first season the radar signal there matched the Manaus level up to 24 days ahead, typically to within about 1.5 m. Nine passes are too few to call that a forecast yet, but it works through cloud, with no gauge on the ground.</p>
      ${stats([["Manaus", "−12.1", "m, Jul–Oct"], ["Tracked", "r 0.96", "radar vs gauge"], ["Ahead", "24", "days, early result"]])}</aside>
  </div>`,

  // 7 · what it means
  `<div class="kn-end"><span class="zoom-lbl">Amazon · what it means</span><h3>Watching through the clouds</h3>
    <ol class="kn-time">
      <li><b>12 days</b><span>A new radar look, cloud or not</span></li>
      <li><b>467 ha</b><span>Forest cleared at Novo Progresso</span></li>
      <li><b>+88%</b><span>Gold-dredging ponds on the Crepori</span></li>
      <li><b>−12 m</b><span>River drop, seen under the canopy</span></li>
      <li class="now"><b>0.1 ha</b><span>Smallest clearing one pass can flag</span></li></ol>
    <p>Much of the forest is watched from space by cameras, and cameras stop at clouds. In the wettest months, a clearing can go unseen for weeks.</p>
    <p>NISAR adds a look every 12 days that clouds cannot block. In the team’s tests on held-out passes, one pass was enough to flag a fresh clear-cut of a tenth of a hectare. Modelled for the cloudiest months, that raises the alarm about 6 days after a cut on average, against about 47 days for a camera satellite. And the same passes show the rivers rising and falling under the trees. The data is free.</p>
    <p class="kn-caveat">Prototype: NISAR products are provisional; clearings, ponds and flooded forest use simple thresholds on NASA GIBS images, and the detection and delay figures are modelled. Research and data by team <code>holy@hack:~$</code>.</p></div>`,

  // 8 · sources
  `<div class="kn-refs-part"><span class="zoom-lbl">Amazon · sources</span><h3>Sources & data</h3>
    <div class="kn-refs-cols">
      <section><h4>Satellite data</h4><ul>
        <li>NISAR L2 GCOV, tracks 103 and 161 ascending, Jun–Oct 2026. NASA/JPL-Caltech, ISRO, provisional; rendered by <a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noopener">NASA GIBS</a>, catalogue via <a href="https://search.asf.alaska.edu/" target="_blank" rel="noopener">ASF DAAC</a>.</li>
        <li>HLS Sentinel-2 (HLSS30) true colour, Dec 2025 – Mar 2026: NASA/USGS, with ESA Copernicus Sentinel-2 data; via NASA GIBS. <a href="https://lpdaac.usgs.gov/products/hlss30v002/" target="_blank" rel="noopener">LP DAAC</a></li>
        <li>561 NISAR granules over 8 Amazon areas were catalogued; 95 GIBS images analysed.</li></ul></section>
      <section><h4>Method</h4><ul>
        <li>Clearings: HV echo compared with a ring of intact forest around each patch, 7 passes, clusters of 5 ha or more.</li>
        <li>Ponds: very dark HV (calm water). Flooded forest: floodplain HH echo above dry-land forest.</li>
        <li>Alerts: a Kalman filter and CUSUM test on 6,815 held-out patches; false-alarm rate 1 in 1,000, 95% detection.</li>
        <li>Camera delay: a 5-day revisit at 75–90% cloud cover, modelled.</li></ul></section>
      <section><h4>Places & gauge</h4><ul>
        <li>Novo Progresso and the BR-163 highway, and the Rio Crepori, both in Pará; Mamirauá Sustainable Development Reserve, Amazonas.</li>
        <li>River level: Port of Manaus daily readings, Jun–Nov 2026, as logged in the team’s analysis.</li>
        <li>Brazil outline: Natural Earth via <a href="https://github.com/topojson/world-atlas" target="_blank" rel="noopener">world-atlas</a>.</li></ul></section>
    </div></div>`,
];

/* ---------- the relief map (same treatment as the Poland map in poland.js) ---------- */
const topo = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json").then((r) => r.json());
const br = feature(topo, topo.objects.countries).features.find((f) => f.id === "076");
// the mainland alone (no offshore islands): the relief picture is cropped to it, so the texture is fitted to it
const brMain = { type: "Feature", geometry: { type: "Polygon", coordinates: br.geometry.type === "Polygon" ? br.geometry.coordinates
  : br.geometry.coordinates.reduce((a, b) => (b[0].length > a[0].length ? b : a)) } };
let proj, pin, texData = null;
// shaded relief of Brazil by Miguel Valenzuela (GMTED2010, SAD69 Brazil Polyconic), cropped to the land (no scan
// filter, unlike img/poland-relief.jpg). Paper and shadow pixels are filled from the nearest land so
// small outline differences never show the paper (as in poland.js)
const isPaper = (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); return (mx > 150 && mx - mn < 22) || (mx > 70 && mx - mn < 16); };
function bleedLand(img) {
  const { width: W, height: H, data: d } = img, N = W * H, dist = new Uint8Array(N), queue = new Int32Array(N);
  let head = 0, tail = 0;
  for (let i = 0; i < N; i++) if (isPaper(d, i * 4)) dist[i] = 255; else queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++], x = i % W, nd = dist[i] + 1;
    if (nd > 60) continue;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= N || dist[j] !== 255) continue;
      dist[j] = nd; d[j * 4] = d[i * 4]; d[j * 4 + 1] = d[i * 4 + 1]; d[j * 4 + 2] = d[i * 4 + 2];
      queue[tail++] = j;
    }
  }
}
const relief = new Image();
relief.onload = () => draw();
relief.src = "img/brazil-relief.jpg?v=3";
function draw() {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;                       // not laid out yet
  cv.width = w * dpr; cv.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  proj = geoMercator().fitExtent([[12, 12], [w - 12, h - 12]], br);
  const W = Math.round(w * dpr), H = Math.round(h * dpr), off = document.createElement("canvas");
  off.width = W; off.height = H;
  const octx = off.getContext("2d"), img = octx.createImageData(W, H), d = img.data, FLAT = [42, 24, 84];   // same violet + grain as Poland
  for (let i = 0; i < W * H; i++) { const n = (Math.random() - 0.5) * 16; d[i * 4] = FLAT[0] + n; d[i * 4 + 1] = FLAT[1] + n; d[i * 4 + 2] = FLAT[2] + n; d[i * 4 + 3] = 255; }
  octx.putImageData(img, 0, 0);
  ctx.save(); ctx.beginPath(); geoPath(proj, ctx)(br); ctx.clip(); ctx.drawImage(off, 0, 0, w, h);
  if (relief.complete && relief.naturalWidth) {
    const [[bx0, by0], [bx1, by1]] = geoPath(proj).bounds(br);
    // shrink the texture smoothly to about its on-screen size first, so fine detail averages out (no moiré)
    const tw = Math.max(64, Math.round((bx1 - bx0) * dpr * 1.1));
    if (!texData || texData.width !== tw) {
      const t = document.createElement("canvas"); t.width = tw; t.height = Math.round(tw * relief.naturalHeight / relief.naturalWidth);
      const tc = t.getContext("2d"); tc.imageSmoothingQuality = "high"; tc.drawImage(relief, 0, 0, t.width, t.height);
      texData = tc.getImageData(0, 0, t.width, t.height);
      bleedLand(texData);
    }
    const TW = texData.width, TH = texData.height, td = texData.data;
    const tm = geoPolyconic().rotate([54, 0]).fitSize([TW, TH], brMain);           // the picture's own projection
    const X0 = Math.max(0, Math.floor(bx0 * dpr)), X1 = Math.min(W, Math.ceil(bx1 * dpr)), Y0 = Math.max(0, Math.floor(by0 * dpr)), Y1 = Math.min(H, Math.ceil(by1 * dpr));
    const out = octx.createImageData(W, H), od = out.data;
    for (let py = Y0; py < Y1; py++) for (let px = X0; px < X1; px++) {
      const ll = proj.invert([px / dpr, py / dpr]), t = ll && tm(ll);
      if (!t) continue;
      const tx = Math.min(TW - 1, Math.max(0, t[0] | 0)), ty = Math.min(TH - 1, Math.max(0, t[1] | 0)), s = (ty * TW + tx) * 4, o = (py * W + px) * 4;
      if (isPaper(td, s)) continue;                                // still paper: leave the violet base
      od[o] = td[s]; od[o + 1] = td[s + 1]; od[o + 2] = td[s + 2]; od[o + 3] = 255;
    }
    octx.putImageData(out, 0, 0);
    ctx.drawImage(off, 0, 0, w, h);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(214,222,252,.35)"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
  ctx.beginPath(); geoPath(proj, ctx)(br); ctx.stroke(); ctx.setLineDash([]);
  if (!pin) {
    pin = document.createElement("button");
    pin.className = "pin dot circles zoomable";
    pin.innerHTML = `<span class="ring"></span><span class="lbl">${PIN.name}</span>`;
    pin.setAttribute("aria-label", `${PIN.name}: open the story`);
    pin.addEventListener("click", zoomTo);
    wrap.appendChild(pin);
    if (location.hash === "#story") setTimeout(zoomTo, 400);   // amazon.html#story opens straight into the story
  }
  const [x, y] = proj([PIN.lon, PIN.lat]);
  pin.style.left = (x / w) * 100 + "%"; pin.style.top = (y / h) * 100 + "%";
}
new ResizeObserver(draw).observe(wrap);
document.getElementById("am-open").addEventListener("click", zoomTo);

/* ---------- the zoom story ---------- */
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
let open = null;
function zoomTo() {
  if (open || !pin) return;
  const pr = pin.getBoundingClientRect(), x = pr.left + pr.width / 2, y = pr.top + pr.height / 2, wr = wrap.getBoundingClientRect();
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 2;
  const ov = document.createElement("div");
  ov.className = "zoom-to"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Amazon: through the clouds");
  ov.innerHTML = `<button class="zoom-close" type="button" aria-label="Close and zoom back out">Close ✕</button>
    <div class="zoom-track">${PARTS.map((h, i) => `<section class="zoom-panel${h.includes("kn-part") ? " kn-panel" : ""}" aria-label="Part ${i + 1}">${h.includes("kn-end") || h.includes("kn-refs-part") ? `<div class="zoom-extra">${h}</div>` : h}</section>`).join("")}</div>
    <div class="zoom-progress" aria-hidden="true"><i></i></div><div class="zoom-hint" aria-hidden="true">Scroll →</div>`;
  document.body.appendChild(ov);
  const track = ov.querySelector(".zoom-track");
  open = { ov, x, y, R, back: document.activeElement };
  document.documentElement.style.overflow = "hidden";
  ov.querySelector(".zoom-close").addEventListener("click", zoomOut);
  ov.querySelector(".zoom-close").focus({ preventScroll: true });
  sideways(ov);
  ov.querySelectorAll(".am-cmp").forEach(slider);
  chartNP(ov.querySelector("#am-chart-np"));
  chartRiver(ov.querySelector("#am-chart-river"));
  watchPanels(ov);

  const T = reduce.matches ? 0 : 1000, ease = "cubic-bezier(.7,0,.25,1)";
  wrap.style.transformOrigin = `${x - wr.left}px ${y - wr.top}px`;
  wrap.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(7)", opacity: 0 }], { duration: T, easing: ease, fill: "forwards" });
  ov.animate([{ clipPath: `circle(9px at ${x}px ${y}px)` }, { clipPath: `circle(${R}px at ${x}px ${y}px)` }], { duration: T, easing: ease, fill: "forwards" });
  track.style.transformOrigin = `${x}px ${y}px`;
  track.animate([{ transform: "scale(.15)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: T, easing: ease, fill: "forwards" });
}
function zoomOut() {
  if (!open) return;
  const { ov, x, y, R, back } = open, T = reduce.matches ? 0 : 750, ease = "cubic-bezier(.6,0,.3,1)";
  open = null;
  ov.animate([{ clipPath: `circle(${R}px at ${x}px ${y}px)` }, { clipPath: `circle(0px at ${x}px ${y}px)` }], { duration: T, easing: ease, fill: "forwards" });
  ov.querySelector(".zoom-track").animate([{ transform: "scale(1)" }, { transform: "scale(.15)" }], { duration: T, easing: ease, fill: "forwards" });
  wrap.getAnimations().forEach((a) => a.cancel());
  wrap.animate([{ transform: "scale(7)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: T, easing: ease });
  setTimeout(() => { ov.remove(); document.documentElement.style.overflow = ""; back?.focus?.({ preventScroll: true }); }, T + 30);
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape") zoomOut();
  else if (open && (e.key === "ArrowRight" || e.key === "ArrowLeft") && e.target.type !== "range") open.go?.(e.key === "ArrowRight" ? 1 : -1);
});

// sideways scrolling: the wheel moves the row continuously, arrow keys glide, a thin line shows progress (as in poland.js)
function sideways(ov) {
  const track = ov.querySelector(".zoom-track"), bar = ov.querySelector(".zoom-progress i"), hint = ov.querySelector(".zoom-hint");
  open.go = (d) => track.scrollBy({ left: d * track.clientWidth * 0.85, behavior: reduce.matches ? "auto" : "smooth" });
  track.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    track.scrollLeft += d * (e.deltaMode === 1 ? 40 : 1);
  }, { passive: false });
  const update = () => {
    const max = track.scrollWidth - track.clientWidth;
    bar.style.transform = `scaleX(${max > 0 ? track.scrollLeft / max : 0})`;
    hint.classList.toggle("gone", track.scrollLeft > 40);
  };
  track.addEventListener("scroll", update, { passive: true });
  update();
}

// a radar slider: drag to compare; a date label hides while its side is fully covered
function slider(box) {
  const r = box.querySelector("input"), tags = box.parentElement.querySelectorAll(".zoom-tags span");
  const show = (cut) => { tags[0].classList.toggle("gone", cut <= 2); tags[1].classList.toggle("gone", cut >= 98); };
  r.addEventListener("input", () => { box.getAnimations().forEach((a) => a.cancel()); box.style.setProperty("--cut", r.value + "%"); show(+r.value); });
  box._sweep = () => {                      // the first time the part comes into view, sweep the seam across once
    if (box._swept || reduce.matches) return;
    box._swept = true;
    const a = box.animate([{ "--cut": "50%" }, { "--cut": "100%" }, { "--cut": "6%" }, { "--cut": "50%" }], { duration: 2600, delay: 250, easing: "ease-in-out" });
    const follow = () => { if (a.playState !== "running" && a.playState !== "pending") return; show(parseFloat(getComputedStyle(box).getPropertyValue("--cut"))); requestAnimationFrame(follow); };
    requestAnimationFrame(follow);
    a.finished.then(() => { box.style.setProperty("--cut", "50%"); show(50); }).catch(() => show(+r.value));
  };
}
// mark the part in the middle of the screen; start its slider sweep
function watchPanels(ov) {
  const track = ov.querySelector(".zoom-track"), panels = [...ov.querySelectorAll(".zoom-panel")];
  const check = () => {
    const W = track.clientWidth, sx = track.scrollLeft;
    for (const p of panels) {
      const c = p.offsetLeft + p.offsetWidth / 2 - sx, on = c > W * 0.2 && c < W * 0.8;
      p.classList.toggle("on", on);
      if (on) p.querySelector(".am-cmp")?._sweep();
    }
  };
  track.addEventListener("scroll", check, { passive: true });
  addEventListener("resize", check);
  setTimeout(check, reduce.matches ? 0 : 900);
}

/* ---------- charts: thin lines, direct labels, recessive grid, crosshair + tooltip ---------- */
function chart(host, cfg) {
  const { panels, x0, x1, xticks, stops, tip, aria } = cfg;
  const W = 760, L = 50, R = 120, T = 26, GAP = 48, B = 28;
  const H = T + panels.reduce((s, p) => s + p.h, 0) + GAP * (panels.length - 1) + B;
  const X = (t) => L + (t - x0) / (x1 - x0) * (W - L - R);
  let s = "", top = T;
  for (const p of panels) {
    const Y = (v) => top + (1 - (v - p.y[0]) / (p.y[1] - p.y[0])) * p.h;
    if (p.title) s += `<text class="am-ct" x="${L}" y="${top - 12}">${p.title}</text>`;
    for (const t of p.ticks) s += `<line class="am-grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="am-ax" x="${L - 8}" y="${Y(t) + 3.5}" text-anchor="end">${p.fmt(t)}</text>`;
    for (const se of p.series) {
      const pts = se.pts.map(([t, v]) => [X(t), Y(v)]);
      s += `<path class="am-ln" d="M${pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("L")}" stroke="${se.color}"${se.dash ? ` stroke-dasharray="${se.dash}"` : ""}/>`;
      if (se.dots) s += pts.map(([x, y]) => `<circle class="am-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${se.color}"/>`).join("");
      if (se.label) { const [lx, ly] = pts.at(-1); s += `<text class="am-lb" x="${(lx + 10).toFixed(1)}" y="${(ly + 4 + (se.dy || 0)).toFixed(1)}">${se.label}</text>`; }
    }
    top += p.h + GAP;
  }
  const bot = top - GAP;
  s += `<line class="am-x" x1="${L}" x2="${W - R}" y1="${bot}" y2="${bot}"/>`;
  for (const t of xticks) s += `<text class="am-ax" x="${X(t).toFixed(1)}" y="${bot + 18}" text-anchor="middle">${fmtM(t)}</text>`;
  s += `<line class="am-cross" x1="0" x2="0" y1="${T - 6}" y2="${bot}"/><rect class="am-hit" x="${L - 10}" y="${T - 10}" width="${W - L - R + 20}" height="${bot - T + 10}"/>`;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">${s}</svg><div class="am-tip" hidden></div>`;
  const svg = host.querySelector("svg"), cross = svg.querySelector(".am-cross"), tipEl = host.querySelector(".am-tip"), hit = svg.querySelector(".am-hit");
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect(), k = r.width / W, sx = (e.clientX - r.left) / k;
    const best = stops.reduce((b, t) => Math.abs(X(t) - sx) < Math.abs(X(b) - sx) ? t : b, stops[0]);
    cross.setAttribute("x1", X(best)); cross.setAttribute("x2", X(best)); cross.classList.add("on");
    tipEl.innerHTML = tip(best); tipEl.hidden = false;
    tipEl.style.left = X(best) * k + "px"; tipEl.classList.toggle("flip", X(best) > W * 0.55);
  });
  hit.addEventListener("pointerleave", () => { cross.classList.remove("on"); tipEl.hidden = true; });
}
function chartNP(host) {
  const labelDy = { "Old pasture": -6, "NP-07, cut and burned": 6 };     // keep the two lowest end labels apart
  chart(host, {
    aria: "Line chart: radar echo over Novo Progresso, June to October 2026. Intact forest stays near −11 dB; NP-01 slides to −15 dB; NP-07 drops from −12 to −20 dB between 27 July and 20 August, below old pasture at −19 dB.",
    x0: day("2026-06-14"), x1: day("2026-10-26"), xticks: ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map(day), stops: NP_DATES,
    panels: [{ h: 330, y: [-22, -10], ticks: [-22, -19, -16, -13, -10], fmt: (v) => v + " dB",
      series: NP_SERIES.map((s) => ({ color: s.color, dash: s.dash, dots: true, label: s.short, dy: labelDy[s.name], pts: NP_DATES.map((t, i) => [t, s.v[i]]) })) }],
    tip: (t) => { const i = NP_DATES.indexOf(t);
      return `<b>${fmtD(t)} 2026</b>${NP_SERIES.map((s) => `<span style="color:${s.color}"><i${s.dash ? ' class="dash"' : ""}></i><em style="color:var(--cream)">${s.short}</em>&nbsp;${s.v[i].toFixed(1)} dB</span>`).join("")}`; },
  });
}
function chartRiver(host) {
  const C = "#7584e6";
  chart(host, {
    aria: "Two line charts sharing a time axis. Top: the Port of Manaus river level falls from 28.5 m on 1 July to 16.4 m in mid-October 2026. Bottom: flooded forest at Mamirauá falls from 86,860 ha on 19 July to 6,170 ha on 23 October.",
    x0: day("2026-06-01"), x1: day("2026-11-11"), xticks: ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"].map(day),
    stops: FLOOD.map((p) => p[0]),
    panels: [
      { title: "Port of Manaus · river level", h: 150, y: [15, 30], ticks: [15, 20, 25, 30], fmt: (v) => v + " m",
        series: [{ color: C, pts: GAUGE, label: "16.4 m" }] },
      { title: "Mamirauá · flooded forest (NISAR)", h: 150, y: [0, 90000], ticks: [0, 30000, 60000, 90000], fmt: (v) => v / 1000 + "k ha",
        series: [{ color: C, dots: true, pts: FLOOD, label: "6,170 ha" }] },
    ],
    tip: (t) => `<b>${fmtD(t)} 2026</b><span>Flooded forest&nbsp;<em>${nf.format(Math.round(FLOOD.find((p) => p[0] === t)[1]))} ha</em></span><span>Manaus level&nbsp;<em>${gaugeAt(t).toFixed(1)} m</em></span>`,
  });
}
