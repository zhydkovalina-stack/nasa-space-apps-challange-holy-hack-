/* Poland as a dot matrix (Natural Earth outline via world-atlas). Dots warm up toward the
   study areas, so the map itself is a dotted gradient. Pins and the region list stay in sync. */
import { feature } from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { geoMercator, geoTransverseMercator, geoPath, geoContains } from "https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm";

const REGIONS = {
  knurow:       { lat: 50.220, lon: 18.679, name: "Knurów", dot: true, circles: 2 }   // dot with two thin circles; no card
  ,klodzko:    { lat: 50.438, lon: 16.654, name: "Kłodzko", dot: true, circles: 2, aria: "Kłodzko: open the story of the September 2024 flood" }
};
// places we plan to cover next: grey pins that open a small "coming soon" note
const SOON = {
  warszawa:  { lat: 52.23, lon: 21.01, name: "Warsaw",    topic: "How the Vistula and the ground under the city change through the year." },
  krakow:    { lat: 50.06, lon: 19.94, name: "Kraków",    topic: "Ground movement over the old Wieliczka salt mine." },
  gdansk:    { lat: 54.35, lon: 18.65, name: "Gdańsk",    topic: "Żuławy: farmland below sea level in the Vistula delta." },
  wroclaw:   { lat: 51.11, lon: 17.03, name: "Wrocław",   topic: "The Oder floodplain and the polders that protect the city." },
  poznan:    { lat: 52.41, lon: 16.93, name: "Poznań",    topic: "Our home town: the Warta valley and the city's lakes." },
  szczecin:  { lat: 53.43, lon: 14.55, name: "Szczecin",  topic: "The Oder lagoon, its wetlands and the port." },
  belchatow: { lat: 51.27, lon: 19.33, name: "Bełchatów", topic: "Europe's biggest lignite pit and the ground around it." },
  biebrza:   { lat: 53.55, lon: 22.65, name: "Biebrza",   topic: "Poland's largest marsh: L-band radar sees water under the reeds." },
};
const wrap = document.getElementById("pl-map"), cv = document.getElementById("pl"), ctx = cv.getContext("2d");
const topo = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json").then((r) => r.json());
const pl = feature(topo, topo.objects.countries).features.find((f) => f.id === "616");

const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const PERI = [143, 156, 242], IND = [90, 69, 194], PEACH = [255, 187, 130], RUST = [196, 87, 58];
let proj;
let texData = null;
// The relief picture's outline doesn't match our outline exactly, so along some coasts and borders our
// Poland reaches into the picture's pale paper background, which left violet gaps. Fix: grow the land
// outwards into the paper (each paper pixel takes the colour of the nearest land pixel, up to 60 px away),
// once per texture size, with a breadth-first flood from every land pixel.
const isPaper = (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); return (mx > 150 && mx - mn < 22) || (mx > 70 && mx - mn < 16); };   // pale paper, or the grey shadow and sea around the land (land is always tinted)
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
relief.src = "img/poland-relief.jpg";

function draw() {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = wrap.clientWidth, h = wrap.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  proj = geoMercator().fitExtent([[12, 12], [w - 12, h - 12]], pl);
  // one flat colour with grain (no colour gradients for now); the pins mark the study areas
  const hot = Object.values(REGIONS).filter((r) => !r.dot).map((r) => ({ p: proj([r.lon, r.lat]), live: r.live }));
  const W = Math.round(w * dpr), H = Math.round(h * dpr), off = document.createElement("canvas");
  off.width = W; off.height = H;
  const octx = off.getContext("2d"), img = octx.createImageData(W, H), d = img.data;
  const FLAT = [42, 24, 84];                                                     // deep violet, between plum and indigo
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = px / dpr, y = py / dpr;
    const col = FLAT;
    const p = (py * W + px) * 4, n = (Math.random() - 0.5) * 16;
    d[p] = col[0] + n; d[p + 1] = col[1] + n; d[p + 2] = col[2] + n; d[p + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.beginPath(); geoPath(proj, ctx)(pl); ctx.clip();
  ctx.drawImage(off, 0, 0, w, h);
  // relief texture (shaded SRTM relief map by Miguel Valenzuela, grainy scan filter). The source is drawn in
  // Poland's CS92 projection (transverse Mercator on 19°E), so each screen pixel is projected back to lon/lat
  // and looked up in the texture through that projection; the texture's own pale background shows as the base fill
  if (relief.complete && relief.naturalWidth) {
    const [[bx0, by0], [bx1, by1]] = geoPath(proj).bounds(pl);
    // shrink the texture smoothly to about the size it is shown at first, so its fine scan lines average out
    // instead of beating against the screen pixels (moiré)
    const tw = Math.max(64, Math.round((bx1 - bx0) * dpr * 1.1));
    if (!texData || texData.width !== tw) {
      const t = document.createElement("canvas"); t.width = tw; t.height = Math.round(tw * relief.naturalHeight / relief.naturalWidth);
      const tc = t.getContext("2d"); tc.imageSmoothingQuality = "high"; tc.drawImage(relief, 0, 0, t.width, t.height);
      texData = tc.getImageData(0, 0, t.width, t.height);
      bleedLand(texData);
    }
    const TW = texData.width, TH = texData.height, td = texData.data;
    const tm = geoTransverseMercator().rotate([-19, 0]).fitSize([TW, TH], pl);
    const X0 = Math.max(0, Math.floor(bx0 * dpr)), X1 = Math.min(W, Math.ceil(bx1 * dpr)), Y0 = Math.max(0, Math.floor(by0 * dpr)), Y1 = Math.min(H, Math.ceil(by1 * dpr));
    const out = octx.createImageData(W, H), od = out.data;
    for (let py = Y0; py < Y1; py++) for (let px = X0; px < X1; px++) {
      const ll = proj.invert([px / dpr, py / dpr]), t = ll && tm(ll);
      if (!t) continue;
      const tx = Math.min(TW - 1, Math.max(0, t[0] | 0)), ty = Math.min(TH - 1, Math.max(0, t[1] | 0)), s = (ty * TW + tx) * 4, o = (py * W + px) * 4;
      const r = td[s], g = td[s + 1], b = td[s + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (isPaper(td, s)) continue;                               // still paper (beyond 60 px of land): leave the base fill
      od[o] = r; od[o + 1] = g; od[o + 2] = b; od[o + 3] = 255;
    }
    octx.putImageData(out, 0, 0);
    ctx.drawImage(off, 0, 0, w, h);
  }
  ctx.restore();
  // outline as a hairline
  ctx.strokeStyle = "rgba(214,222,252,.35)"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
  ctx.beginPath(); geoPath(proj, ctx)(pl); ctx.stroke(); ctx.setLineDash([]);
  placePins();
}

const pins = {};
function placePins() {
  for (const [k, r] of Object.entries(REGIONS)) {
    let b = pins[k];
    if (!b) {
      if (r.dot) {
        b = pins[k] = document.createElement(ZOOM[k] ? "button" : "span");
        b.className = "pin dot" + (r.circles ? " circles" : "") + (ZOOM[k] ? " zoomable" : "");
        b.innerHTML = `<span class="ring"></span><span class="lbl">${r.name}</span>`;
        if (ZOOM[k]) { b.setAttribute("aria-label", r.aria || `${r.name}: zoom in to radar images from 2008 and 2026`); b.addEventListener("click", () => zoomTo(k)); }
        wrap.appendChild(b);
      } else {
      b = pins[k] = document.createElement("button");
      b.className = "pin" + (r.live ? " live" : "");
      b.innerHTML = `<span class="ring"></span><span class="lbl">${r.name}${r.live ? "" : " · soon"}</span>`;
      b.setAttribute("aria-label", `${r.name}${r.live ? ", open" : ", coming soon"}`);
      b.addEventListener("click", () => { const a = document.querySelector(`.region[data-r="${k}"]`); a.focus({ preventScroll: true }); if (ZOOM[k]) zoomTo(k); else if (r.live) location.href = a.href; else select(k); });
      b.addEventListener("mouseenter", () => select(k));
      wrap.appendChild(b);
      }
    }
    const [x, y] = proj([r.lon, r.lat]);
    b.style.left = (x / wrap.clientWidth) * 100 + "%"; b.style.top = (y / wrap.clientHeight) * 100 + "%";
  }
  for (const [k, r] of Object.entries(SOON)) {
    let b = pins["soon:" + k];
    if (!b) {
      b = pins["soon:" + k] = document.createElement("button");
      b.type = "button"; b.className = "pin dot soon";
      b.innerHTML = `<span class="ring"></span><span class="lbl">${r.name}</span>`;
      b.setAttribute("aria-label", `${r.name}: coming soon`);
      b.addEventListener("click", (e) => { e.stopPropagation(); showSoon(k, b); });
      wrap.appendChild(b);
    }
    const [x, y] = proj([r.lon, r.lat]);
    b.style.left = (x / wrap.clientWidth) * 100 + "%"; b.style.top = (y / wrap.clientHeight) * 100 + "%";
  }
  if (soonCard.dataset.k && !soonCard.hidden) showSoon(soonCard.dataset.k, pins["soon:" + soonCard.dataset.k]);   // keep it on its pin after a resize
}
// the "coming soon" note: one small card, placed next to the grey pin that was clicked
const soonCard = document.createElement("div");
soonCard.className = "pin-soon"; soonCard.hidden = true; soonCard.setAttribute("role", "status");
wrap.appendChild(soonCard);
function showSoon(k, pin) {
  const r = SOON[k];
  soonCard.dataset.k = k;
  soonCard.innerHTML = `<span class="pin-soon-tag">Coming soon</span><b>${r.name}</b><p>${r.topic}</p>`;
  soonCard.style.left = pin.style.left; soonCard.style.top = pin.style.top;
  soonCard.classList.toggle("left", parseFloat(pin.style.left) > 62);   // near the right edge: open to the left
  soonCard.hidden = false;
}
document.addEventListener("click", (e) => { if (!soonCard.hidden && !e.target.closest(".pin.soon, .pin-soon")) soonCard.hidden = true; });
addEventListener("keydown", (e) => { if (e.key === "Escape") soonCard.hidden = true; });
function select(k) {
  document.querySelectorAll(".region").forEach((a) => a.classList.toggle("sel", a.dataset.r === k));
  Object.entries(pins).forEach(([kk, b]) => b.classList.toggle("sel", kk === k));
}
document.querySelectorAll(".region").forEach((a) => a.addEventListener("mouseenter", () => select(a.dataset.r)));

// Zoom-in: clicking a region's pin dives the map toward it while a circle opens out of the pin onto a
// before/after satellite swipe of that place (same recolouring as konin.html). Closing zooms back out.
const ZOOM = {
  knurow: { a: "img/knurow_aerial_2023.jpg", b: "img/knurow_sar_2026_sinking.jpg", base: "", raw: true, label: "2023 photo | 2026 radar",
            kicker: "Knurów", title: "A town that keeps sinking",
            note: "After more than a century of mining, the ground under Knurów is still moving. Between June and October 2026, NISAR measured parts of it sinking at least 39 cm, at times more than 5 mm a day. It sees this through cloud and darkness, every 12 days, without anyone going there. The mine’s own plans forecast up to 10 m more by 2040.",
            stats: [["1936–1997", "18", "m deepest drop"], ["2008–2017", "5", "m in nine years"], ["Jun–Oct 2026", "39", "cm in four months (NISAR)"]],
            key: [["#ee2a1e", "Sank Jun–Oct 2026", "Deeper red = more · lines at 10, 20, 30 cm"], ["#0b0b0c", "Water"], ["#f4f1ec", "Town & forest"], ["#77777d", "Fields"]],
            // parts before the NISAR slider, in story order (scroll sideways). The 1933 map starts as an inverted background
            // behind part 1 and turns into the framed original in part 2 (see introMap).
            map33: { src: "img/knurow_wig1933.jpg", ar: 2400 / 2161 },
            panels: [`<div class="kn-end"><span class="zoom-lbl">Knurów · what it means</span><h3>Watching the ground move</h3>
              <ol class="kn-time">
                <li><b>1903</b><span>First shafts dug</span></li>
                <li><b>18 m</b><span>Deepest drop, 1936–1997</span></li>
                <li><b>1997</b><span>Flood fills the sunken hollows</span></li>
                <li class="now"><b>39 cm</b><span>In four months, 2026: NISAR</span></li>
                <li><b>10 m</b><span>More forecast by 2040</span></li></ol>
              <p>For a century, Knurów’s sinking was measured after the fact: surveyors on the ground, maps made decades apart. NISAR measures it while it happens, for the whole town at once, every 12 days, through cloud and darkness, and its data is free.</p>
              <p>That turns subsidence from history into a warning. Residents, the town and the mine can see where the ground is dropping now, and where to look before walls crack or hollows flood.</p></div>`,
              `<div class="kn-refs-part"><span class="zoom-lbl">Knurów · sources</span><h3>Sources & data</h3>
              <div class="kn-refs-cols">
                <section><h4>Research</h4><ul>
                  <li>Wojciechowski, T. (2007). Osiadanie powierzchni terenu pod wpływem eksploatacji węgla kamiennego na przykładzie rejonu miasta Knurowa. <i>Przegląd Geologiczny</i> 55(7): 589–594. <a href="https://geojournals.pgi.gov.pl/pg/article/view/31759" target="_blank" rel="noopener">link</a></li>
                  <li>Pala, P. (2022). Deformacje terenu okolic Knurowa spowodowane podziemną eksploatacją węgla kamiennego. <i>Prace Komisji Krajobrazu Kulturowego</i> 47(1): 7–20. <a href="https://doi.org/10.30450/202201" target="_blank" rel="noopener">doi</a></li>
                  <li>Jaruchiewicz, E. (2014). The role of anthropogenic water reservoirs within the landscapes of mining areas: a case study from the western part of the Upper Silesian Coal Basin. <i>Environmental &amp; Socio-economic Studies</i> 2(1): 16–26. <a href="https://doi.org/10.1515/environ-2015-0028" target="_blank" rel="noopener">doi</a></li>
                  <li>Przyłucka, M., Kowalski, Z., Perski, Z. (2022). Twenty years of coal mining-induced subsidence in the Upper Silesia in Poland identified using InSAR. <i>International Journal of Coal Science &amp; Technology</i>. <a href="https://doi.org/10.1007/s40789-022-00541-w" target="_blank" rel="noopener">doi</a></li>
                  <li>JSW: Knurów mine is 120 years old (shaft dates). <a href="https://jsw.pl/en/press-office/news/article/knurow-mine-is-120-years-old" target="_blank" rel="noopener">link</a></li></ul></section>
                <section><h4>Satellite data</h4><ul>
                  <li>NISAR L2 GUNW, 9 pairs, track 57 ascending, 18 Jun – 16 Oct 2026 (sinking). NASA/JPL-Caltech, ISRO, provisional; via <a href="https://search.asf.alaska.edu/" target="_blank" rel="noopener">ASF DAAC</a>.</li>
                  <li>NISAR L2 GSLC, track 57, 30 Jun, 12 Jul, 24 Jul 2026 (10 m radar image). Same source.</li>
                  <li>Processing: ionosphere removed, coherence ≥ 0.35, atmosphere filtered (~6 km), pairs added up. Line-of-sight motion; the total is a minimum.</li></ul></section>
                <section><h4>Maps &amp; photos</h4><ul>
                  <li>WIG 1:25 000, sheet P48 S27 C “Knurów”, 1933. Biblioteka Narodowa, via <a href="http://igrek.amzp.pl/result.php?cmd=id&amp;god=P48_S27_C&amp;cat=WIG25" target="_blank" rel="noopener">igrek.amzp.pl</a>.</li>
                  <li>Aerial photos 1997 and 2023, terrain heights (NMT): <a href="https://www.geoportal.gov.pl/" target="_blank" rel="noopener">Geoportal.gov.pl</a>, GUGiK.</li>
                  <li>Postcard, Knurów about 1903–1905: <a href="https://fotopolska.eu/Knurow/WszystkieZdjecia/b654,Kopalnia_Wegla_Kamiennego_Knurow.html" target="_blank" rel="noopener">fotopolska.eu</a>.</li>
                  <li>Staw Moczury, 2010: Mikołaj Welon, CC BY-SA 3.0, <a href="https://commons.wikimedia.org/wiki/File:Stawmoczuryfromthesky.jpg" target="_blank" rel="noopener">Wikimedia Commons</a>.</li>
                  <li>Lakes: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.</li></ul></section>
              </div></div>`],
            before: [
              `<div class="kn-part kn-1903">
                <figure class="kn-pc hud"><img src="img/knurow_postcard_1903.jpg" alt="Postcard: two wooden shaft towers and spoil heaps in a field, Knurów, about 1903–1905">
                  <figcaption>Knurów, about 1903–1905: wooden towers over the first two shafts. Postcard, via fotopolska.eu</figcaption></figure>
                <aside class="zoom-info"><div class="zoom-head"><span class="zoom-lbl">Knurów · 1903</span></div>
                  <h3>The first shafts</h3>
                  <p>On 15 June 1903 workers started digging the first shaft of the royal Prussian mine at Knurów. The second followed in December. While the shafts were dug, two wooden towers stood over them.</p>
                  <p class="kn-hook">This summer, NISAR measured parts of this town sinking 39 cm in four months. This is how it got there.</p></aside>
              </div>`,
              `<div class="kn-part kn-1933">
                <figure class="kn-map33"><img src="img/knurow_wig1933.jpg" alt="Polish military map of Knurów and Gierałtowice, 1933, with the German border along its edge">
                  <span class="kn-pt" style="left:33.48%;top:42.64%"><i></i><b>246.2 m in 1933 · 236.6 m today</b></span>
                  <figcaption>Polish military map (WIG) 1:25 000, sheet P48 S27 C “Knurów”, 1933. Biblioteka Narodowa, via igrek.amzp.pl</figcaption></figure>
                <aside class="zoom-info"><div class="zoom-head"><span class="zoom-lbl">Knurów · 1933</span></div>
                  <h3>Nine metres since 1933</h3>
                  <p>Every height on this 1933 Polish military map was surveyed. East of Knurów, one survey point reads 246.2 m above sea level.</p>
                  <p>Today’s laser-scanned terrain puts the same spot at 236.6 m: <b>about 9 m lower</b>. It lies right beside the ground NISAR sees sinking now.</p>
              </div>`,
              `<div class="kn-part kn-1997">
                <figure class="kn-fig">
                  <div class="zoom-tags" aria-hidden="true"><span>1933 map</span><span>1997 photo</span></div>
                  <div class="kn-cmp hud"><img src="img/knurow_map1933_frame.jpg" alt="1933 map of Knurów and Gierałtowice"><img src="img/knurow_aerial_1997.jpg" alt="Aerial photo of the same area, 1997"><div class="seam"></div>
                    <input type="range" min="0" max="100" value="50" aria-label="1933 map versus 1997 photo"></div>
                  <figcaption>Same area, 18°40′–18°50′ E, 50°10′–50°15′ N: WIG map 1933 (Biblioteka Narodowa, via igrek.amzp.pl) and Geoportal.gov.pl aerial photo 1997 (GUGiK; two small gaps filled from 2003). Lined up from the map’s printed corners, to within about 100 m.</figcaption></figure>
                <aside class="zoom-info"><div class="zoom-head"><span class="zoom-lbl">Knurów · 1936–1997</span></div>
                  <h3>Eighteen metres down</h3>
                  <p>Geologist Tomasz Wojciechowski turned topographic maps from 1936 and 1997 into 3D models of the terrain and measured the difference. He checked it against geological maps and the mine’s plans of the 29 seams it had dug out. Satellite radar (an ERS interferogram from early 1998) then showed him new sinking basins forming above the coal being mined.</p>
                  <p>Parts of Knurów had sunk by up to 18 m: the height of a six-storey building. More than half of the town was at least a metre lower. In Szczygłowice, a housing estate was flooded.</p>
                  <dl class="zoom-stats"><div><dt>Deepest drop</dt><dd>18<small>m, 1936–1997</small></dd></div><div><dt>Knurów</dt><dd>57<small>% sank 1 m or more</small></dd></div><div><dt>Ground drop</dt><dd>75<small>% of the coal removed</small></dd></div></dl></aside>
                <div class="kn-coal-col"><figure class="kn-coal"></figure>
                  <p class="kn-coal-note">Under the Szczygłowice district alone, coal was mined from 29 seams. Where it is taken out, the ground above drops by about three-quarters of the coal’s thickness.</p></div>
              </div>`,
              `<div class="kn-part kn-lakes">
                <figure class="kn-fig">
                  <div class="kn-lakemap hud"><img src="img/knurow_lakes_1997.jpg" alt="1997 aerial photo with today’s lakes outlined in blue">
                    <span class="kn-box" style="left:11.2%;top:30.2%;width:5.9%;height:8.3%"></span>
                    <span class="kn-zoom"><img src="img/knurow_moczury_2010.jpg" alt="Staw Moczury from the air, with the A1 motorway viaduct across it, October 2010"><b>Staw Moczury, 2010</b></span></div>
                  <figcaption>Blue: lakes and ponds today (OpenStreetMap) over the 1997 aerial photo (Geoportal.gov.pl, GUGiK; two small gaps filled from 2003). Close-up: Staw Moczury, October 2010, photo Mikołaj Welon, CC BY-SA 3.0, Wikimedia Commons.</figcaption></figure>
                <aside class="zoom-info"><div class="zoom-head"><span class="zoom-lbl">Knurów · 1997</span></div>
                  <h3>The hollows fill with water</h3>
                  <p>Sinking left parts of Knurów several metres below the streams around them, with nowhere for water to drain. In the 1997 flood, these hollows filled with water.</p>
                  <p>Most of the ponds and lakes around Knurów began this way, in sunken ground and old pits. Local names say it: Zatopy (“drowned”), Zalane (“flooded”). Staw Moczury, outlined in red, is a lake today with the A1 motorway crossing it. On the 1933 map, there is no lake there at all.</p>
                  <p>The damage reaches buildings too: not only their structure but also finishes and fittings, which leads to many further problems and social conflicts.</p></aside>
              </div>`],
            source: "Left: Geoportal.gov.pl aerial photo, 2023 (GUGiK). Right: NISAR GSLC, track 57, HH, average of 30 Jun, 12 Jul and 24 Jul 2026, 10 m. Red: total sinking from 9 back-to-back NISAR GUNW pairs, 18 Jun – 16 Oct 2026, line of sight, processed by the team; a minimum, as one 24-day pair (24 Jul – 17 Aug) could not be measured at the deepest spot. The strongest single pair, 12–24 Jul, showed 8.7 cm. Figures: Wojciechowski 2007 (1936–1997); Pala 2022, from the mine's own maps (2008–2017)." }
,
  // The September 2024 flood: radar mapped it through the cloud (Copernicus EMSR756); NISAR's L-band goes further.
  // Every figure below is from Copernicus EMS (EMSR756 report, statistics page, Information Bulletin 173) or NASA.
  klodzko: { a: "img/flood_landsat_20240904.jpg", b: "img/flood_landsat_20240920.jpg", base: "", raw: true, label: "4 Sep 2024 | 20 Sep 2024",
            kicker: "Odra near Wrocław", title: "The same river, sixteen days apart",
            note: "Landsat 8 took these two pictures of the Odra near Wrocław before and after the flood. They are optical images: the second could only be taken once the cloud had cleared. By then, radar satellites had already been mapping the water for a week.",
            stats: [["EMSR756", "34,158", "ha at the maximum"], ["Buildings", "2,687", "affected"], ["People", "15,160", "affected"]],
            key: [["#14275e", "Water", "Dark blue in this false-colour image"]],
            panels: [`<div class="kn-end"><span class="zoom-lbl">Flood 2024 · what NISAR adds</span><h3>Seeing it through the cloud and the trees</h3>
              <ol class="kn-time">
                <li><b>11–18 Sep</b><span>Storm stalls over central Europe</span></li>
                <li><b>13 Sep</b><span>Poland activates Copernicus, 12:50 UTC</span></li>
                <li><b>14 Sep</b><span>First flood map, from radar</span></li>
                <li><b>17 Sep</b><span>First optical images used</span></li>
                <li class="now"><b>Jul 2025</b><span>NISAR launches</span></li></ol>
              <p>NISAR was not in orbit for this flood. Its 24 cm L-band radar is a longer wavelength than Sentinel-1's C-band, and NASA says it passes through leaves and branches to the trunks and the ground, so it can track floods under vegetation. It covers nearly all land twice every 12 days, day and night, through cloud.</p>
              <p>It also measures ground movement. NASA and the US Army Corps of Engineers expect it to help flag dams and levees that are starting to move, the kind of failure that hit Stronie Śląskie.</p></div>`,
              `<div class="kn-end fl-next"><span class="zoom-lbl">Flood 2024 · next time</span><h3>Preventing it, and seeing it sooner</h3>
              <p>NISAR, the NASA-ISRO Synthetic Aperture Radar, can't stop the rain. What it can do is show where the ground, the forest and the dams are giving way before the next storm, and map the water while it is still falling.</p>
              <div class="fl-cols">
                <section><h4>Before the storm</h4><ul>
                  <li><b>Wet ground.</b> Soil-moisture maps at 200 m, at least twice every 12 days. A basin that is already soaked will shed the next storm. The product is still provisional and unreliable under dense forest.</li>
                  <li><b>Forest and slopes.</b> L-band sees through the canopy to stands that have been thinned or cleared; interferometry picks up slopes that start to slide.</li>
                  <li><b>Dams and levees.</b> Ground movement of a few millimetres a month can flag an embankment that is slowly shifting, before a storm tests it.</li></ul></section>
                <section><h4>During and after</h4><ul>
                  <li><b>Through the cloud.</b> Flood maps day or night. Standard data arrives 36–72 hours after a pass; about 6 hours when USGS, NOAA or NASA request urgent processing.</li>
                  <li><b>Under the trees.</b> Water in flooded forest, which shorter C-band radar mostly misses.</li>
                  <li><b>Afterwards.</b> Repeat passes show which fields drained and which are still under water.</li></ul></section>
              </div></div>`,
              `<div class="kn-refs-part"><span class="zoom-lbl">Flood 2024 · sources</span><h3>Sources & data</h3>
              <div class="kn-refs-cols">
                <section><h4>Copernicus EMS</h4><ul>
                  <li>Flood in South West Poland, EMSR756 situational reporting (SERTIT). <a href="https://storymaps.arcgis.com/stories/106b44ce3d154db99c22ec79b8e5ff8e" target="_blank" rel="noopener">link</a></li>
                  <li>EMSR756 activation statistics. <a href="https://mapping.emergency.copernicus.eu/activations/EMSR756/stats" target="_blank" rel="noopener">link</a></li>
                  <li>Information Bulletin 173: floods in Central and Eastern Europe. <a href="https://mapping.emergency.copernicus.eu/news/information-bulletin-173-the-copernicus-emergency-management-service-monitors-floods-in-central-and-eastern-europe/" target="_blank" rel="noopener">link</a></li>
                  <li>EMSR756 map products. <a href="https://rapidmapping.emergency.copernicus.eu/EMSR756/download" target="_blank" rel="noopener">link</a></li></ul></section>
                <section><h4>NASA</h4><ul>
                  <li>NASA Earth Observatory, Rivers in Europe Burst Their Banks, 24 Sep 2024. <a href="https://science.nasa.gov/earth/earth-observatory/rivers-in-europe-burst-their-banks-153358/" target="_blank" rel="noopener">link</a></li>
                  <li>NASA JPL, NASA-ISRO Satellite Lifts Off to Track Earth's Changing Surfaces, 30 Jul 2025. <a href="https://www.jpl.nasa.gov/news/nasa-isro-satellite-lifts-off-to-track-earths-changing-surfaces/" target="_blank" rel="noopener">link</a></li>
                  <li>NASA Science, NASA-ISRO Radar Mission to Provide Dynamic View of Forests, Wetlands. <a href="https://science.nasa.gov/missions/nisar/nasa-isro-radar-mission-to-provide-dynamic-view-of-forests-wetlands/" target="_blank" rel="noopener">link</a></li>
                  <li>NASA Science, NISAR and Water. <a href="https://science.nasa.gov/mission/nisar/water/" target="_blank" rel="noopener">link</a></li>
                  <li>NASA JPL, Eyes on Infrastructure (levees and dams). <a href="https://www.jpl.nasa.gov/videos/eyes-on-infrastructure-how-the-nisar-satellite-will-help-keep-communities-safer/" target="_blank" rel="noopener">link</a></li>
                  <li>NASA ASF DAAC, NISAR Data User Guide: Soil Moisture and Urgent Response. <a href="https://nisar-docs.asf.alaska.edu/sme2/" target="_blank" rel="noopener">link</a> · <a href="https://nisar-docs.asf.alaska.edu/urgent-response/" target="_blank" rel="noopener">link</a></li>
                  <li>NASA Earthdata, Global NISAR Soil Moisture Product. <a href="https://www.earthdata.nasa.gov/data/projects/nsite/solutions/global-nisar-soil-moisture-product" target="_blank" rel="noopener">link</a></li></ul></section>
                <section><h4>Images</h4><ul>
                  <li>Landsat 8 OLI, 4 and 20 Sep 2024, false colour: NASA Earth Observatory.</li>
                  <li>Flood extent, area 03 Nysa, from Sentinel-1, 15 Sep 2024: © European Union, Copernicus EMS EMSR756, via the <a href="https://rapidmapping.emergency.copernicus.eu/EMSR756/download" target="_blank" rel="noopener">Rapid Mapping portal</a>. Map drawn by the team on AWS Terrain Tiles relief; rivers © OpenStreetMap contributors.</li>
                  <li>Photo of the flooded town: source to be added.</li></ul></section>
              </div></div>`],
            before: [
              `<div class="kn-part fl-1">
                <figure class="kn-pc fl-photo"><img src="img/flood_2024_town.webp" alt="A town centre under brown floodwater, with a bridge railing and street lamps standing out of the water">
                  <figcaption>September 2024.</figcaption></figure>
                <aside class="zoom-info"><div class="zoom-head"><span class="zoom-lbl">South-West Poland · Sep 2024</span></div>
                  <h3>A week of rain</h3>
                  <p>Between 11 and 18 September 2024 a low-pressure system, cut off from the jet stream, sat over Austria, the Czech Republic, Poland and Slovakia and poured rain on them for days.</p>
                  <p>In Stronie Śląskie, a mountain town near the Czech border, a dam burst. On 18 September the Odra rose above the highest alert level set by Poland's weather service, IMGW.</p>
                  <p class="kn-hook">The first flood maps were made while the storm was still overhead. Only radar could see through it.</p></aside>
              </div>`,
              `<div class="kn-part fl-2">
                <figure class="kn-pc fl-map"><img src="img/flood_nysa_s1_20240915.jpg" alt="Dark relief map from the Kłodzko Valley to Nysa and Głuchołazy, with flooded areas in bright blue along the rivers near Kłodzko, Bardo, Otmuchów, Nysa and further east">
                  <figcaption>Blue: flooded area Copernicus EMS mapped from a Sentinel-1 radar image taken at 05:01 UTC on 15 Sep 2024. Detail of EMSR756 area 03, Nysa (dashed outline). Flood data © European Union, Copernicus EMS. Relief: AWS Terrain Tiles. Rivers © OpenStreetMap contributors.</figcaption></figure>
                <aside class="zoom-info"><div class="zoom-head"><span class="zoom-lbl">Copernicus EMS · EMSR756</span></div>
                  <h3>Mapped through the cloud</h3>
                  <p>Poland activated the EU's Copernicus Emergency Management Service at 12:50 UTC on 13 September. For the first three days every flood map came from radar: COSMO-SkyMed on the 14th, Sentinel-1 and PAZ on the 15th and 16th. Optical images were first used from the 17th.</p>
                  <p>This is what Sentinel-1 saw at dawn on 15 September between the Kłodzko Valley and Nysa. Across the whole area Copernicus mapped there, it found 2,900 ha under water.</p>
                  <dl class="zoom-stats"><div><dt>First radar map</dt><dd>14<small>Sep, COSMO-SkyMed</small></dd></div><div><dt>This map</dt><dd>2,900<small>ha, 15 Sep</small></dd></div><div><dt>Same area, peak</dt><dd>3,463<small>ha, 18 Sep</small></dd></div></dl></aside>
              </div>`],
            source: "Landsat 8 OLI, false colour, 4 and 20 September 2024, the Odra near Wrocław: NASA Earth Observatory. Flood totals: Copernicus EMS, EMSR756 statistics." }
};
const IMG = "../site/img/";
const hexs = (a) => a.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const KCOOL = hexs(["#0b0b0c", "#151517", "#221d33", "#3a2a63", "#574aa8", "#7b7fc4", "#9aa2d6", "#c9cce6", "#ececee"]);
const kramp = (t) => { t = Math.floor(Math.min(0.9999, Math.max(0, t)) * 7) / 6; const u = Math.min(0.9999, t) * 8, i = Math.floor(u), k = u - i;
  return KCOOL[i].map((v, c) => v + (KCOOL[i + 1][c] - v) * k); };
function recolour(im) {                     // brightness → stepped cool ramp: water dark, fields indigo, light land periwinkle
  const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
  const img = x.getImageData(0, 0, c.width, c.height), d = img.data, n = c.width * c.height, lum = new Float32Array(n), hist = new Uint32Array(256);
  let m = 0;                                 // transparent pixels (no data) stay transparent and don't count in the stretch
  for (let i = 0; i < n; i++) { lum[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]; if (d[i * 4 + 3] > 0) { hist[lum[i] | 0]++; m++; } }
  const pct = (p) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= m * p) return v; } return 255; };
  const lo = pct(0.02), hi = Math.max(lo + 1, pct(0.98));
  for (let i = 0; i < n; i++) {
    const col = kramp(0.04 + Math.pow(Math.max(0, (lum[i] - lo) / (hi - lo)), 1.25) * 0.74), g = (Math.random() - 0.5) * 10;
    d[i * 4] = col[0] + g; d[i * 4 + 1] = col[1] + g; d[i * 4 + 2] = col[2] + g; d[i * 4 + 3] = d[i * 4 + 3] > 127 ? 255 : 0;
  }
  x.putImageData(img, 0, 0); return c;
}
function plain(im) {                        // keep the image's own colours
  const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext("2d").drawImage(im, 0, 0); return c;
}
const loadImg = (f, base = IMG) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = base + f; });
const ready = {};                            // recolour once, early, so the zoom opens onto a finished picture
const prep = (k) => ready[k] || (ready[k] = Promise.all([loadImg(ZOOM[k].a, ZOOM[k].base ?? IMG), loadImg(ZOOM[k].b, ZOOM[k].base ?? IMG)]).then(([a, b]) => ZOOM[k].raw ? [plain(a), plain(b)] : [recolour(a), recolour(b)]));
Object.keys(ZOOM).forEach((k) => (window.requestIdleCallback || setTimeout)(() => prep(k)));

const reduce = matchMedia("(prefers-reduced-motion: reduce)");
let open = null;
async function zoomTo(k) {
  if (open) return;
  const z = ZOOM[k], pin = pins[k], pr = pin.getBoundingClientRect();
  const x = pr.left + pr.width / 2, y = pr.top + pr.height / 2, wr = wrap.getBoundingClientRect();
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 2;
  const ov = document.createElement("div");
  ov.className = "zoom-to"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", z.title);
  const [tagA, tagB] = z.label.split("|").map((t) => t.trim());
  const extra = z.panels || [], pre = z.before || [], n = 1 + extra.length + pre.length;
  ov.innerHTML = `<button class="zoom-close" type="button" aria-label="Close and zoom back out">Close ✕</button>
  ${z.map33 ? `<img class="kn-bgmap inv" src="${z.map33.src}" alt="" aria-hidden="true"><img class="kn-bgmap" src="${z.map33.src}" alt="" aria-hidden="true">` : ""}
  <div class="zoom-track">
  ${pre.map((h, i) => `<section class="zoom-panel kn-panel" aria-label="Part ${i + 1}">${h}</section>`).join("")}
  <section class="zoom-panel" aria-label="${z.title}"><div class="zoom-body">
    <figure class="zoom-fig">
      <div class="zoom-tags" aria-hidden="true"><span>${tagA}</span><span>${tagB}</span></div>
      <div class="kcompare hud zoom-cmp${z.raw ? " raw" : ""}"><div class="loading">Loading imagery</div></div>
      <figcaption class="zoom-src">${z.source}</figcaption>
      <ul class="zoom-key">${z.key.map(([c, t, d]) => `<li><i style="background:${c}"></i><span><b>${t}</b>${d ? `<small>${d}</small>` : ""}</span></li>`).join("")}</ul>
    </figure>
    <aside class="zoom-info">
      <div class="zoom-head"><span class="zoom-lbl">${z.kicker}</span></div>
      <h3>${z.title}</h3>
      <p>${z.note}</p>
      <dl class="zoom-stats">${z.stats.map(([t, v, u]) => `<div><dt>${t}</dt><dd>${v}<small>${u}</small></dd></div>`).join("")}</dl>
      ${z.href ? `<a class="zoom-more" href="${z.href}">${z.more || "Read more →"}</a>` : ""}
    </aside></div></section>
  ${extra.map((h, i) => `<section class="zoom-panel" aria-label="Part ${pre.length + i + 2}"><div class="zoom-extra">${h}</div></section>`).join("")}
  </div>
  ${n > 1 ? `<div class="zoom-progress" aria-hidden="true"><i></i></div><div class="zoom-hint" aria-hidden="true">Scroll →</div>` : ""}`;
  document.body.appendChild(ov);
  const box = ov.querySelector(".zoom-cmp"), body = ov.querySelector(".zoom-track");
  open = { k, ov, x, y, R, ox: x - wr.left, oy: y - wr.top, back: document.activeElement };
  document.documentElement.style.overflow = "hidden";
  ov.querySelector(".zoom-close").addEventListener("click", zoomOut);
  ov.querySelector(".zoom-close").focus({ preventScroll: true });
  sideways(ov, n);
  if (z.map33) introMap(ov, z.map33.ar);
  ov.querySelectorAll(".kn-coal").forEach(coalChart);

  const T = reduce.matches ? 0 : 1000, ease = "cubic-bezier(.7,0,.25,1)";
  wrap.style.transformOrigin = `${open.ox}px ${open.oy}px`;
  wrap.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(7)", opacity: 0 }], { duration: T, easing: ease, fill: "forwards" });
  ov.animate([{ clipPath: `circle(9px at ${x}px ${y}px)` }, { clipPath: `circle(${R}px at ${x}px ${y}px)` }], { duration: T, easing: ease, fill: "forwards" });
  body.style.transformOrigin = `${x}px ${y}px`;
  body.animate([{ transform: "scale(.15)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: T, easing: ease, fill: "forwards" });

  try {
    const [ca, cb] = await prep(k);
    if (open?.ov !== ov) return;
    box.querySelector(".loading").remove();
    const A = document.createElement("canvas"), B = document.createElement("canvas");
    [[A, ca], [B, cb]].forEach(([t, s]) => { t.width = s.width; t.height = s.height; t.getContext("2d").drawImage(s, 0, 0); });
    box.style.setProperty("--ar", (ca.width / ca.height).toFixed(3));
    box.prepend(A, B);
    const seam = document.createElement("div"); seam.className = "seam"; box.appendChild(seam);
    const range = document.createElement("input");
    Object.assign(range, { type: "range", min: 0, max: 100, value: 50 }); range.setAttribute("aria-label", z.label.replace("|", "versus"));
    // a year label disappears while its side of the slider is completely covered
    const tags = ov.querySelectorAll(".zoom-tags span");
    const showTags = (cut) => { tags[0].classList.toggle("gone", cut <= 2); tags[1].classList.toggle("gone", cut >= 98); };
    range.addEventListener("input", () => { box.style.setProperty("--cut", range.value + "%"); showTags(+range.value); });
    box.appendChild(range);
    if (!reduce.matches) {                   // once open, sweep the seam across so the change is seen without touching anything
      const sweep = box.animate([{ "--cut": "100%" }, { "--cut": "8%" }, { "--cut": "50%" }], { duration: 2200, delay: Math.max(0, T - 200), easing: "ease-in-out" });
      const follow = () => { if (sweep.playState !== "running") return; showTags(parseFloat(getComputedStyle(box).getPropertyValue("--cut"))); requestAnimationFrame(follow); };
      requestAnimationFrame(follow);
      sweep.finished.then(() => { box.style.setProperty("--cut", "50%"); showTags(50); }).catch(() => {});
    }
  } catch { box.querySelector(".loading").textContent = "Image unavailable"; }
}
function zoomOut() {
  if (!open) return;
  const { ov, x, y, R, back } = open, T = reduce.matches ? 0 : 750, ease = "cubic-bezier(.6,0,.3,1)";
  open = null;
  ov.animate([{ clipPath: `circle(${R}px at ${x}px ${y}px)` }, { clipPath: `circle(0px at ${x}px ${y}px)` }], { duration: T, easing: ease, fill: "forwards" });
  ov.querySelector(".zoom-track").animate([{ transform: "scale(1)" }, { transform: "scale(.15)" }], { duration: T, easing: ease, fill: "forwards" });
  wrap.getAnimations().forEach((a) => a.cancel());
  wrap.animate([{ transform: "scale(7)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: T, easing: ease });
  const done = () => { ov.remove(); document.documentElement.style.overflow = ""; back?.focus?.({ preventScroll: true }); };
  setTimeout(done, T + 30);
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape") zoomOut();
  else if (open && (e.key === "ArrowRight" || e.key === "ArrowLeft") && e.target.type !== "range") open.go?.(e.key === "ArrowRight" ? 1 : -1);
});
// The 1933 map: behind part 1 it fills the screen, inverted and dim (light lines on charcoal). Scrolling to part 2 it
// shrinks into the frame on the left of part 2 and fades back to its own paper colours; there the real map takes over.
function introMap(ov, ar) {
  const track = ov.querySelector(".zoom-track"), [inv, orig] = ov.querySelectorAll(".kn-bgmap"), fig = ov.querySelector(".kn-map33"), img = fig.querySelector("img");
  const lerp = (a, b, t) => a + (b - a) * t, ease = (t) => t * t * (3 - 2 * t);
  const draw = () => {
    const W = track.clientWidth, sx = track.scrollLeft, p2 = ov.querySelectorAll(".kn-panel")[1];
    const land = Math.max(1, p2.offsetLeft - (W - p2.offsetWidth) / 2);         // scroll position where part 2 sits centred
    const p = Math.max(0, Math.min(1, sx / land)), e = ease(p);
    const vw = ov.clientWidth, vh = ov.clientHeight;
    const cw = vw / vh > ar ? vw : vh * ar, ch = cw / ar;                       // "cover" the screen at the start
    const r = img.getBoundingClientRect(), tl = r.left + sx - land, tt = r.top;   // where the framed map sits once part 2 is centred
    const box = { left: lerp((vw - cw) / 2, tl, e) + "px", top: lerp((vh - ch) / 2, tt, e) + "px",
      width: lerp(cw, r.width, e) + "px", height: lerp(ch, r.height, e) + "px" };
    // two copies moving together: the inverted one fades out while the original fades in (a half-inverted image goes flat grey)
    Object.assign(inv.style, box, { opacity: 0.2 * (1 - e) });
    Object.assign(orig.style, box, { opacity: e });
    const handover = p >= 0.999;
    for (const el of [inv, orig]) el.style.visibility = handover || sx > land ? "hidden" : "visible";
    img.style.visibility = handover ? "visible" : "hidden";
    fig.classList.toggle("on", p >= 0.85);                     // the survey-point marker shows while the map is still settling
    ov.querySelectorAll(".kn-panel").forEach((pn) => { const c = pn.offsetLeft + pn.offsetWidth / 2 - sx; pn.classList.toggle("on", c > W * 0.2 && c < W * 0.8); });
  };
  // simple swipe compares inside the story parts (same look as the NISAR slider); a year label hides when fully covered
  ov.querySelectorAll(".kn-cmp").forEach((c) => {
    const r = c.querySelector("input"), tags = c.parentElement.querySelectorAll(".zoom-tags span");
    r.addEventListener("input", () => { c.style.setProperty("--cut", r.value + "%");
      tags[0]?.classList.toggle("gone", r.value <= 2); tags[1]?.classList.toggle("gone", r.value >= 98); });
  });
  track.addEventListener("scroll", draw, { passive: true });
  addEventListener("resize", draw);
  img.complete ? draw() : img.addEventListener("load", draw);
  draw();
}

// Coal removed vs ground drop at five measured points (Wojciechowski 2007, Table 1). Bars hang from the surface line,
// as the ground does: periwinkle = thickness of coal removed underneath, red = how far the ground dropped.
const COAL = [[6.13, 4], [7.59, 6], [14.7, 10], [16.69, 12], [25.6, 18]];   // [coal removed m, ground drop m], sorted by coal
function coalChart(fig) {
  const W = 340, H = 168, top = 22, left = 30, right = 8, max = 27, h = (m) => (m / max) * (H - top - 14);
  const slot = (W - left - right) / COAL.length, bw = 16, gap = 2;
  const bar = (x, y0, len, col) => {                                    // square at the surface, 4px rounded at the data end (bottom)
    const r = Math.min(4, len / 2), y1 = y0 + len;
    return `<path d="M${x},${y0}H${x + bw}V${y1 - r}Q${x + bw},${y1} ${x + bw - r},${y1}H${x + r}Q${x},${y1} ${x},${y1 - r}Z" fill="${col}"/>`;
  };
  let g = "";
  for (const m of [5, 10, 15, 20, 25]) g += `<line x1="${left}" x2="${W - right}" y1="${top + h(m)}" y2="${top + h(m)}" class="grid"/><text x="${left - 6}" y="${top + h(m) + 3}" text-anchor="end">${m} m</text>`;
  let bars = "";
  COAL.forEach(([c, d], i) => {
    const x = left + i * slot + (slot - 2 * bw - gap) / 2;
    bars += `<g class="pair" data-i="${i}"><rect class="hit" x="${left + i * slot}" y="${top}" width="${slot}" height="${H - top}"/>
      ${bar(x, top, h(c), "#7b7fc4")}${bar(x + bw + gap, top, h(d), "#ee2a1e")}
      <text class="val" x="${x + bw + gap + bw / 2}" y="${top + h(d) + 11}" text-anchor="middle">${d} m</text></g>`;
  });
  fig.innerHTML = `<figcaption><b>Coal removed vs ground drop</b> at five measured points</figcaption>
    <div class="kn-coal-key"><span><i style="background:#7b7fc4"></i>Coal removed</span><span><i style="background:#ee2a1e"></i>Ground dropped</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="At five points, the ground dropped by 65 to 79 percent of the thickness of coal removed underneath">
      ${g}<line x1="${left}" x2="${W - right}" y1="${top}" y2="${top}" class="surface"/><text x="${left}" y="${top - 6}" class="lbl">surface</text>${bars}</svg>
    <div class="kn-coal-tip" hidden></div>
    <table class="sr-only"><tr><th>Coal removed (m)</th><th>Ground drop (m)</th></tr>${COAL.map(([c, d]) => `<tr><td>${c}</td><td>${d}</td></tr>`).join("")}</table>
    <small class="kn-coal-src">Data: Wojciechowski 2007, Table 1</small>`;
  const tip = fig.querySelector(".kn-coal-tip");
  fig.querySelectorAll(".pair").forEach((p) => {
    const [c, d] = COAL[+p.dataset.i];
    p.addEventListener("mouseenter", () => {
      tip.innerHTML = `<b>${c} m</b> of coal removed → ground <b>${d} m</b> lower (${Math.round((d / c) * 100)}%)`;
      tip.hidden = false; p.classList.add("on");
      const r = p.getBoundingClientRect(), fr = fig.getBoundingClientRect();
      tip.style.left = Math.min(fr.width - 190, Math.max(0, r.left - fr.left + r.width / 2 - 95)) + "px";
    });
    p.addEventListener("mouseleave", () => { tip.hidden = true; p.classList.remove("on"); });
  });
}

// the zoom view is a row of full-screen parts that scrolls sideways smoothly: the mouse wheel / trackpad moves it
// continuously (no snapping, no buttons), the arrow keys glide by most of a screen, a thin line shows progress
function sideways(ov, n) {
  const track = ov.querySelector(".zoom-track"), bar = ov.querySelector(".zoom-progress i"), hint = ov.querySelector(".zoom-hint");
  const glide = (dx) => track.scrollBy({ left: dx, behavior: reduce.matches ? "auto" : "smooth" });
  if (open) open.go = (d) => glide(d * track.clientWidth * 0.85);
  if (n < 2) return;
  track.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;                                             // pinch-zoom stays with the browser
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    track.scrollLeft += d * (e.deltaMode === 1 ? 40 : 1);               // line-based wheels report lines, not pixels
  }, { passive: false });
  const update = () => {
    const max = track.scrollWidth - track.clientWidth, f = max > 0 ? track.scrollLeft / max : 0;
    bar.style.transform = `scaleX(${f})`;
    hint?.classList.toggle("gone", track.scrollLeft > 40);
  };
  track.addEventListener("scroll", update, { passive: true });
  update();
}
new ResizeObserver(draw).observe(wrap);
