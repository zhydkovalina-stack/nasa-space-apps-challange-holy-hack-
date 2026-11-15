/* NISAR products from NASA's Alaska Satellite Facility archive (ASF DAAC search API).
   The search API, the quick-look PNGs and their KML placement files are public and CORS-enabled,
   so a static page can query and display them directly. The full HDF5 products need a free
   NASA Earthdata login, so the explorer only links to them. */

const API = "https://api.daac.asf.alaska.edu/services/search/param";

// Product types we offer. `rgb`: quick-look colours are radar brightness per polarisation
// (red = first polarisation, green = second, blue = first or third), so values can be read back.
export const TYPES = {
  GCOV: { short: "GCOV", label: "Backscatter", long: "Geocoded backscatter (GCOV, 20 m)", rgb: true },
  GUNW: { short: "GUNW", label: "Interferogram", long: "Geocoded interferogram (GUNW, 80 m)", pair: true },
  GSLC: { short: "GSLC", label: "GSLC", long: "Geocoded single-look complex (GSLC)", rgb: true },
  RSLC: { short: "RSLC", label: "RSLC", long: "Single-look complex, radar geometry (RSLC)", rgb: true },
  SME2: { short: "SME2", label: "Soil moisture", long: "Soil moisture (SME2, 200 m, data only)", noBrowse: true },
};

// ---- 12-day repeat cycle ----
// Fitted to real frame footprints in demo/tools/orbit (orbit-data.json): exact 12-day / 173-orbit
// repeat, cycle 34 starting at T1. It matches the cycle numbers in product names, which stay the
// authority: the model is only used to turn a cycle number into a date window.
const CYC_S = 1036800, T1 = 1792821745.042, C1 = 34;
export const CYCLE_DAYS = 12;
export const cycleStart = (n) => new Date((T1 + (n - C1) * CYC_S) * 1000);
export const cycleEnd = (n) => new Date((T1 + (n + 1 - C1) * CYC_S) * 1000 - 1);
export const cycleOf = (d) => C1 + Math.floor((+d / 1000 - T1) / CYC_S);
export const FIRST_CYCLE = 1;

// ---- formatting ----
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDay = (d, year = true) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${year ? " " + d.getUTCFullYear() : ""}`;
export const fmtTime = (d) => d.toISOString().slice(11, 16) + " UTC";
export const fmtSize = (b) => (b == null ? "–" : b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(b > 1e8 ? 0 : 1) + " MB");
export const dirName = (d) => (d === "A" ? "North ↑" : "South ↓");
export const pad3 = (n) => String(n).padStart(3, "0");

// NISAR_L2_PR_GCOV_034_080_D_062_2005_DHDH_A_<start>_<stop>_...       cycle, track, pass, frame
// NISAR_L2_PR_GUNW_032_057_A_028_033_2000_SH_<ref start>_<ref stop>_<sec start>_<sec stop>_...
const NAME = /^NISAR_(L\d)_([A-Z]{2})_([A-Z0-9]{4})_(\d{3})_(\d{3})_([AD])_(\d{3})(?:_(\d{3})(?=_))?/;
const stamp = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);

function ringFromWkt(wkt) {
  if (!wkt) return null;
  // first ring of a POLYGON / MULTIPOLYGON; ASF footprints are simple quads
  const m = wkt.match(/\(\(\(?([^()]+)\)/);
  if (!m) return null;
  return m[1].split(",").map((pt) => pt.trim().split(/\s+/).map(Number)).filter((p) => p.length === 2 && p.every(isFinite));
}

function parse(r) {
  const gn = r.granuleName || r.productID || r.fileName;
  const m = gn && gn.match(NAME);
  if (!m) return null;
  const n = r.nisar || {};
  const urls = n.additionalUrls || [];
  const browse = (r.browse || []).find((u) => u.endsWith("_LATLON.png")) || null;
  const thumb = (r.browse || []).find((u) => u.endsWith("_LATLON_thumbnail.png")) || null;
  const kml = urls.find((u) => u.endsWith("_LATLON.kml")) || (browse ? browse.replace(/\.png$/, ".kml") : null);
  const times = [...gn.matchAll(/(\d{8}T\d{6})/g)].map((x) => stamp(x[1]));
  const type = r.productType || m[3];
  const sizes = n.sizeMB || {};
  const main = sizes[r.fileName] || Object.values(sizes).find((v) => v.format === "HDF5");
  const ring = ringFromWkt(r.wkt_unwrapped || r.wkt);
  if (!ring || ring.length < 3) return null;
  const p = {
    id: gn, type, level: m[1], config: m[2],
    cycle: +m[4], track: r.path ?? +m[5], dir: (r.flightDirection || m[6])[0], frame: r.frame ?? +m[7],
    cycle2: m[8] ? +m[8] : null,
    start: new Date(r.startTime || times[0]), stop: new Date(r.stopTime || times[1]),
    sec: TYPES[type]?.pair && times[2] ? times[2] : null,
    ring, browse, thumb, kml,
    url: r.downloadUrl || null,
    qa: urls.find((u) => u.endsWith("_QA_REPORT.pdf")) || null,
    pol: n.mainBandPolarization || [],
    coverage: n.frameCoverage || null,
    bytes: main ? main.bytes : null,
    collection: r.collectionName || null,
  };
  p.key = `${p.track}-${p.frame}-${p.dir}`;
  return p;
}

function params(q) {
  const p = new URLSearchParams({ platform: "NISAR" });
  p.set("processingLevel", q.types.join(","));
  if (q.wkt) p.set("intersectsWith", q.wkt);
  if (q.track) p.set("relativeOrbit", String(q.track));
  if (q.frame) p.set("frame", String(q.frame));
  if (q.dir) p.set("flightDirection", q.dir === "A" ? "ASCENDING" : "DESCENDING");
  let start = q.start, end = q.end;
  if (q.cycle) {   // pad the model's window by a day either side, then filter on the name
    start = new Date(+cycleStart(q.cycle) - 86400e3);
    end = new Date(+cycleEnd(q.cycle) + 86400e3);
  }
  if (start) p.set("start", start.toISOString());
  if (end) p.set("end", end.toISOString());
  return p;
}

export async function search(q, signal) {
  const p = params(q);
  p.set("output", "jsonlite");
  p.set("maxResults", String(q.max || 500));
  const r = await fetch(`${API}?${p}`, { signal });
  if (!r.ok) {
    let msg = `ASF search failed (${r.status})`;
    try { const j = await r.json(); if (j.errors?.[0]?.message) msg = j.errors[0].message; } catch {}
    throw new Error(msg);
  }
  const j = await r.json();
  let list = (j.results || []).map(parse).filter(Boolean);
  if (q.cycle) list = list.filter((x) => x.cycle === q.cycle || x.cycle2 === q.cycle);
  return list;
}

export async function count(q, signal) {
  const p = params(q);
  p.set("output", "count");
  const r = await fetch(`${API}?${p}`, { signal });
  if (!r.ok) return null;
  const n = parseInt(await r.text(), 10);
  return isFinite(n) ? n : null;
}

// ---- where a quick-look image sits: its _LATLON.kml gives the lat/lon box ----
const kmlCache = new Map();
function bboxOf(ring) {
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  return { w: Math.min(...lons), e: Math.max(...lons), s: Math.min(...lats), n: Math.max(...lats), approx: true };
}
// Only KMLs under /BROWSE/ are public; older (PROVISIONAL) products keep theirs behind the
// Earthdata login. NISAR frames sit on a fixed grid, so a public KML of another product of the
// same frame and type places the image just as well (checked on the Konin frames: zero shift).
const isPublic = (u) => !!u && u.includes("/BROWSE/");
function fetchBox(url) {
  if (!kmlCache.has(url)) {
    kmlCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }).then((t) => {
      const box = (tag) => { const m = t.match(new RegExp(`<${tag}>\\s*([-\\d.eE]+)\\s*</${tag}>`)); return m ? +m[1] : null; };
      const quad = t.match(/<coordinates>([^<]+)<\/coordinates>/);
      if (quad) {
        const pts = quad[1].trim().split(/\s+/).map((s) => s.split(",").map(Number));
        return { ...bboxOf(pts.map((q) => [q[0], q[1]])), approx: false };
      }
      const n = box("north"), s = box("south"), e = box("east"), w = box("west");
      if ([n, s, e, w].every((v) => v != null)) return { n, s, e, w, approx: false };
      return null;
    }).catch(() => null));
  }
  return kmlCache.get(url);
}
/** Lat/lon box of p's quick-look. `siblings`: other products of the same frame. */
export async function bounds(p, siblings = []) {
  if (isPublic(p.kml)) { const b = await fetchBox(p.kml); if (b) return b; }
  for (const q of siblings) {
    if (q === p || q.type !== p.type || !isPublic(q.kml)) continue;
    const b = await fetchBox(q.kml);
    if (b) return { ...b, shared: true };
  }
  return bboxOf(p.ring);
}

// ---- small helpers for footprints ----
export function contains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const centroid = (ring) => {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
};

// Channel names for an RGB quick-look: red = first polarisation, green = second.
export function channels(p) {
  const pol = (p.pol || []).filter(Boolean);
  if (pol.length >= 2) return { r: pol[0], g: pol[1] };
  return { r: pol[0] || "HH", g: null };
}
