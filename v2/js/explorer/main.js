/* NISAR Explorer: search, browse, analyse and compare NISAR products on a 3D globe (CesiumJS).

   Data flow
   · ASF DAAC search API → products (one per date) → grouped into "frames" (track + frame + pass),
     the fixed cells NISAR images once every 12-day cycle.
   · Each product's quick-look PNG (+ its _LATLON.kml box) is draped on the globe on demand.
   · Analysis reads the quick-look pixels back (probe, time series, change map); see imagery.js.
   · NASA's observation plan (nasa-gis.js) adds future passes and whole-track frame layouts.
   No login and no server: everything is fetched straight from public, CORS-enabled services. */
import * as ASF from "./asf.js";
import * as IMG from "./imagery.js";
import { seriesChart } from "./chart.js";

const C = window.Cesium;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deg = (r) => (r * 180) / Math.PI;
const COL = { A: "#f0b88c", D: "#9aa2d6", hi: "#eeff1a", plan: "#c4c4ca" };
const SERIES_COL = { r: "#c962be", g: "#3fab70" };
const TYPE_ORDER = ["GCOV", "GSLC", "RSLC", "GUNW", "SME2"];
const mobile = () => matchMedia("(max-width: 860px)").matches;

// ---------------------------------------------------------------- viewer
if (!C) {
  $("res-head").textContent = "The 3D globe library (CesiumJS) could not load. Check your connection and reload.";
  throw new Error("Cesium missing");
}
let viewer;
try {
  viewer = new C.Viewer("globe", {
    baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
    infoBox: false, selectionIndicator: false, skyBox: false,
    requestRenderMode: true, maximumRenderTimeChange: Infinity,
    terrainProvider: new C.EllipsoidTerrainProvider(),
  });
} catch (e) {
  $("res-head").textContent = "Your browser could not start the 3D globe (WebGL). Try another browser or device.";
  throw e;
}
const scene = viewer.scene, camera = viewer.camera, ellipsoid = scene.globe.ellipsoid;
const render = () => scene.requestRender();
scene.backgroundColor = C.Color.fromCssColorString("#0b0b0c");
scene.globe.baseColor = C.Color.fromCssColorString("#0c0c0e");   // shows only until tiles arrive
if (scene.sun) scene.sun.show = false;
if (scene.moon) scene.moon.show = false;
// lighter rendering for a flat dark map: no atmosphere glow or fog (they cost a pass per frame and
// make tiles shimmer at the horizon); keep more tiles in memory so panning back doesn't reload them
if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
scene.globe.showGroundAtmosphere = false;
scene.fog.enabled = false;
scene.globe.tileCacheSize = 400;
scene.screenSpaceCameraController.minimumZoomDistance = 400;
scene.screenSpaceCameraController.maximumZoomDistance = 4.0e7;
camera.setView({ destination: C.Cartesian3.fromDegrees(17.6, 51.9, 1.1e6) });

// ---------------------------------------------------------------- base map: charcoal + relief
// Esri's Dark Gray Canvas, recoloured onto the site's charcoal and shaded with Esri's dark
// hillshade (charcoal.js). Cesium's own layer controls (brightness, hue…) can only dim a grey
// map, not tint it, so tiles are fetched and recoloured, normally in a background worker so the
// page stays smooth (≈2.5 ms per tile otherwise lands on the main thread).
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
const DARK = ESRI + "Canvas/World_Dark_Gray_Base/MapServer/tile/";
const HILL = ESRI + "Elevation/World_Hillshade_Dark/MapServer/tile/";
const tileWorkers = (() => {
  return null;   // the charcoal map is no longer used: don't start its two workers for nothing
  // eslint-disable-next-line no-unreachable
  if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined") return null;
  try {
    const n = Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)), jobs = new Map(), list = [];
    let next = 0, broken = false;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./charcoal-worker.js", import.meta.url), { type: "module" });
      w.onmessage = ({ data }) => { const j = jobs.get(data.id); if (!j) return; jobs.delete(data.id); data.error ? j.no(new Error(data.error)) : j.ok(data.bmp); };
      w.onerror = () => { broken = true; jobs.forEach((j) => j.no(new Error("worker failed"))); jobs.clear(); };
      list.push(w);
    }
    return {
      get ok() { return !broken; },
      run(base, hill) {
        return new Promise((ok, no) => { const id = next++; jobs.set(id, { ok, no }); list[id % list.length].postMessage({ id, base, hill }); });
      },
    };
  } catch { return null; }
})();
let charcoalMain = null;   // main-thread fallback, loaded only if the workers can't run
async function charcoalTile(base, hill) {
  if (tileWorkers?.ok) {
    try {
      const bmp = await tileWorkers.run(base, hill);
      // hand the bitmap to a canvas without copying; Cesium uploads canvases the right way up
      const cv = document.createElement("canvas");
      cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext("bitmaprenderer").transferFromImageBitmap(bmp);
      return cv;
    } catch { /* fall through to the main thread */ }
  }
  charcoalMain ??= import("./charcoal.js");
  return (await charcoalMain).recolour(base, hill, (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }));
}
function charcoalProvider() {
  const p = new C.UrlTemplateImageryProvider({ url: DARK + "{z}/{y}/{x}", maximumLevel: 16, credit: "Base map: Esri, HERE, Garmin, © OpenStreetMap contributors · relief © Esri" });
  // Cesium's own Resource keeps its request throttling and cancelling; the image is decoded here
  // (not by Cesium, which pre-flips ImageBitmaps) so the returned canvas uploads the right way up.
  p.requestImage = (x, y, level, request) => {
    const base = new C.Resource({ url: `${DARK}${level}/${y}/${x}`, request }).fetchBlob();
    if (!base) return undefined;   // throttled: Cesium asks again later
    const hill = fetch(`${HILL}${level}/${y}/${x}`).then((r) => (r.ok ? r.blob() : null), () => null);
    return Promise.all([base, hill]).then(([b, h]) => charcoalTile(b, h));
  };
  return p;
}
// Base map: OpenStreetMap (open data, no API key), turned into a dark map in the browser: each tile
// is inverted, its hues turned back (so water stays blue and parks green), then muted and dimmed.
// (Free dark tile sets such as CARTO's now need a key; the charcoal provider above is kept but unused.)
const OSM_DARK = "invert(1) hue-rotate(180deg) saturate(.35) brightness(.82) contrast(1.05)";
// The recolouring runs in two background workers (OffscreenCanvas), so decoding and filtering tiles
// never blocks scrolling, zooming or flying; browsers without OffscreenCanvas filters do it here instead.
const darkWorkers = (() => {
  if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined") return null;
  try {
    const src = `const F=${JSON.stringify(OSM_DARK)};
      self.onmessage=async({data:{id,blob}})=>{try{const b=await createImageBitmap(blob);const c=new OffscreenCanvas(b.width,b.height),g=c.getContext("2d");
        if(!("filter" in g))throw new Error("no filter");g.filter=F;g.drawImage(b,0,0);b.close();const o=c.transferToImageBitmap();self.postMessage({id,bmp:o},[o]);}
        catch(e){self.postMessage({id,error:String(e)});}};`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const list = [new Worker(url), new Worker(url)], jobs = new Map();
    let next = 0, broken = false;
    list.forEach((w) => {
      w.onmessage = ({ data }) => { const j = jobs.get(data.id); if (!j) return; jobs.delete(data.id); data.error ? j.no(new Error(data.error)) : j.ok(data.bmp); };
      w.onerror = () => { broken = true; jobs.forEach((j) => j.no(new Error("worker failed"))); jobs.clear(); };
    });
    return {
      get ok() { return !broken; },
      run(blob) { return new Promise((ok, no) => { const id = next++; jobs.set(id, { ok, no }); list[id % 2].postMessage({ id, blob }); }); },
    };
  } catch { return null; }
})();
async function darkTile(blob) {
  if (darkWorkers?.ok) {
    try {
      const bmp = await darkWorkers.run(blob);
      const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext("bitmaprenderer").transferFromImageBitmap(bmp);   // hand over without copying
      return cv;
    } catch { /* fall back to the main thread below */ }
  }
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext("2d"); g.filter = OSM_DARK; g.drawImage(bmp, 0, 0); bmp.close?.();
  return cv;
}
function osmDarkProvider() {
  // level 18 is street level already; 19 only doubles the tiles to fetch and recolour
  const p = new C.UrlTemplateImageryProvider({ url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maximumLevel: 18,
    credit: "Base map © OpenStreetMap contributors" });
  p.requestImage = (x, y, level, request) => {
    const blob = new C.Resource({ url: `https://tile.openstreetmap.org/${level}/${x}/${y}.png`, request }).fetchBlob();
    if (!blob) return undefined;   // throttled: Cesium asks again later
    return blob.then(darkTile);
  };
  return p;
}
viewer.imageryLayers.add(new C.ImageryLayer(osmDarkProvider()), 0);
// place names are part of the OSM tiles; the "Place names & borders" toggle now switches the borders
const labelLayer = { show: true };

// ---------------------------------------------------------------- country borders (Natural Earth, vector)
// Crisp at every zoom: 1:50m lines from far out, 1:10m (≈0.8 MB, loaded on first need) up close.
// Borders only: the charcoal map already shows every coast, and coastlines would be ~85% of the
// points (1:10m: 409k of 477k, redrawn every frame), so they are left out.
const BORDER_NEAR_M = 9e5;
const BORDER_MAT = C.Material.fromType("Color", { color: C.Color.fromCssColorString("#55555f") });
const borderSets = {};
let bordersOn = true;
function loadBorders(res) {
  if (!borderSets[res]) {
    borderSets[res] = (async () => {
      const [{ mesh }, topo] = await Promise.all([
        import("https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm"),
        fetch(`https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-${res}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      ]);
      const pc = new C.PolylineCollection();
      mesh(topo, topo.objects.countries, (a, b) => a !== b).coordinates.forEach((line) => {
        if (line.length > 1) pc.add({ positions: C.Cartesian3.fromDegreesArray(line.flat()), width: 1, material: BORDER_MAT });
      });
      pc.show = false;
      scene.primitives.add(pc);
      return pc;
    })();
    borderSets[res].catch(() => delete borderSets[res]);
  }
  return borderSets[res];
}
let borderTok = 0;
async function syncBorders() {
  const tok = ++borderTok, want = camera.positionCartographic.height < BORDER_NEAR_M ? "10m" : "50m";
  let use = want;
  try { await loadBorders(want); } catch { use = "50m"; await loadBorders("50m").catch(() => null); }
  if (tok !== borderTok) return;
  for (const [res, pr] of Object.entries(borderSets)) pr.then((pc) => { pc.show = bordersOn && res === use; render(); }, () => {});
}
viewer.creditDisplay?.addStaticCredit?.(new C.Credit("Borders: Natural Earth"));

// ---------------------------------------------------------------- state
const S = {
  products: [], stacks: new Map(), total: null, lastQ: null,
  cycle: null,          // cycle filter (timeline)
  sel: null,            // selected frame key "track-frame-dir"
  type: null,           // product type shown for the selected frame
  idx: 0,               // index into the selected frame's dates
  showCur: true, opacity: 0.9,
  point: null,          // probe point {lon, lat}
  where: "view",
  cmpA: 0, cmpB: 0, compare: null, cmpChannel: "g", cmpK: 2.5, cmpStats: null,
  playing: false, foot: false, quick: false,   // foot: NISAR image areas (frame outlines) shown; off until asked for
  series: null,         // { stackKey, type, lon, lat, rows }
  plan: null,           // track number drawn from the NASA plan
};
const items = (s, type) => (s ? s.items.filter((p) => p.type === type) : []);
const curStack = () => (S.sel ? S.stacks.get(S.sel) : null);
const curList = () => items(curStack(), S.type);
const current = () => curList()[S.idx] || null;
const inCycle = (p, c) => c == null || p.cycle === c || p.cycle2 === c;
// where a quick-look sits: its own public KML, else one from the same frame (see asf.js)
const boundsOf = (p) => ASF.bounds(p, S.stacks.get(p.key)?.items || []);

// ---------------------------------------------------------------- image overlays on the globe
// priorities keep a stable stack order: quick-look mosaic < team layers < current/A/B < change map < labels
const ov = new Map(), ovTok = {};
const prio = (k) => (k.startsWith("ql:") ? 1 : k.startsWith("team:") ? 2 : k === "chg" ? 4 : 3);
function reorder() {
  [...ov.entries()].sort((a, b) => prio(a[0]) - prio(b[0])).forEach(([, o]) => viewer.imageryLayers.raiseToTop(o.layer));
  if (viewer.imageryLayers.contains(labelLayer)) viewer.imageryLayers.raiseToTop(labelLayer);
}
async function putOverlay(key, src, rect, { alpha = S.opacity, split = null, show = true } = {}) {
  const tok = (ovTok[key] = (ovTok[key] || 0) + 1);
  let url = src, made = null;
  if (src instanceof Blob) url = made = URL.createObjectURL(src);
  let provider;
  try {
    provider = await C.SingleTileImageryProvider.fromUrl(url, { rectangle: C.Rectangle.fromDegrees(rect.w, rect.s, rect.e, rect.n) });
  } finally { if (made) URL.revokeObjectURL(made); }
  if (ovTok[key] !== tok) return null;
  const layer = new C.ImageryLayer(provider, { alpha });
  if (split != null) layer.splitDirection = split;
  layer.show = show;
  viewer.imageryLayers.add(layer);
  const old = ov.get(key);
  ov.set(key, { layer, rect });
  if (old) viewer.imageryLayers.remove(old.layer, true);
  reorder(); render();
  return layer;
}
function dropOverlay(key) {
  ovTok[key] = (ovTok[key] || 0) + 1;
  const o = ov.get(key);
  if (o) { viewer.imageryLayers.remove(o.layer, true); ov.delete(key); render(); }
}
const dropOverlays = (prefix) => [...ov.keys()].filter((k) => k.startsWith(prefix)).forEach(dropOverlay);

// ---------------------------------------------------------------- entities
const footDS = new C.CustomDataSource("frames"), planDS = new C.CustomDataSource("plan"), markDS = new C.CustomDataSource("marks");
viewer.dataSources.add(planDS); viewer.dataSources.add(footDS); viewer.dataSources.add(markDS);
const color = (hex, a = 1) => C.Color.fromCssColorString(hex).withAlpha(a);
let hoverKey = null;

function buildStacks() {
  S.stacks = new Map();
  for (const p of S.products) {
    let s = S.stacks.get(p.key);
    if (!s) S.stacks.set(p.key, (s = { key: p.key, track: p.track, frame: p.frame, dir: p.dir, ring: p.ring, items: [] }));
    s.items.push(p);
  }
  for (const s of S.stacks.values()) {
    s.items.sort((a, b) => a.start - b.start);
    const full = s.items.filter((p) => p.coverage === "Full");
    s.ring = (full[full.length - 1] || s.items[s.items.length - 1]).ring;
    s.types = TYPE_ORDER.filter((t) => s.items.some((p) => p.type === t));
    s.latest = s.items[s.items.length - 1].start;
  }
}
const stackVisible = (s) => S.cycle == null || s.items.some((p) => inCycle(p, S.cycle));

function drawFootprints() {
  footDS.entities.suspendEvents();
  footDS.entities.removeAll();
  S.lineAlpha = S.stacks.size > 150 ? 0.4 : S.stacks.size > 60 ? 0.55 : 0.75;   // a dense web of frames stays readable
  for (const s of S.stacks.values()) {
    const pos = C.Cartesian3.fromDegreesArray(s.ring.flat());
    s.line = footDS.entities.add({ polyline: { positions: pos, width: 1.5, material: color(COL[s.dir], S.lineAlpha), arcType: C.ArcType.GEODESIC } });
    styleStack(s);
  }
  footDS.entities.resumeEvents();
  render();
}
function styleStack(s) {
  if (!s || !s.line) return;
  const vis = S.foot && stackVisible(s), sel = s.key === S.sel, hov = s.key === hoverKey;
  if (s.line.show !== (vis || sel)) s.line.show = vis || sel;
  // one colour material per outline, recoloured in place: swapping in a new material (or a new width)
  // on hover made Cesium rebuild the whole line batch, so outlines flickered; only selection widens a line
  if (!s.mat) { s.mat = new C.ColorMaterialProperty(); s.line.polyline.material = s.mat; }
  s.mat.color = color(sel || hov ? COL.hi : COL[s.dir], sel ? 1 : hov ? 0.8 : S.lineAlpha);
  const w = sel ? 3 : 1.75;
  if (s.w !== w) { s.w = w; s.line.polyline.width = w; }
}
function styleAll() { for (const s of S.stacks.values()) styleStack(s); render(); }
// only frames that are on screen count for hover and clicks (with the image areas off, none are)
const stacksAt = (ll) => [...S.stacks.values()].filter((s) => (S.foot || s.key === S.sel) && stackVisible(s) && ASF.contains(s.ring, ll.lon, ll.lat))
  .sort((a, b) => (b.key === S.sel) - (a.key === S.sel) || b.latest - a.latest);

function setPin(ll) {
  markDS.entities.removeById("pin");
  if (ll) markDS.entities.add({ id: "pin", position: C.Cartesian3.fromDegrees(ll.lon, ll.lat), point: { pixelSize: 9, color: color(COL.hi), outlineColor: color("#0b0b0c"), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  render();
}

function flyToRing(ring, pad = 0.25) {
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  let w = Math.min(...lons), e = Math.max(...lons), s = Math.min(...lats), n = Math.max(...lats);
  const dx = (e - w) * pad, dy = (n - s) * pad;
  S.autoFly = true;   // a flight to a frame is not a reason to offer "Search this area"
  camera.flyTo({ destination: C.Rectangle.fromDegrees(w - dx, s - dy, e + dx, n + dy), duration: 1.4 });
}

// ---------------------------------------------------------------- search form
const typeBox = $("types");
// product menu: a burger button opens a list; each row is a type with a tick and a one-line
// explanation; several can be ticked; the button shows what is chosen
typeBox.innerHTML = Object.entries(ASF.TYPES).map(([k, t]) =>
  `<button type="button" class="ex-menu-item" data-type="${k}" aria-pressed="${k === "GCOV"}"><i class="ex-tick" aria-hidden="true"></i><span><b>${esc(t.label)}</b><small>${esc(t.long)}</small></span></button>`).join("");
const prodBtn = $("prod-btn");
function syncProd() {
  const on = [...typeBox.querySelectorAll('[aria-pressed="true"]')].map((b) => ASF.TYPES[b.dataset.type]?.label || b.dataset.type);
  $("prod-sel").textContent = on.length ? on.join(", ") : "None chosen";
}
const openMenu = (open) => { typeBox.hidden = !open; prodBtn.setAttribute("aria-expanded", String(open)); };
prodBtn.addEventListener("click", () => openMenu(typeBox.hidden));
document.addEventListener("click", (e) => { if (!typeBox.hidden && !e.target.closest(".ex-prod")) openMenu(false); });
typeBox.addEventListener("click", (e) => {
  const b = e.target.closest("[data-type]"); if (!b) return;
  b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
  syncProd();
});
syncProd();
// Advanced: the area, track/frame/pass, dates, the full archive search and the track plan
$("adv-btn").addEventListener("click", () => {
  const open = $("adv").hidden;
  $("adv").hidden = !open; $("adv-btn").setAttribute("aria-expanded", String(open));
  $("adv-btn").querySelector("span").textContent = open ? "▾" : "▸";
  if (!open) setWhere("view");   // closing it goes back to the simple "what's on screen" search
});

const WHERE_HINT = {
  view: "Products that touch the part of Earth on screen.",
  point: "Click the globe to pick a point; products that cover it.",
  any: "The whole archive. Set a track, frame or cycle to narrow it.",
};
function setWhere(w) {
  S.where = w;
  document.querySelectorAll("#where [data-where]").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.where === w)));
  $("where-hint").textContent = WHERE_HINT[w] + (w === "point" && S.point ? ` Now: ${fmtLL(S.point)}.` : "");
}
$("where").addEventListener("click", (e) => { const b = e.target.closest("[data-where]"); if (b) setWhere(b.dataset.where); });

// cycle select: now → first
const NOW_CYCLE = ASF.cycleOf(new Date());
{
  const opts = ['<option value="">Any cycle</option>'];
  for (let c = NOW_CYCLE; c >= ASF.FIRST_CYCLE; c--) {
    const a = ASF.cycleStart(c), b = ASF.cycleEnd(c);
    opts.push(`<option value="${c}">Cycle ${c} · ${ASF.fmtDay(a, false)} – ${ASF.fmtDay(b)}${c === NOW_CYCLE ? " (now)" : ""}</option>`);
  }
  $("f-cycle").innerHTML = opts.join("");
}
const syncDates = () => { const on = !!$("f-cycle").value; $("f-from").disabled = $("f-to").disabled = on; };
$("f-cycle").addEventListener("change", syncDates);

// The part of Earth on screen, as a lon/lat box. Sampled on a screen grid rather than taken from
// camera.computeViewRectangle, which turns into the whole globe as soon as a pole is in view.
function viewWkt() {
  const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight, lons = [], lats = [];
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const ll = pickLL(new C.Cartesian2((i / 8) * W, (j / 8) * H));
    if (ll) { lons.push(ll.lon); lats.push(ll.lat); }
  }
  if (lons.length < 4) return null;
  const w = Math.min(...lons), e = Math.max(...lons), s = Math.max(-89.9, Math.min(...lats)), n = Math.min(89.9, Math.max(...lats));
  if (e - w > 180) return null;     // most of a hemisphere, or across the date line: search everywhere
  const f = (v) => v.toFixed(3);
  return `POLYGON((${f(w)} ${f(s)},${f(e)} ${f(s)},${f(e)} ${f(n)},${f(w)} ${f(n)},${f(w)} ${f(s)}))`;
}
function readQuery() {
  const types = [...typeBox.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.type);
  const cycle = +$("f-cycle").value || null;
  const from = $("f-from").value, to = $("f-to").value;
  const q = {
    types, cycle, max: 500,
    track: Math.round(+$("f-track").value) || null,
    frame: Math.round(+$("f-frame").value) || null,
    dir: $("f-dir").value || null,
    start: !cycle && from ? new Date(from + "T00:00:00Z") : null,
    end: !cycle && to ? new Date(to + "T23:59:59Z") : null,
    wkt: null, area: "anywhere",
  };
  if (S.where === "view") { q.wkt = viewWkt(); q.area = q.wkt ? "in view" : "whole globe"; }
  if (S.where === "point") {
    if (!S.point) return { ...q, error: "Click the globe to pick a point first." };
    q.wkt = `POINT(${S.point.lon.toFixed(4)} ${S.point.lat.toFixed(4)})`; q.area = `at ${fmtLL(S.point)}`;
  }
  if (!types.length) q.error = "Pick at least one product type.";
  return q;
}

// ---------------------------------------------------------------- search
let searchCtl = null, pending = null;
async function runSearch() {
  const q = readQuery();
  const head = $("res-head");
  if (q.error) { head.textContent = q.error; return; }
  searchCtl?.abort();
  searchCtl = new AbortController();
  const sig = searchCtl.signal;
  document.body.classList.add("ex-busy");
  $("go").disabled = true;
  head.innerHTML = `<span class="ex-spin"></span>Searching NASA's archive (ASF DAAC)…`;
  try {
    const [list, total] = await Promise.all([ASF.search(q, sig), ASF.count(q, sig).catch(() => null)]);
    const keep = pending || (S.sel ? { key: S.sel, type: S.type, id: current()?.id } : null);
    pending = null;
    S.products = list; S.total = total; S.lastQ = q; S.cycle = q.cycle || null;
    buildStacks(); drawFootprints(); renderResults();
    if (keep && S.stacks.has(keep.key)) selectStack(keep.key, { type: keep.type, id: keep.id, fly: !!keep.fly });
    else if (S.sel) closeRight();
    renderTimeline(); updateQuicklooks();
    $("search-here").hidden = true;
    if (mobile() && !S.sel) setSheet("search");
  } catch (e) {
    if (e.name !== "AbortError") head.textContent = `Search failed: ${e.message}. Try again in a moment.`;
  } finally {
    if (!sig.aborted) { document.body.classList.remove("ex-busy"); $("go").disabled = false; }
    saveHash();
  }
}
$("q").addEventListener("submit", (e) => {
  e.preventDefault(); openMenu(false);
  if (e.submitter?.id === "show") setWhere("view");   // the simple button always searches what's on screen
  setAreas(true, false);                                // a search is a request to see the areas
  runSearch();
});

// No list of results any more: the frames are on the globe, and the one you click opens on the right
// with its dates and the download for exactly that product. The panel keeps a one-line summary.
function renderResults() {
  const head = $("res-head");
  const vis = [...S.stacks.values()].filter(stackVisible);
  const nProd = S.products.filter((p) => inCycle(p, S.cycle)).length;   // search results only, not a frame's loaded history
  if (!S.lastQ) { head.textContent = "Pick a place and a product, then press “Show NISAR data in view”."; return; }
  if (!vis.length) { head.textContent = "Nothing here yet. NISAR covers land and ice every 12 days, but not every frame is processed. Zoom out, pick another product, or clear the cycle."; return; }
  const more = S.total != null && S.total > S.products.length ? ` (newest ${S.products.length} of ${S.total.toLocaleString("en")})` : "";
  head.innerHTML = `<b>${nProd}</b> product${nProd === 1 ? "" : "s"} in <b>${vis.length}</b> frame${vis.length === 1 ? "" : "s"}${more}. <span class="ex-next">Click a frame on the map to open it and download its data.</span>`;
}

function setHover(key) {
  if (key === hoverKey) return;
  const prev = hoverKey; hoverKey = key;
  styleStack(S.stacks.get(prev)); styleStack(S.stacks.get(key)); render();
}

// ---------------------------------------------------------------- timeline of 12-day cycles
function renderTimeline() {
  const bars = $("tl-bars");
  const counts = new Map();
  S.products.forEach((p) => counts.set(p.cycle, (counts.get(p.cycle) || 0) + 1));
  const st = curStack(), mine = new Set(items(st, S.type).map((p) => p.cycle)), cur = current();
  const have = [...counts.keys(), ...mine];
  let lo = Math.min(NOW_CYCLE - 11, ...(have.length ? have : [NOW_CYCLE])), hi = Math.max(NOW_CYCLE, ...(have.length ? have : [NOW_CYCLE]));
  lo = Math.max(ASF.FIRST_CYCLE, lo);
  const max = Math.max(1, ...counts.values());
  let html = "";
  for (let c = lo; c <= hi; c++) {
    const n = counts.get(c) || 0, a = ASF.cycleStart(c);
    const newMonth = c === lo || ASF.cycleStart(c - 1).getUTCMonth() !== a.getUTCMonth();
    const cls = ["ex-cy", c === S.cycle ? "on" : "", c === NOW_CYCLE ? "now" : "", mine.has(c) ? "mine" : "", cur && cur.cycle === c ? "cur" : "", n ? "" : "empty"].join(" ");
    html += `<button class="${cls}" data-c="${c}" role="option" aria-selected="${c === S.cycle}" title="Cycle ${c}: ${ASF.fmtDay(a, false)} – ${ASF.fmtDay(ASF.cycleEnd(c))} · ${n} products${c === NOW_CYCLE ? " · in progress" : ""}">
      <span class="ex-cy-bar" style="--h:${n ? Math.max(8, (n / max) * 100) : 0}%"></span>
      <span class="ex-cy-n">${c}</span>${newMonth ? `<span class="ex-cy-m">${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][a.getUTCMonth()]}${a.getUTCMonth() === 0 || c === lo ? " " + String(a.getUTCFullYear()).slice(2) : ""}</span>` : ""}</button>`;
  }
  bars.innerHTML = html;
  const read = $("tl-read");
  read.textContent = S.cycle != null
    ? `Cycle ${S.cycle} · ${ASF.fmtDay(ASF.cycleStart(S.cycle), false)} – ${ASF.fmtDay(ASF.cycleEnd(S.cycle))}${S.cycle === NOW_CYCLE ? " · in progress" : ""}`
    : `All cycles · now cycle ${NOW_CYCLE}`;
  $("tl-all").setAttribute("aria-pressed", String(S.cycle == null));
  const on = bars.querySelector(".on") || bars.querySelector(".cur");
  if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function setCycle(c) {
  S.cycle = c;
  styleAll(); renderResults();
  const st = curStack();
  if (st && c != null) {
    const list = curList(), i = list.findIndex((p) => inCycle(p, c));
    if (i >= 0 && i !== S.idx) { S.idx = i; renderStack(); showCurrent(); }
  }
  renderTimeline(); updateQuicklooks(); saveHash();
}
$("tl-bars").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; const c = +b.dataset.c; setCycle(S.cycle === c ? null : c); });
$("tl-all").addEventListener("click", () => setCycle(null));
function stepCycle(d) {
  const have = [...new Set(S.products.map((p) => p.cycle))].sort((a, b) => a - b);
  const from = S.cycle ?? current()?.cycle ?? (d > 0 ? -Infinity : Infinity);
  const next = d > 0 ? have.find((c) => c > from) : have.reverse().find((c) => c < from);
  if (next != null) setCycle(next);
}
$("tl-prev").addEventListener("click", () => stepCycle(-1));
$("tl-next").addEventListener("click", () => stepCycle(1));

// ---------------------------------------------------------------- right panel
const right = $("right"), body = $("right-body");
function openRight() { right.hidden = false; document.body.classList.add("ex-has-right"); if (mobile()) setSheet("details"); }
function closeRight() {
  stopPlay(); endCompare();
  const prev = S.sel; S.sel = null; S.series = null;
  styleStack(S.stacks.get(prev)); render();
  dropOverlay("cur");
  right.hidden = true; document.body.classList.remove("ex-has-right");
  renderResults(); renderTimeline(); updateQuicklooks(); saveHash();
  if (mobile()) setSheet("search");
}
$("right-close").addEventListener("click", closeRight);

function selectStack(key, { fly = false, type, id } = {}) {
  const s = S.stacks.get(key); if (!s) return;
  const prev = S.sel;
  if (prev !== key) { stopPlay(); endCompare(); S.series = null; }
  S.sel = key;
  S.type = type && s.types.includes(type) ? type : s.types.includes(S.type) ? S.type : s.types[0];
  const list = curList();
  let i = id ? list.findIndex((p) => p.id === id) : -1;
  if (i < 0 && S.cycle != null) i = list.findIndex((p) => inCycle(p, S.cycle));
  S.idx = i >= 0 ? i : list.length - 1;
  S.cmpB = S.idx; S.cmpA = Math.max(0, S.idx - 1);
  styleStack(S.stacks.get(prev)); styleStack(s); render();
  if (fly) flyToRing(s.ring);
  openRight(); renderStack(); showCurrent();
  renderResults(); renderTimeline(); updateQuicklooks(); saveHash();
  loadHistory(s);
}

// A search returns at most the newest 500 products, so a selected frame fetches its whole history
// (every product type, every cycle) in one small query of its own.
const historyCache = new Map();
async function loadHistory(s) {
  if (s.full) return;
  s.full = true;
  const lab = () => body.querySelector(".ex-r-head .ex-lab .muted");
  if (lab()) lab().textContent = "· loading the full history…";
  try {
    if (!historyCache.has(s.key)) historyCache.set(s.key, ASF.search({ types: Object.keys(ASF.TYPES), track: s.track, frame: s.frame, dir: s.dir, max: 1000 }));
    const list = await historyCache.get(s.key);
    const have = new Set(s.items.map((p) => p.id));
    const add = list.filter((p) => p.key === s.key && !have.has(p.id));
    if (add.length) {
      const keepId = S.sel === s.key ? current()?.id : null;
      s.items.push(...add);
      s.items.sort((a, b) => a.start - b.start);
      s.types = TYPE_ORDER.filter((t) => s.items.some((p) => p.type === t));
      if (S.sel === s.key) {
        const l = curList(), i = keepId ? l.findIndex((p) => p.id === keepId) : -1;
        S.idx = i >= 0 ? i : l.length - 1;
        S.cmpB = S.idx; S.cmpA = Math.max(0, S.idx - 1);
        renderStack(); renderTimeline(); renderResults();
        if (S.curApprox) showCurrent();   // the history may hold a public KML for this frame
      }
    }
    s.loaded = true;
    if (S.sel === s.key && lab()) lab().textContent = `· ${s.items.length} products, full history`;
  } catch (e) {
    s.full = false; historyCache.delete(s.key);
    if (S.sel === s.key && lab()) lab().textContent = "· couldn't load the full history";
  }
}

function dateLabel(p) {
  if (p.sec) return `<b>C${p.cycle}→${p.cycle2 ?? "?"}</b>${ASF.fmtDay(p.start, false)} → ${ASF.fmtDay(p.sec, false)}`;
  return `<b>C${p.cycle}</b>${ASF.fmtDay(p.start, false)}`;
}
const optLabel = (p) => (p.sec ? `${ASF.fmtDay(p.start, false)} → ${ASF.fmtDay(p.sec)}` : `${ASF.fmtDay(p.start)} · cycle ${p.cycle}`);

function renderStack() {
  const s = curStack(); if (!s) return;
  const list = curList(), p = current(), T = ASF.TYPES[S.type] || {};
  const typeTabs = s.types.map((t) => `<button type="button" class="btn sm" role="radio" aria-checked="${t === S.type}" data-t="${t}" title="${esc(ASF.TYPES[t]?.long || t)}">${esc(ASF.TYPES[t]?.label || t)} <span class="ex-n">${items(s, t).length}</span></button>`).join("");
  const ch = p ? ASF.channels(p) : { r: "HH", g: "HV" };
  const cmpOK = list.length > 1 && !T.noBrowse;
  const opts = list.map((q, i) => `<option value="${i}">${esc(optLabel(q))}</option>`).join("");
  body.innerHTML = `
    <div class="ex-r-head">
      <div class="ex-lab">Frame <span class="muted">· ${s.items.length} products${s.loaded ? ", full history" : s.full ? ", loading the full history…" : " in results"}</span></div>
      <h2>Track ${ASF.pad3(s.track)} · Frame ${ASF.pad3(s.frame)}</h2>
      <span class="ex-dirchip ${s.dir === "A" ? "a" : "d"}">${s.dir === "A" ? "North ↑ · dawn pass" : "South ↓ · dusk pass"}</span>
    </div>
    <div class="chip-row ex-types" role="radiogroup" aria-label="Product type">${typeTabs}</div>
    <div class="ex-strip">
      <button class="btn sm" id="d-prev" aria-label="Earlier date">‹</button>
      <div class="ex-dates" id="d-list" role="listbox" aria-label="Dates">${list.map((q, i) => `<button role="option" class="ex-date${i === S.idx ? " on" : ""}" aria-selected="${i === S.idx}" data-i="${i}">${dateLabel(q)}</button>`).join("")}</div>
      <button class="btn sm" id="d-next" aria-label="Later date">›</button>
      <button class="btn sm" id="d-play" aria-pressed="${S.playing}" ${list.length < 2 || T.noBrowse ? "disabled" : ""}>${S.playing ? "Pause" : "Play"}</button>
    </div>
    <div class="ex-cur" id="cur"></div>
    <section class="ex-sec" id="sec-cmp" ${cmpOK ? "" : "hidden"}>
      <h3 class="ex-lab">Compare two dates</h3>
      <div class="ex-grid2">
        <label class="ex-fld"><span class="ex-lab">A · before</span><select id="cmp-a">${opts}</select></label>
        <label class="ex-fld"><span class="ex-lab">B · after</span><select id="cmp-b">${opts}</select></label>
      </div>
      <div class="chip-row">
        <button class="btn sm" id="cmp-swipe" aria-pressed="${S.compare?.mode === "swipe"}">Swipe A | B</button>
        <button class="btn sm" id="cmp-change" aria-pressed="${S.compare?.mode === "change"}" ${T.rgb ? "" : 'disabled title="Change maps need backscatter images"'}>Change map</button>
      </div>
      <div id="cmp-out"></div>
    </section>
    <section class="ex-sec" id="sec-probe" ${T.noBrowse ? "hidden" : ""}>
      <h3 class="ex-lab">Point</h3>
      <div id="probe"></div>
    </section>`;
  if (cmpOK) { $("cmp-a").value = S.cmpA; $("cmp-b").value = S.cmpB; }
  renderCurrent(); renderCompareOut(); renderProbe();
  const on = body.querySelector(".ex-date.on");
  if (on) on.scrollIntoView({ block: "nearest", inline: "center" });
}

function renderCurrent() {
  const p = current(), box = $("cur"); if (!box) return;
  if (!p) { box.innerHTML = ""; return; }
  const T = ASF.TYPES[p.type] || {}, ch = ASF.channels(p);
  const when = p.sec
    ? `<b>${ASF.fmtDay(p.start)} → ${ASF.fmtDay(p.sec)}</b><span>${Math.round((p.sec - p.start) / 864e5)} days apart · cycles ${p.cycle} → ${p.cycle2 ?? "?"}</span>`
    : `<b>${ASF.fmtDay(p.start)}</b><span>${ASF.fmtTime(p.start)} · cycle ${p.cycle}</span>`;
  const key = T.noBrowse
    ? `<p class="ex-hint">Soil moisture is published as data only, with no quick-look image. Download the file to map it.</p>`
    : T.pair
      ? `<p class="ex-key"><i class="ex-key-phase"></i>Colours cycle with the change in radar phase between the two dates. Broad smooth bands are mostly atmosphere and ionosphere; tight local rings can be the ground moving.</p>`
      : `<p class="ex-key"><i style="background:#e0306f"></i>${esc(ch.r)}${ch.g ? ` <i style="background:#38c060"></i>${esc(ch.g)}` : ""} <span class="muted">· bright = strong echo, green = vegetation, dark = water or smooth ground</span></p>`;
  box.innerHTML = `
    <div class="ex-when">${when}</div>
    <dl class="ex-meta">
      <div><dt>Product</dt><dd>${esc(T.long || p.type)}</dd></div>
      <div><dt>Polarisation</dt><dd>${esc(p.pol.join(", ") || "–")}</dd></div>
      <div><dt>Coverage</dt><dd>${esc(p.coverage ? p.coverage + " frame" : "–")}</dd></div>
      <div><dt>File</dt><dd>${ASF.fmtSize(p.bytes)} HDF5</dd></div>
    </dl>
    ${key}
    <div class="ex-imgstate data" id="img-state"></div>
    <div class="chip-row ex-acts">
      ${T.noBrowse ? "" : `<button class="btn sm" id="cur-toggle" aria-pressed="${S.showCur}">On globe</button>`}
      ${p.browse ? `<a class="btn sm" href="${esc(p.browse)}" target="_blank" rel="noopener">Quick-look PNG ↗</a>` : ""}
      ${p.url ? `<a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener" title="Needs a free NASA Earthdata login">Download HDF5 ↗</a>` : ""}
      ${p.qa ? `<a class="btn sm" href="${esc(p.qa)}" target="_blank" rel="noopener" title="Quality report (Earthdata login)">QA report ↗</a>` : ""}
      <button class="btn sm" id="cur-copy">Copy ID</button>
    </div>
    <p class="ex-hint">The HDF5 download needs a free NASA Earthdata login.</p>`;
  imgState(S.imgMsg || "");
}
function imgState(msg) { S.imgMsg = msg; const el = $("img-state"); if (el) el.innerHTML = msg; }

body.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-i]"); if (!t) return;
  if (t.dataset.t) { stopPlay(); endCompare(); S.series = null; selectStack(S.sel, { type: t.dataset.t }); return; }
  if (t.dataset.i != null && t.classList.contains("ex-date")) { stopPlay(); goTo(+t.dataset.i); return; }
  if (t.dataset.key) { selectStack(t.dataset.key, { fly: true }); return; }
  if (t.dataset.plan) { findPlanned(JSON.parse(t.dataset.plan)); return; }
  switch (t.id) {
    case "d-prev": stopPlay(); goTo(S.idx - 1); break;
    case "d-next": stopPlay(); goTo(S.idx + 1); break;
    case "d-play": S.playing ? stopPlay() : startPlay(); break;
    case "cur-toggle": S.showCur = !S.showCur; t.setAttribute("aria-pressed", String(S.showCur)); { const o = ov.get("cur"); if (o) o.layer.show = S.showCur && S.compare?.mode !== "swipe"; } render(); break;
    case "cur-copy": navigator.clipboard?.writeText(current()?.id || "").then(() => { t.textContent = "Copied"; setTimeout(() => (t.textContent = "Copy ID"), 1400); }); break;
    case "cmp-swipe": S.compare?.mode === "swipe" ? endCompare() : startSwipe(); break;
    case "cmp-change": S.compare?.mode === "change" ? endCompare() : startChange(); break;
    case "ts-go": plotSeries(); break;
    case "ts-csv": downloadCsv(); break;
    case "here-search": setWhere("point"); runSearch(); break;
  }
});
body.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "cmp-a" || t.id === "cmp-b") {
    S[t.id === "cmp-a" ? "cmpA" : "cmpB"] = +t.value;
    if (S.compare?.mode === "swipe") startSwipe();
    else if (S.compare?.mode === "change") startChange();
    else renderCompareOut();
  }
  if (t.id === "cmp-ch") { S.cmpChannel = t.value; if (S.compare?.mode === "change") startChange(); }
});
let thrTimer = 0;
body.addEventListener("input", (e) => {
  if (e.target.id !== "cmp-thr") return;
  S.cmpK = +e.target.value;
  $("cmp-thr-v").textContent = S.cmpK.toFixed(1) + "×";
  clearTimeout(thrTimer); thrTimer = setTimeout(() => S.compare?.mode === "change" && startChange(), 250);
});

function goTo(i) {
  const list = curList(); if (!list.length) return;
  S.idx = (i + list.length) % list.length;
  body.querySelectorAll(".ex-date").forEach((b) => { const on = +b.dataset.i === S.idx; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  body.querySelector(".ex-date.on")?.scrollIntoView({ block: "nearest", inline: "center" });
  renderCurrent();
  return showCurrent();
}

let showTok = 0;
async function showCurrent() {
  const p = current(); if (!p) return;
  const tok = ++showTok;
  if (S.cycle != null && !inCycle(p, S.cycle)) { S.cycle = p.cycle; styleAll(); renderResults(); updateQuicklooks(); }
  renderTimeline(); renderProbe(); saveHash();
  if (!p.browse) { dropOverlay("cur"); imgState(""); return; }
  const cached = IMG.hasBlob(p.browse);
  imgState(cached ? "Placing quick-look…" : `<span class="ex-spin"></span>Downloading quick-look${p.type === "GCOV" ? " (≈4 MB)" : ""}…`);
  try {
    const [rect, blob] = await Promise.all([boundsOf(p), IMG.getBlob(p.browse)]);
    if (tok !== showTok) return;
    await putOverlay("cur", blob, rect, { show: S.showCur && S.compare?.mode !== "swipe", alpha: S.compare?.mode === "change" ? Math.min(S.opacity, 0.35) : S.opacity });
    if (tok !== showTok) return;
    S.curApprox = !!rect.approx;
    imgState(rect.approx ? "On the globe · placed by footprint (approximate)" : "On the globe");
    const list = curList();
    [list[S.idx + 1], list[S.idx - 1]].forEach((q) => q?.browse && IMG.getBlob(q.browse).catch(() => {}));   // prefetch neighbours
    renderProbe();
  } catch (e) {
    if (tok === showTok) imgState(`Couldn't load the quick-look (${esc(e.message)}).`);
  }
}

// ---- play through cycles
let playTimer = 0;
function startPlay() {
  if (curList().length < 2) return;
  endCompare();
  S.playing = true;
  const b = $("d-play"); if (b) { b.textContent = "Pause"; b.setAttribute("aria-pressed", "true"); }
  const step = async () => {
    if (!S.playing) return;
    await goTo(S.idx + 1);
    if (S.playing) playTimer = setTimeout(step, 1300);
  };
  playTimer = setTimeout(step, 300);
}
function stopPlay() {
  S.playing = false; clearTimeout(playTimer);
  const b = $("d-play"); if (b) { b.textContent = "Play"; b.setAttribute("aria-pressed", "false"); }
}

// ---------------------------------------------------------------- compare: swipe & change map
const split = $("split");
async function startSwipe() {
  const list = curList(), A = list[S.cmpA], B = list[S.cmpB];
  if (!A || !B || !A.browse || !B.browse) return;
  stopPlay();
  dropOverlay("chg");
  S.compare = { mode: "swipe" };
  const o = ov.get("cur"); if (o) o.layer.show = false;
  renderCompareOut(`<span class="ex-spin"></span>Loading both dates…`);
  syncCmpButtons();
  try {
    const [ra, ba, rb, bb] = await Promise.all([boundsOf(A), IMG.getBlob(A.browse), boundsOf(B), IMG.getBlob(B.browse)]);
    if (S.compare?.mode !== "swipe") return;
    await Promise.all([putOverlay("A", ba, ra, { split: C.SplitDirection.LEFT }), putOverlay("B", bb, rb, { split: C.SplitDirection.RIGHT })]);
    if (S.compare?.mode !== "swipe") return;
    $("split-a").textContent = "A · " + optLabel(A);
    $("split-b").textContent = "B · " + optLabel(B);
    if (!split.style.left) split.style.left = "50%";
    scene.splitPosition = parseFloat(split.style.left) / 100;
    split.hidden = false;
    renderCompareOut();
    render();
  } catch (e) { renderCompareOut(`Couldn't load: ${esc(e.message)}`); }
}
async function startChange() {
  const list = curList(), A = list[S.cmpA], B = list[S.cmpB];
  if (!A || !B || !A.browse || !B.browse) return;
  stopPlay();
  if (S.cmpA === S.cmpB) { renderCompareOut("Pick two different dates."); return; }
  dropOverlay("A"); dropOverlay("B"); split.hidden = true;
  S.compare = { mode: "change" };
  syncCmpButtons();
  if (S.idx !== S.cmpB) { S.idx = S.cmpB; goTo(S.idx); }
  renderCompareOut(`<span class="ex-spin"></span>Computing change…`);
  try {
    const [ra, rb, ba, bb] = await Promise.all([boundsOf(A), boundsOf(B), IMG.bitmap(A.browse), IMG.bitmap(B.browse)]);
    if (S.compare?.mode !== "change") return;
    const res = await IMG.changeMap({ bmp: ba, rect: ra }, { bmp: bb, rect: rb }, { channel: S.cmpChannel, k: S.cmpK });
    const blob = await IMG.canvasBlob(res.canvas);
    if (S.compare?.mode !== "change") return;
    await putOverlay("chg", blob, res.rect, { alpha: 1 });
    const o = ov.get("cur"); if (o) o.layer.alpha = Math.min(S.opacity, 0.35);   // dim B so the change pops
    S.cmpStats = { ...res.stats, A, B };
    renderCompareOut();
  } catch (e) { renderCompareOut(`Couldn't compute: ${esc(e.message)}`); }
}
function endCompare() {
  if (!S.compare) return;
  S.compare = null; S.cmpStats = null;
  dropOverlay("A"); dropOverlay("B"); dropOverlay("chg");
  split.hidden = true;
  const o = ov.get("cur"); if (o) { o.layer.show = S.showCur; o.layer.alpha = S.opacity; }
  syncCmpButtons(); renderCompareOut(); render();
}
function syncCmpButtons() {
  const sw = $("cmp-swipe"), ch = $("cmp-change");
  sw?.setAttribute("aria-pressed", String(S.compare?.mode === "swipe"));
  ch?.setAttribute("aria-pressed", String(S.compare?.mode === "change"));
}
function renderCompareOut(msg) {
  const out = $("cmp-out"); if (!out) return;
  if (msg) { out.innerHTML = `<p class="ex-hint">${msg}</p>`; return; }
  const list = curList(), A = list[S.cmpA], B = list[S.cmpB];
  if (!S.compare) {
    const days = A && B ? Math.round(Math.abs(B.start - A.start) / 864e5) : 0;
    out.innerHTML = `<p class="ex-hint">${A && B && A !== B ? `${days} days apart (${Math.round(days / 12)} cycles). ` : ""}Swipe slides a divider across the globe. A change map marks where the radar echo got brighter or darker.</p>`;
    return;
  }
  if (S.compare.mode === "swipe") {
    out.innerHTML = `<p class="ex-hint">Drag the divider on the globe. Left: <b>A</b> ${esc(optLabel(A))}. Right: <b>B</b> ${esc(optLabel(B))}.</p>`;
    return;
  }
  const ch = ASF.channels(B), st = S.cmpStats;
  const pct = (n) => (st && st.overlap ? ((100 * n) / st.overlap).toFixed(1) : "–");
  out.innerHTML = `
    <div class="ex-grid2">
      <label class="ex-fld"><span class="ex-lab">Channel</span><select id="cmp-ch">
        ${ch.g ? `<option value="g" ${S.cmpChannel === "g" ? "selected" : ""}>${esc(ch.g)} (cross-pol)</option>` : ""}
        <option value="r" ${S.cmpChannel === "r" ? "selected" : ""}>${esc(ch.r)} (co-pol)</option>
        <option value="all" ${S.cmpChannel === "all" ? "selected" : ""}>Overall brightness</option></select></label>
      <label class="ex-fld"><span class="ex-lab">Flag beyond <b id="cmp-thr-v">${S.cmpK.toFixed(1)}×</b> noise</span><input id="cmp-thr" type="range" min="1.5" max="6" step="0.5" value="${S.cmpK}"></label>
    </div>
    <div class="ex-diverge"><span>Darker in B</span><i></i><span>Brighter in B</span></div>
    ${st ? `<dl class="ex-meta ex-stats"><div><dt>Brighter</dt><dd>${pct(st.up)}%</dd></div><div><dt>Darker</dt><dd>${pct(st.down)}%</dd></div><div><dt>Compared</dt><dd>${(st.overlap / 1e6).toFixed(2)} Mpx</dd></div></dl>` : ""}
    <p class="ex-hint">Radar images are grainy (speckle) and each quick-look is stretched on its own, so the map first removes the overall difference${st ? ` (B ${st.shift >= 0 ? "+" : ""}${st.shift} grey levels)` : ""} and measures the typical pixel-to-pixel noise${st ? ` (±${st.sigma.toFixed(0)})` : ""}. Only changes well beyond that noise are coloured. Treat it as a pointer to look closer. In L-band, new darkness often means open water or cleared ground; new brightness can mean flooding under trees, wetter soil or new structures.</p>`;
}

// drag the swipe divider
{
  let drag = false;
  split.addEventListener("pointerdown", (e) => { drag = true; split.setPointerCapture(e.pointerId); e.preventDefault(); });
  split.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = viewer.container.getBoundingClientRect();
    const f = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width));
    split.style.left = f * 100 + "%"; scene.splitPosition = f; render();
  });
  const up = () => (drag = false);
  split.addEventListener("pointerup", up); split.addEventListener("pointercancel", up);
}

// ---------------------------------------------------------------- probe & time series
const fmtLL = (ll) => `${Math.abs(ll.lat).toFixed(4)}° ${ll.lat >= 0 ? "N" : "S"}, ${Math.abs(ll.lon).toFixed(4)}° ${ll.lon >= 0 ? "E" : "W"}`;
let probeTok = 0;
async function renderProbe() {
  const box = $("probe"); if (!box) return;
  const p = current(), s = curStack();
  if (!S.point || !s || !ASF.contains(s.ring, S.point.lon, S.point.lat)) {
    box.innerHTML = `<p class="ex-hint">Click inside the frame to read the radar image there and follow that spot through time.</p>`;
    return;
  }
  const T = ASF.TYPES[S.type] || {}, list = curList().filter((q) => q.browse);
  const head = `<div class="ex-ll data">${fmtLL(S.point)}</div>`;
  const tsBtn = T.rgb && list.length > 1
    ? `<button class="btn sm" id="ts-go">Plot through time · ${list.length} dates</button>` : "";
  const keepSeries = S.series && S.series.key === `${S.sel}|${S.type}|${S.point.lon}|${S.point.lat}`;
  box.innerHTML = `${head}<div id="probe-v" class="ex-probe-v"><span class="ex-spin"></span>Reading pixels…</div>
    <div class="chip-row">${keepSeries ? "" : tsBtn}</div><div id="ts"></div>`;
  if (keepSeries) drawSeries();
  if (!p || !p.browse) { $("probe-v").textContent = ""; return; }
  const tok = ++probeTok;
  try {
    const [rect, bmp] = await Promise.all([boundsOf(p), IMG.bitmap(p.browse)]);
    if (tok !== probeTok) return;
    const v = IMG.sample(bmp, rect, S.point.lon, S.point.lat);
    const el = $("probe-v"); if (!el) return;
    if (!v) { el.textContent = "No radar data at this spot on this date (outside the swath)."; return; }
    if (T.pair) {
      el.innerHTML = `<span class="ex-swatch" style="background:rgb(${v.r | 0},${v.g | 0},${v.b | 0})"></span> phase colour <span class="muted">· read the pattern, not single pixels</span>`;
      return;
    }
    const ch = ASF.channels(p);
    const bar = (name, val, col) => `<div class="ex-bar"><span>${esc(name)}</span><i><b style="width:${(val / 255) * 100}%;background:${col}"></b></i><em>${Math.round(val)}</em></div>`;
    el.innerHTML = bar(ch.r, v.r, SERIES_COL.r) + (ch.g ? bar(ch.g, v.g, SERIES_COL.g) : "") +
      `<p class="ex-hint">Quick-look grey levels (0–255) in a 5 × 5 pixel window, ${ASF.fmtDay(p.start)}.</p>`;
  } catch (e) {
    const el = $("probe-v"); if (el && tok === probeTok) el.textContent = `Couldn't read the image (${e.message}).`;
  }
}

let seriesTok = 0;
async function plotSeries() {
  const s = curStack(), pt = S.point; if (!s || !pt) return;
  const list = curList().filter((q) => q.browse);
  const key = `${S.sel}|${S.type}|${pt.lon}|${pt.lat}`;
  const tok = ++seriesTok;
  const box = $("ts"), btn = $("ts-go");
  if (btn) btn.disabled = true;
  const rows = [];
  let done = 0;
  const prog = () => { if ($("ts") && tok === seriesTok) $("ts").innerHTML = `<p class="ex-hint"><span class="ex-spin"></span>Reading ${done} of ${list.length} quick-looks (they download once, then stay cached)…</p>`; };
  prog();
  const queue = list.slice();
  const work = async () => {
    while (queue.length && tok === seriesTok) {
      const p = queue.shift();
      try {
        const rect = await boundsOf(p);
        const bmp = await IMG.decodeOnce(p.browse);
        const v = IMG.sample(bmp, rect, pt.lon, pt.lat);
        bmp.close?.();
        rows.push({ date: p.start, cycle: p.cycle, v: { r: v ? v.r : null, g: v ? v.g : null } });
      } catch { rows.push({ date: p.start, cycle: p.cycle, v: { r: null, g: null } }); }
      done++; prog();
    }
  };
  await Promise.all([work(), work()]);
  if (tok !== seriesTok) return;
  rows.sort((a, b) => a.date - b.date);
  S.series = { key, rows, ch: ASF.channels(list[0]), point: pt, frame: s, type: S.type };
  if (box) { const b = $("ts-go"); if (b) b.remove(); drawSeries(); }
}
function drawSeries() {
  const host = $("ts"); if (!host || !S.series) return;
  const { rows, ch } = S.series;
  const ser = [{ key: "r", name: ch.r, color: SERIES_COL.r }];
  if (ch.g) ser.push({ key: "g", name: ch.g, color: SERIES_COL.g });
  if (!rows.some((r) => r.v.r != null)) { host.innerHTML = `<p class="ex-hint">No radar data at this spot on any date.</p>`; return; }
  host.innerHTML = "";
  const chart = document.createElement("div");
  host.appendChild(chart);
  seriesChart(chart, rows, ser, { surface: "#141416" });
  const foot = document.createElement("div");
  foot.className = "ex-ts-foot";
  foot.innerHTML = `<span class="ex-hint">Quick-look grey levels; each image is stretched on its own, so look for jumps, not small wiggles.</span><button class="btn sm" id="ts-csv">CSV</button>`;
  host.appendChild(foot);
}
function downloadCsv() {
  const sr = S.series; if (!sr) return;
  const lines = [`# NISAR ${sr.type} quick-look values, track ${sr.frame.track} frame ${sr.frame.frame} ${sr.frame.dir}, point ${sr.point.lat.toFixed(5)},${sr.point.lon.toFixed(5)}`,
    `date,cycle,${sr.ch.r}${sr.ch.g ? "," + sr.ch.g : ""}`];
  sr.rows.forEach((r) => lines.push(`${r.date.toISOString()},${r.cycle},${r.v.r == null ? "" : r.v.r.toFixed(1)}${sr.ch.g ? "," + (r.v.g == null ? "" : r.v.g.toFixed(1)) : ""}`));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  a.download = `nisar_t${ASF.pad3(sr.frame.track)}_f${ASF.pad3(sr.frame.frame)}_${sr.type.toLowerCase()}_${sr.point.lat.toFixed(3)}_${sr.point.lon.toFixed(3)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- "here": a point with no selected frame
let hereTok = 0;
function showHere(ll, hits) {
  if (S.sel) { stopPlay(); endCompare(); const prev = S.sel; S.sel = null; styleStack(S.stacks.get(prev)); dropOverlay("cur"); renderResults(); renderTimeline(); updateQuicklooks(); }
  openRight();
  const tok = ++hereTok;
  body.innerHTML = `
    <div class="ex-r-head"><div class="ex-lab">Point</div><h2 class="ex-h2-ll">${fmtLL(ll)}</h2></div>
    <section class="ex-sec"><h3 class="ex-lab">Frames in your results</h3>
      ${hits.length ? `<ul class="ex-mini">${hits.map((s) => `<li><button class="ex-res" data-key="${s.key}"><span class="ex-res-id">T${ASF.pad3(s.track)} <span class="muted">F</span>${ASF.pad3(s.frame)} <i class="ex-dir ${s.dir === "A" ? "a" : "d"}">${s.dir === "A" ? "↑" : "↓"}</i></span><span class="ex-res-types">${s.items.length} products</span><span class="ex-res-date">${ASF.fmtDay(s.latest, false)}</span></button></li>`).join("")}</ul>`
        : `<p class="ex-hint">None of the current results cover this spot.</p><button class="btn sm" id="here-search">Search at this point</button>`}
    </section>
    <section class="ex-sec"><h3 class="ex-lab">NISAR's plan for this spot <span class="muted">· NASA</span></h3><div id="here-plan"><p class="ex-hint"><span class="ex-spin"></span>Asking NASA's observation plan…</p></div></section>`;
  saveHash();
  if (!window.NASA_GIS) { $("here-plan").innerHTML = `<p class="ex-hint">Plan service unavailable.</p>`; return; }
  window.NASA_GIS.passesOver(ll.lat, ll.lon).then((fs) => {
    if (tok !== hereTok || !$("here-plan")) return;
    if (!fs.length) { $("here-plan").innerHTML = `<p class="ex-hint">No planned NISAR frames here (open ocean is mostly not imaged).</p>`; return; }
    fs.sort((a, b) => (a.next[0] || "9") .localeCompare(b.next[0] || "9"));
    $("here-plan").innerHTML = `<ul class="ex-mini">${fs.map((f) => {
      const dir = /^a/i.test(f.passdirection) ? "A" : "D";
      const next = f.next.map((d) => ASF.fmtDay(new Date(d + "T00:00:00Z"), false)).join(", ");
      const arg = esc(JSON.stringify({ track: f.track, frame: f.frame, dir }));
      return `<li class="ex-plan"><span class="ex-res-id">T${ASF.pad3(f.track)} <span class="muted">F</span>${ASF.pad3(f.frame)} <i class="ex-dir ${dir === "A" ? "a" : "d"}">${dir === "A" ? "↑" : "↓"}</i></span>
        <span class="ex-res-types">${next ? "next " + next : "no future dates"}${f.acquisition_time ? ` · ~${esc(String(f.acquisition_time).slice(0, 5))} UTC` : ""}</span>
        <button class="btn sm" data-plan="${arg}">Find data</button></li>`;
    }).join("")}</ul><p class="ex-hint">Every frame repeats every 12 days. "Find data" lists all archived products of that frame.</p>`;
  }).catch(() => { if ($("here-plan")) $("here-plan").innerHTML = `<p class="ex-hint">Couldn't reach NASA's plan service.</p>`; });
}
function findPlanned({ track, frame, dir }) {
  $("f-track").value = track; $("f-frame").value = frame; $("f-dir").value = dir;
  $("f-cycle").value = ""; syncDates();
  setWhere("any");
  pending = { key: `${track}-${frame}-${dir}`, fly: true };
  runSearch();
}

// ---------------------------------------------------------------- whole-track plan (NASA)
async function drawPlan(track) {
  planDS.entities.removeAll(); S.plan = null;
  const btn = $("plan-btn");
  if (!track) { btn.setAttribute("aria-pressed", "false"); render(); return; }
  btn.textContent = "Loading…";
  try {
    const frames = await window.NASA_GIS.track(track);
    for (const f of frames) for (const ring of f.rings) {
      const pos = C.Cartesian3.fromDegreesArray(ring.flat());
      planDS.entities.add({ polyline: { positions: pos, width: 1.2, material: new C.PolylineDashMaterialProperty({ color: color(COL.plan, 0.8), dashLength: 10 }), arcType: C.ArcType.GEODESIC } });
      const [x, y] = ASF.centroid(ring);
      planDS.entities.add({ position: C.Cartesian3.fromDegrees(x, y), label: { text: String(f.frame), font: "11px sans-serif", fillColor: color(COL.plan, 0.9), outlineColor: color("#0b0b0c"), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 6e6), disableDepthTestDistance: 0 } });
    }
    S.plan = track;
    btn.setAttribute("aria-pressed", "true");
    $("res-head").innerHTML = `Track ${track}: ${frames.length} planned frames drawn (dashed). Click a frame on the globe to see its next passes.`;
  } catch (e) {
    $("res-head").textContent = `Couldn't load the plan for track ${track}: ${e.message}`;
  } finally { btn.textContent = "Track plan"; render(); }
}
$("plan-btn").addEventListener("click", () => {
  const t = Math.round(+$("f-track").value);
  if (S.plan && (!t || t === S.plan)) { drawPlan(null); return; }
  if (!t || t < 1 || t > 173) { $("res-head").textContent = "Type a track number (1–173) first."; $("f-track").focus(); return; }
  drawPlan(t);
});

// ---------------------------------------------------------------- quick-look mosaic (thumbnails)
let qlTok = 0;
async function updateQuicklooks() {
  const tok = ++qlTok;
  dropOverlays("ql:");
  if (!S.quick) { $("ql-sub").textContent = "Small previews of every frame in the results"; return; }
  const picks = [];
  for (const s of S.stacks.values()) {
    if (!stackVisible(s) || s.key === S.sel) continue;
    const cand = s.items.filter((p) => p.thumb && inCycle(p, S.cycle)).sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || b.start - a.start);
    if (cand[0]) picks.push(cand[0]);
  }
  // nearest the middle of the screen first (each preview is its own globe layer, so they are capped)
  const mid = pickLL(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2));
  if (mid) {
    const d2 = (p) => { const [x, y] = ASF.centroid(p.ring); const dx = (x - mid.lon) * Math.cos((mid.lat * Math.PI) / 180); return dx * dx + (y - mid.lat) ** 2; };
    picks.sort((a, b) => d2(a) - d2(b));
  }
  const LIMIT = 80, use = picks.slice(0, LIMIT);
  $("ql-sub").textContent = `${use.length} previews${S.cycle != null ? ` · cycle ${S.cycle}` : " · newest per frame"}${picks.length > LIMIT ? ` (of ${picks.length})` : ""}`;
  let i = 0;
  const work = async () => {
    while (i < use.length && tok === qlTok) {
      const p = use[i++];
      try { const rect = await boundsOf(p); if (tok === qlTok) await putOverlay("ql:" + p.id, p.thumb, rect, { alpha: 0.85 }); } catch {}
    }
  };
  await Promise.all([work(), work(), work(), work()]);
}

// ---------------------------------------------------------------- team analyses (calibrated, from this repo)
const TEAM = [
  // the only finished team analysis so far: the ground sinking around Knurów (same NISAR data as the
  // Knurów story on the main page)
  { id: "knurow", name: "Knurów: a town that keeps sinking", sub: "NISAR GUNW · track 57 · 12 → 24 Jul 2026", src: "../data/out/silesia_057_0712_0724_overlay.png", meta: "../data/out/silesia_057_0712_0724_overlay.json",
    fly: { lon: 18.68, lat: 50.2, h: 4.5e4 },   // the sinking bowls are small: start close to Knurów
    legend: `<div class="ex-legend"><i style="background:linear-gradient(90deg,#1f4fd1,#5fb8ff,#f4f1ea,#ff9a3c,#e8322a,#7a0c18)"></i><span>−6 cm rising</span><span>+6 cm sinking</span></div><p class="ex-hint">Line-of-sight movement; under 1 cm is hidden. Dots: peak hotspots. <a href="index.html#poland">Read the Knurów story →</a></p>` },
];
$("team").innerHTML = TEAM.map((t) => `<button class="toggle" data-team="${t.id}" aria-pressed="false"><span class="sw ex-sw-team"></span><span>${esc(t.name)}<small>${esc(t.sub)}</small></span><span class="st">OFF</span></button><div class="ex-team-legend" id="tl-${t.id}" hidden>${t.legend}</div>`).join("");
$("team").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-team]"); if (!b) return;
  const t = TEAM.find((x) => x.id === b.dataset.team), on = b.getAttribute("aria-pressed") !== "true";
  b.setAttribute("aria-pressed", String(on)); b.querySelector(".st").textContent = on ? "ON" : "OFF";
  $("tl-" + t.id).hidden = !on;
  if (!on) { dropOverlay("team:" + t.id); markDS.entities.values.filter((x) => x.id?.startsWith?.("hot:" + t.id)).forEach((x) => markDS.entities.remove(x)); render(); return; }
  try {
    let rect = t.rect, meta = null;
    if (t.meta) {
      meta = await fetch(t.meta).then((r) => r.json());
      const [[s, w], [n, ee]] = meta.bounds;
      rect = { w, s, e: ee, n };
    }
    await putOverlay("team:" + t.id, t.src, rect, { alpha: 0.95 });
    (meta?.hotspots || []).forEach((h, i) => markDS.entities.add({
      id: `hot:${t.id}:${i}`, position: C.Cartesian3.fromDegrees(h.lon, h.lat),
      point: { pixelSize: 7, color: color("#0b0b0c"), outlineColor: color(COL.hi), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: `${h.peak_cm} cm`, font: "12px sans-serif", fillColor: color("#ececee"), outlineColor: color("#0b0b0c"), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(10, -10), horizontalOrigin: C.HorizontalOrigin.LEFT, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 8e5), disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }));
    const pad = 0.15 * (rect.e - rect.w);
    camera.flyTo({ destination: t.fly ? C.Cartesian3.fromDegrees(t.fly.lon, t.fly.lat, t.fly.h) : C.Rectangle.fromDegrees(rect.w - pad, rect.s - pad, rect.e + pad, rect.n + pad), duration: 1.4 });
  } catch (err) {
    b.setAttribute("aria-pressed", "false"); b.querySelector(".st").textContent = "ERR";
    $("tl-" + t.id).innerHTML = `<p class="ex-hint">Couldn't load this layer (${esc(err.message)}).</p>`;
  }
});

// ---------------------------------------------------------------- layer toggles
function toggleBtn(id, fn) {
  const b = $(id);
  b.addEventListener("click", () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); b.querySelector(".st").textContent = on ? "ON" : "OFF"; fn(on); });
}
toggleBtn("t-labels", (on) => { labelLayer.show = on; bordersOn = on; syncBorders(); render(); });
toggleBtn("t-foot", (on) => setAreas(on, on));
// "See NISAR image areas": the centred button at the bottom. Turning it on searches what's on screen
// (unless that search is already showing); turning it off hides the outlines again.
function setAreas(on, search = true) {
  S.foot = on;
  const b = $("areas-btn"), t = $("t-foot");
  b.setAttribute("aria-pressed", String(on)); b.querySelector("span").textContent = on ? "Hide NISAR image areas" : "See NISAR image areas";
  t.setAttribute("aria-pressed", String(on)); t.querySelector(".st").textContent = on ? "ON" : "OFF";
  if (on && search && (!S.lastQ || (S.where === "view" && S.lastQ.wkt !== viewWkt()))) { setWhere(S.where === "point" ? "view" : S.where); runSearch(); }
  styleAll();
}
$("areas-btn").addEventListener("click", () => setAreas(!S.foot));
toggleBtn("t-ql", (on) => { S.quick = on; updateQuicklooks(); });
$("opacity").addEventListener("input", (e) => {
  S.opacity = +e.target.value / 100; $("op-v").textContent = e.target.value + "%";
  ["cur", "A", "B"].forEach((k) => { const o = ov.get(k); if (o) o.layer.alpha = S.opacity; });
  render();
});

// tabs
const tabs = { search: $("tab-search"), layers: $("tab-layers") };
Object.entries(tabs).forEach(([k, b]) => b.addEventListener("click", () => {
  Object.entries(tabs).forEach(([k2, b2]) => { b2.setAttribute("aria-selected", String(k2 === k)); $("pane-" + k2).hidden = k2 !== k; });
}));

// ---------------------------------------------------------------- places
const PRESETS = [
  { name: "Poznań", lon: 16.93, lat: 52.41, h: 1.2e5 },
  { name: "Warsaw", lon: 21.01, lat: 52.23, h: 1.2e5 },
  { name: "USA", lon: -98.5, lat: 39.5, h: 6.5e6 },
];
$("presets").innerHTML = PRESETS.map((p, i) => `<button type="button" class="btn sm" data-preset="${i}">${esc(p.name)}</button>`).join("");
$("presets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-preset]"); if (!b) return;
  const p = PRESETS[+b.dataset.preset];
  if (S.where === "point") setWhere("view");
  // fly there; the image areas follow only if they are switched on
  if (p.h < 1e6) markPlace(p.lon, p.lat, p.name); else markDS.entities.removeById("place");
  camera.flyTo({ destination: C.Cartesian3.fromDegrees(p.lon, p.lat, p.h), duration: 1.6, complete: () => S.foot && S.where === "view" && runSearch() });
});
// the place you searched for: a highlight-coloured dot with its name, until the next search
function markPlace(lon, lat, name) {
  markDS.entities.removeById("place");
  markDS.entities.add({ id: "place", position: C.Cartesian3.fromDegrees(lon, lat),
    point: { pixelSize: 12, color: color(COL.hi), outlineColor: color("#0b0b0c"), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: name, font: "13px Nasalization, sans-serif", fillColor: color("#ececee"), outlineColor: color("#0b0b0c"), outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new C.Cartesian2(12, -12), horizontalOrigin: C.HorizontalOrigin.LEFT, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  render();
  showNextPass(lon, lat, name);
}
// "Next pass over this place": the soonest planned NISAR acquisition over the chosen place, from NASA's
// observation plan (every frame repeats every 12 days), in a box at the bottom right
let nextTok = 0;
const nextBox = $("next-box");
function showNextPass(lon, lat, name) {
  const tok = ++nextTok;
  nextBox.hidden = false;
  nextBox.innerHTML = `<button class="ex-close" data-next-close aria-label="Close">×</button><div class="ex-lab">Next NISAR pass over</div><h3>${esc(name)}</h3><p class="ex-hint" id="next-body"><span class="ex-spin"></span>Checking NASA's observation plan…</p>`;
  const say = (t) => { const b = $("next-body"); if (b && tok === nextTok) b.textContent = t; };
  if (!window.NASA_GIS) { say("NASA's plan service is unavailable."); return; }
  window.NASA_GIS.passesOver(lat, lon).then((fs) => {
    if (tok !== nextTok) return;
    const now = Date.now(), passes = [];
    for (const f of fs) {
      let hm = String(f.acquisition_time || "12:00:00").slice(0, 8);
      if (hm.length === 5) hm += ":00";
      for (const d of String(f.dates || "").split(",").map((x) => x.trim()).filter(Boolean)) {
        const t = new Date(`${d}T${hm}Z`);
        if (+t > now) passes.push({ t, track: f.track, frame: f.frame, dir: /^a/i.test(f.passdirection) ? "A" : "D", approx: !f.acquisition_time });
      }
    }
    passes.sort((a, b) => a.t - b.t);
    if (!passes.length) { say("No planned NISAR passes here (open ocean is mostly not imaged)."); return; }
    const p = passes[0], ms = p.t - now, hrs = ms / 36e5;
    const inTxt = hrs < 1 ? `in ${Math.max(1, Math.round(ms / 6e4))} min` : hrs < 36 ? `in ${Math.round(hrs)} h` : `in ${Math.round(hrs / 24)} days`;
    // just the essentials: when (in the visitor's own time) and how soon
    const local = p.t.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    $("next-body").outerHTML = `<div class="ex-next-when" title="From NASA's NISAR observation plan (${ASF.fmtTime(p.t)}); the exact pass can shift by a few minutes"><b>${p.approx ? "~" : ""}${esc(local)}</b><span>${inTxt}</span></div>`;
  }).catch(() => say("Couldn't reach NASA's plan service."));
}
nextBox.addEventListener("click", (e) => { if (e.target.closest("[data-next-close]")) { nextBox.hidden = true; markDS.entities.removeById("place"); render(); } });
$("place-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("place").value.trim(), hits = $("place-hits");
  if (!q) return;
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { markPlace(lon, lat, fmtLL({ lon, lat })); camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, 6e4), duration: 1.4 }); hits.hidden = true; return; }
  }
  hits.hidden = false; hits.innerHTML = `<li class="ex-hint"><span class="ex-spin"></span>Searching…</li>`;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "en" } });
    const list = await r.json();
    if (!list.length) { hits.innerHTML = `<li class="ex-hint">No place found.</li>`; return; }
    hits.innerHTML = list.map((h, i) => `<li><button type="button" data-hit="${i}">${esc(h.display_name)}</button></li>`).join("") + `<li class="ex-attr">Search: © OpenStreetMap contributors (Nominatim)</li>`;
    hits.onclick = (ev) => {
      const b = ev.target.closest("[data-hit]"); if (!b) return;
      const h = list[+b.dataset.hit], [s, n, w, ee] = h.boundingbox.map(Number);
      const minSpan = 0.15, cx = (w + ee) / 2, cy = (s + n) / 2, hx = Math.max(minSpan, ee - w) / 2, hy = Math.max(minSpan, n - s) / 2;
      markPlace(+h.lon, +h.lat, (h.name || h.display_name.split(",")[0]).trim());
      camera.flyTo({ destination: C.Rectangle.fromDegrees(cx - hx * 1.3, cy - hy * 1.3, cx + hx * 1.3, cy + hy * 1.3), duration: 1.6 });
      hits.hidden = true;
    };
  } catch { hits.innerHTML = `<li class="ex-hint">Place search is unavailable right now.</li>`; }
});

// ---------------------------------------------------------------- globe interaction
const handler = new C.ScreenSpaceEventHandler(scene.canvas);
const pickLL = (pos) => {
  const c = camera.pickEllipsoid(pos, ellipsoid); if (!c) return null;
  const g = C.Cartographic.fromCartesian(c);
  return { lon: deg(g.longitude), lat: deg(g.latitude) };
};
const tip = $("tip");
let movePos = null, moveRaf = 0;
handler.setInputAction((m) => { movePos = m.endPosition; if (!moveRaf) moveRaf = requestAnimationFrame(onHover); }, C.ScreenSpaceEventType.MOUSE_MOVE);
function onHover() {
  moveRaf = 0;
  const ll = movePos && pickLL(movePos);
  $("st-pos").textContent = ll ? fmtLL(ll) : "–";
  const hits = ll ? stacksAt(ll) : [];
  setHover(hits[0]?.key || null);
  if (!hits.length) { tip.hidden = true; return; }
  tip.innerHTML = hits.slice(0, 4).map((s) => `<div><b>T${ASF.pad3(s.track)} F${ASF.pad3(s.frame)}</b> ${s.dir === "A" ? "↑" : "↓"} <span class="muted">${s.items.filter((p) => inCycle(p, S.cycle)).length} products</span></div>`).join("") + (hits.length > 4 ? `<div class="muted">+${hits.length - 4} more</div>` : "");
  tip.hidden = false;
  const r = viewer.container.getBoundingClientRect();
  tip.style.transform = `translate(${Math.min(movePos.x + 14, r.width - 180)}px, ${movePos.y + 14}px)`;
}
viewer.container.addEventListener("pointerleave", () => { tip.hidden = true; setHover(null); });

handler.setInputAction((c) => {
  const ll = pickLL(c.position); if (!ll) return;
  S.point = ll; setPin(ll);
  if (S.where === "point") { setWhere("point"); runSearch(); }
  const s = curStack();
  if (s && ASF.contains(s.ring, ll.lon, ll.lat)) { renderProbe(); if (mobile()) setSheet("details"); saveHash(); return; }
  const hits = stacksAt(ll);
  if (hits.length === 1) selectStack(hits[0].key);
  else showHere(ll, hits);
}, C.ScreenSpaceEventType.LEFT_CLICK);

// status: altitude + "search this area"
function onCamera() {
  const h = camera.positionCartographic.height;
  $("st-alt").textContent = h > 1e5 ? `${Math.round(h / 1000).toLocaleString("en")} km up` : `${(h / 1000).toFixed(1)} km up`;
}
camera.changed.addEventListener(onCamera);
camera.percentageChanged = 0.05;
camera.moveEnd.addEventListener(() => {
  onCamera(); saveHash(); syncBorders();
  if (S.autoFly) { S.autoFly = false; return; }
  if (S.where === "view" && S.lastQ && S.lastQ.wkt !== viewWkt()) $("search-here").hidden = false;
});
$("search-here").addEventListener("click", () => runSearch());

// keyboard: ← → step dates, Esc closes
addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea")) return;
  if (e.key === "Escape") { if (S.compare) endCompare(); else if (!right.hidden) closeRight(); }
  if (!S.sel) return;
  if (e.key === "ArrowLeft") { stopPlay(); goTo(S.idx - 1); e.preventDefault(); }
  if (e.key === "ArrowRight") { stopPlay(); goTo(S.idx + 1); e.preventDefault(); }
});

// ---------------------------------------------------------------- mobile sheets
function setSheet(k) {
  document.body.dataset.sheet = k;
  document.querySelectorAll("[data-sheet-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sheetBtn === k)));
}
document.querySelectorAll("[data-sheet-btn]").forEach((b) => b.addEventListener("click", () => setSheet(b.dataset.sheetBtn)));

// ---------------------------------------------------------------- shareable URL (#hash)
let hashTimer = 0, restoring = true;
function saveHash() {
  if (restoring) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const c = camera.positionCartographic, h = new URLSearchParams();
    h.set("v", `${deg(c.latitude).toFixed(3)},${deg(c.longitude).toFixed(3)},${Math.round(c.height)}`);
    if (S.lastQ) {
      h.set("types", S.lastQ.types.join(","));
      h.set("where", S.where);
      ["track", "frame", "dir", "cycle"].forEach((k) => S.lastQ[k] && h.set(k, S.lastQ[k]));
      if (S.lastQ.start) h.set("from", S.lastQ.start.toISOString().slice(0, 10));
      if (S.lastQ.end) h.set("to", S.lastQ.end.toISOString().slice(0, 10));
    }
    if (S.point) h.set("pt", `${S.point.lat.toFixed(5)},${S.point.lon.toFixed(5)}`);
    if (S.cycle != null && S.cycle !== S.lastQ?.cycle) h.set("tl", S.cycle);
    if (S.sel) { h.set("sel", S.sel); h.set("type", S.type); const p = current(); if (p) h.set("p", p.id); }
    history.replaceState(null, "", "#" + h.toString());
  }, 300);
}
function restore() {
  const h = new URLSearchParams(location.hash.slice(1));
  const v = (h.get("v") || "").split(",").map(Number);
  if (v.length === 3 && v.every(isFinite)) camera.setView({ destination: C.Cartesian3.fromDegrees(v[1], v[0], v[2]) });
  if (h.get("types")) typeBox.querySelectorAll("[data-type]").forEach((b) => b.setAttribute("aria-pressed", String(h.get("types").split(",").includes(b.dataset.type))));
  syncProd();
  // a link that used the advanced options (another area mode, track, frame, dates) opens with them shown
  if ((h.get("where") && h.get("where") !== "view") || ["track", "frame", "dir", "cycle", "from", "to"].some((k) => h.get(k))) $("adv-btn").click();
  ["track", "frame", "dir", "cycle"].forEach((k) => { if (h.get(k)) $("f-" + k).value = h.get(k); });
  if (h.get("from")) $("f-from").value = h.get("from");
  if (h.get("to")) $("f-to").value = h.get("to");
  syncDates();
  const pt = (h.get("pt") || "").split(",").map(Number);
  if (pt.length === 2 && pt.every(isFinite)) { S.point = { lat: pt[0], lon: pt[1] }; setPin(S.point); }
  setWhere(h.get("where") || "view");
  if (h.get("sel")) pending = { key: h.get("sel"), type: h.get("type"), id: h.get("p") };
  const tl = +h.get("tl") || null;
  restoring = false;
  onCamera(); syncBorders();
  // the image areas stay hidden until "See NISAR image areas"; only a shared link to a chosen frame
  // searches straight away (and shows them) so it can open that frame
  if (!pending) return Promise.resolve();
  setAreas(true, false);
  return runSearch().then(() => { if (tl) setCycle(tl); });
}
setSheet("search");
renderTimeline();
restore();
// the next-pass box is there from the start, for Poznań (our home town); choosing a place replaces it
showNextPass(16.93, 52.41, "Poznań");
