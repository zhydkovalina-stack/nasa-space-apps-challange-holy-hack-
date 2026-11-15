/* "Take NISAR apart": a hand-built line-and-dot model of the real spacecraft.
   11 components (the main subsystems NASA/JPL and ISRO describe) grouped into 5 modules.
   Take it apart → modules fly out and the parts hidden inside the radar tower slide out.
   Click or grab any component for its card; drag loose modules back onto the bus (they snap). Units: metres. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---------- content ----------
const MODULES = [
  { key: "bus", name: "Spacecraft bus", tag: "Bus", who: "ISRO", anchor: true, explode: [0, 0, 0] },
  { key: "solar", name: "Power", who: "ISRO", explode: [0, -3.8, 2.2] },
  { key: "ris", name: "Radar tower", who: "NASA JPL + ISRO", explode: [0, -3.5, -5] },
  { key: "boom", name: "Boom", who: "NASA JPL", explode: [4.5, 0.5, 3.5] },
  { key: "dish", name: "Reflector", who: "NASA JPL", explode: [0, 3.4, 2.5] }
];
const PARTS = {
  bus: { mod: "bus", n: "01", s: "Bus", name: "Spacecraft bus", who: "Built by ISRO", big: "I-3K", unit: "ISRO platform",
    text: ["The body of the satellite: batteries and power electronics, thrusters and reaction wheels that point it, the flight computer, and the radio that sends data down to Earth.",
           "NISAR launched on 30 July 2025 on ISRO's GSLV-F16 rocket from Sriharikota, India."] },
  solar: { mod: "solar", n: "02", s: "Solar panels", name: "Solar panels", who: "Built by ISRO", big: "6 am / 6 pm", unit: "dawn–dusk orbit",
    text: ["Two wings of panels, one on each side of the bus, power the spacecraft. The radar is power-hungry while it images.",
           "NISAR crosses the equator around 6 am and 6 pm local time, so the panels see the Sun almost all the time. It's also why our passes over Poland come before sunrise and in the evening."] },
  hold: { mod: "boom", n: "03", s: "Holding mechanism", name: "Antenna holding mechanism", who: "Launch restraint", big: "1×", unit: "used once",
    text: ["During launch the boom and the folded reflector were clamped tight against the spacecraft so the rocket's shaking couldn't damage them.",
           "In orbit the clamps let go, and the boom and dish were free to unfold."] },
  boom: { mod: "boom", n: "04", s: "Boom", name: "Radar antenna boom", who: "Built by NASA JPL", big: "9 m", unit: "folding boom",
    text: ["An arm that holds the reflector far out from the radar tower, so the feeds can light the whole dish from the right distance.",
           "It launched folded and was opened in space hinge by hinge in the weeks after launch."] },
  dish: { mod: "dish", n: "05", s: "Reflector", name: "Radar antenna reflector", who: "Built by NASA JPL", big: "12 m", unit: "gold-mesh reflector",
    text: ["A drum-shaped dish of gold-plated wire mesh, folded like an umbrella for launch. Both radars share it.",
           "It focuses the pulses from the feeds onto the ground and gathers the faint echoes back."] },
  lfeed: { mod: "ris", n: "06", s: "L-band feed", name: "L-SAR feed aperture", who: "NASA JPL · L-band", big: "23.85 cm", unit: "wavelength",
    text: ["A flat array of small antennas that faces the reflector and lights it with L-band pulses.",
           "NISAR's trick, called SweepSAR, switches between these elements to follow each echo across the ground, so one pass covers a 240 km wide strip."] },
  sfeed: { mod: "ris", n: "07", s: "S-band feed", name: "S-SAR feed aperture", who: "ISRO · S-band", big: "9.37 cm", unit: "wavelength",
    text: ["The smaller array for ISRO's S-band radar. Its shorter waves are more sensitive to the tops of plants and fine surface roughness.",
           "Using both bands together tells scientists more about crops and forests than either one alone."] },
  trm: { mod: "ris", n: "08", s: "T/R modules", name: "L-SAR transmit/receive modules", who: "NASA JPL", big: "2 ways", unit: "out and back",
    text: ["Amplifiers right behind the feed. They boost each outgoing pulse, then catch and amplify the echo that comes back millions of times weaker."] },
  ctrl: { mod: "ris", n: "09", s: "Controller", name: "L-SAR instrument controller & RF back-end", who: "NASA JPL · inside the tower", big: "1 kHz+", unit: "pulses per second",
    text: ["The radar's control centre, hidden inside the tower. It sets the timing, shapes each microwave pulse and turns the returning echoes into a signal that can be digitised.",
           "The radar fires over a thousand pulses every second while it images."] },
  dsp: { mod: "ris", n: "10", s: "Processor", name: "L-SAR digital signal processing", who: "NASA JPL", big: "On board", unit: "data crunching",
    text: ["Digitises the echoes, filters them and squeezes the data before it is stored and beamed down.",
           "NISAR collects so much radar data that processing it on the spacecraft is essential."] },
  selec: { mod: "ris", n: "11", s: "S-band electronics", name: "S-SAR electronics", who: "ISRO · inside the tower", big: "S-band", unit: "ISRO radar",
    text: ["ISRO's own radar electronics for the S-band system, tucked inside the tower next to NASA's L-band hardware.",
           "Two space agencies' radars share one spacecraft and one reflector."] }
};

const COL = { ice: 0xd6defc, peri: 0x8f9cf2, indigo: 0x5a45c2, peach: 0xffbb82, rust: 0xc4573a, cream: 0xf6ebe1, green: 0x6fd08c };
// The whole model is drawn in white with a blue glow (CSS on #ana); the part you select turns bright blue.
// (The per-part colours passed to lines()/dots() below are kept in the code but no longer used.)
const MONO = 0xf4f6ff, MONO_SEL = 0x5f78ff;   // white wireframe; the selected part turns bright blue (like the small NISAR by the globe)

// ---------- scene ----------
const canvas = document.getElementById("ana"), stage = document.getElementById("ana-stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
camera.position.set(3.1, 1.75, -3.95);   // a bit closer now that the model has the whole box
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 1.6, maxDistance: 8, autoRotate: true, autoRotateSpeed: 0.6 });
controls.addEventListener("start", () => (controls.autoRotate = false));
const root = new THREE.Group();
scene.add(root);

// ---------- drawing helpers ----------
const dotTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.beginPath(); x.arc(16, 16, 13, 0, 7); x.fill();
  return new THREE.CanvasTexture(c);
})();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function lines(pairs, color, opacity = 0.9) {
  const m = new THREE.LineBasicMaterial({ color: MONO, transparent: true, opacity }); m.userData.base = opacity;
  return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pairs), m);
}
function dots(pts, color, size = 2.2, opacity = 0.75) {
  const m = new THREE.PointsMaterial({ color: MONO, size, sizeAttenuation: false, map: dotTex, transparent: true, opacity, depthWrite: false, alphaTest: 0.3 });
  m.userData.base = opacity;
  return new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), m);
}
function box(cx, cy, cz, w, h, d) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const c = [V(x0, y0, z0), V(x1, y0, z0), V(x1, y1, z0), V(x0, y1, z0), V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)];
  return [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].flatMap(([a, b]) => [c[a], c[b]]);
}
function shell(cx, cy, cz, w, h, d, step) {                     // dots on all six faces
  const o = [];
  for (let x = -w / 2; x <= w / 2 + 1e-6; x += step) for (let y = -h / 2; y <= h / 2 + 1e-6; y += step) o.push(V(cx + x, cy + y, cz - d / 2), V(cx + x, cy + y, cz + d / 2));
  for (let z = -d / 2; z <= d / 2 + 1e-6; z += step) for (let y = -h / 2; y <= h / 2 + 1e-6; y += step) o.push(V(cx - w / 2, cy + y, cz + z), V(cx + w / 2, cy + y, cz + z));
  for (let x = -w / 2; x <= w / 2 + 1e-6; x += step) for (let z = -d / 2; z <= d / 2 + 1e-6; z += step) o.push(V(cx + x, cy - h / 2, cz + z), V(cx + x, cy + h / 2, cz + z));
  return o;
}
function ring(c, r, n, axis = "y", seg = true) {
  const o = [];
  for (let i = 0; i < n; i++) {
    const p = (k) => { const t = (k / n) * Math.PI * 2, a = Math.cos(t) * r, b = Math.sin(t) * r; return axis === "y" ? V(c.x + a, c.y, c.z + b) : axis === "x" ? V(c.x, c.y + a, c.z + b) : V(c.x + a, c.y + b, c.z); };
    seg ? o.push(p(i), p(i + 1)) : o.push(p(i));
  }
  return o;
}
function cylinder(c, r, h, axis = "y", n = 16) {
  const off = axis === "y" ? V(0, h / 2, 0) : axis === "x" ? V(h / 2, 0, 0) : V(0, 0, h / 2);
  const a = c.clone().sub(off), b = c.clone().add(off), o = [...ring(a, r, n, axis), ...ring(b, r, n, axis)];
  ring(a, r, 4, axis, false).forEach((p, i) => o.push(p, ring(b, r, 4, axis, false)[i]));
  return o;
}

// ---------- modules & components ----------
const modG = {}, comp = {};
for (const m of MODULES) { const g = new THREE.Group(); g.userData.mod = m.key; root.add(g); modG[m.key] = g; }
function component(key, sub = [0, 0, 0]) {
  const g = new THREE.Group(); g.userData.key = key; g.userData.sub = V(...sub);
  modG[PARTS[key].mod].add(g); comp[key] = g; return g;
}

// Layout (metres, y up), checked against NASA/JPL renders of NISAR:
//  · bus (gold box) at the origin, purple battery packs on its +z wall, gold horn antennas on top
//  · two solar wings of 3 panels each, out along ±x
//  · the octagonal radar instrument structure (RIS) lies sideways out of the bus along -z; L-band tile strip on
//    its upper faces, S-band tiles on the upper-left face, T/R module boxes on the right side, flat end cap
//  · a solid two-segment boom rises from the top of the bus, bends at an elbow and meets the RIM of the reflector
//  · the 12 m drum reflector hangs level above the RIS, its shallow mesh facing down at the feeds
//  · the antenna holding mechanism is a curved ladder truss hanging under the RIS, plus small hooks at its end

// small geometry helpers for this model
const ringN = (c, n, r, k = 14) => {                      // ring of radius r around point c, facing direction n
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n.clone().normalize()), o = [];
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2, b = ((i + 1) / k) * Math.PI * 2;
    o.push(V(Math.cos(a) * r, Math.sin(a) * r, 0).applyQuaternion(q).add(c), V(Math.cos(b) * r, Math.sin(b) * r, 0).applyQuaternion(q).add(c));
  }
  return o;
};
const horn = (base, dir) => {                             // conical horn antenna
  const d = dir.clone().normalize(), tip = base.clone().add(d.clone().multiplyScalar(0.42));
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d), o = [...ringN(base, d, 0.06, 10), ...ringN(tip, d, 0.2, 14)];
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; o.push(V(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0).applyQuaternion(q).add(base), V(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0).applyQuaternion(q).add(tip)); }
  return o;
};
const tube = (a, b, s) => {                               // square-section tube from a to b, side s, with frame rings
  const d = b.clone().sub(a), L = d.length(), n = d.clone().normalize();
  const side = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize().multiplyScalar(s / 2);
  const up = new THREE.Vector3().crossVectors(side, n).normalize().multiplyScalar(s / 2);
  const c = [side.clone().add(up), side.clone().sub(up), side.clone().negate().sub(up), side.clone().negate().add(up)], o = [];
  for (let i = 0; i < 4; i++) o.push(a.clone().add(c[i]), b.clone().add(c[i]));
  const step = Math.max(0.6, L / 10);
  for (let t = 0; t <= L + 1e-6; t += step) { const p = a.clone().add(n.clone().multiplyScalar(Math.min(t, L))); for (let i = 0; i < 4; i++) o.push(p.clone().add(c[i]), p.clone().add(c[(i + 1) % 4])); }
  return o;
};

// 01 bus
{
  const g = component("bus");
  g.add(lines(box(0, 0, 0, 2.0, 2.4, 1.9), COL.peach, 1));
  g.add(dots(shell(0, 0, 0, 2.0, 2.4, 1.9, 0.2), COL.rust, 2.4, 0.7));
  const pk = [], pd = [];                                                        // purple battery packs (+z wall)
  for (const [x, y] of [[-0.46, 0.55], [0.46, 0.55], [-0.46, -0.45], [0.46, -0.45]]) {
    pk.push(...box(x, y, 1.0, 0.72, 0.82, 0.1));
    for (let u = -0.28; u <= 0.29; u += 0.1) for (let v = -0.33; v <= 0.34; v += 0.11) pd.push(V(x + u, y + v, 1.06));
  }
  g.add(lines(pk, COL.indigo, 1)); g.add(dots(pd, COL.peri, 2.2, 0.8));
  const hn = [];                                                                 // gold horn antennas on the top deck
  for (const [b, d] of [[V(-0.75, 1.2, 0.7), V(-0.7, 1, 0.5)], [V(0.75, 1.2, 0.7), V(0.7, 1, 0.5)], [V(-0.75, 1.2, -0.75), V(-0.8, 1, -0.3)], [V(0.2, 1.2, -0.8), V(0.3, 1, -0.6)]]) hn.push(...horn(b, d));
  g.add(lines(hn, COL.peach, 1));
  const th = [];
  for (const [x, z] of [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45]]) th.push(...cylinder(V(x, -1.32, z), 0.12, 0.16));
  th.push(...ring(V(-0.4, -1.45, 0.3), 0.32, 20), ...ring(V(-0.4, -1.55, 0.3), 0.18, 16), V(-0.4, -1.2, 0.3), V(-0.4, -1.6, 0.3));   // downlink dish
  g.add(lines(th, COL.cream, 0.7));
}
// 02 solar panels: two wings of three panels
{
  const g = component("solar"), L = [], a = [], b = [];
  for (const s of [-1, 1]) {
    const X = (x) => x * s;
    L.push(...cylinder(V(X(1.1), 0, 0), 0.14, 0.2, "x"));                     // array drive
    L.push(V(X(1.2), 0, 0), V(X(1.75), 0.75, 0), V(X(1.2), 0, 0), V(X(1.75), -0.75, 0), V(X(1.75), 0.75, 0), V(X(1.75), -0.75, 0));   // yoke
    for (let p = 0; p < 3; p++) {
      const x0 = 1.75 + p * 1.98, x1 = x0 + 1.9;
      L.push(...box(X((x0 + x1) / 2), 0, 0, 1.9, 2.7, 0.04).slice(0, 8));
      for (let x = x0 + 0.1; x < x1 - 0.05; x += 0.16) for (let y = -1.25; y <= 1.25; y += 0.16) ((Math.round(x / 0.16) + Math.round(y / 0.16)) % 2 ? a : b).push(V(X(x), y, 0));
    }
  }
  g.add(lines(L, COL.peri, 0.95)); g.add(dots(a, COL.indigo, 2.4, 0.9)); g.add(dots(b, COL.peri, 2.4, 0.6));
}

// radar instrument structure: octagonal prism along -z, flat top and bottom faces
const RIS = { z0: -0.95, z1: -6.2, R: 1.15 };
const oct = (z, r = RIS.R) => Array.from({ length: 8 }, (_, k) => { const t = Math.PI / 8 + (k * Math.PI) / 4; return V(Math.cos(t) * r, Math.sin(t) * r, z); });
const TOP = RIS.R * Math.cos(Math.PI / 8);
// facet k sits between vertex k and k+1: 0 upper-right · 1 top · 2 upper-left · 3 left · 4 lower-left · 5 bottom · 6 lower-right · 7 right
const onFacet = (k, u, z, lift = 0.04) => {
  const p = oct(z)[k], q = oct(z)[(k + 1) % 8], m = p.clone().lerp(q, u);
  return m.add(p.clone().add(q).setZ(0).normalize().multiplyScalar(lift));
};
{
  const L = [], a = oct(RIS.z0), b = oct(RIS.z1), D = [], E = [];
  for (let k = 0; k < 8; k++) L.push(a[k], a[(k + 1) % 8], b[k], b[(k + 1) % 8], a[k], b[k]);
  for (let z = RIS.z0 - 0.75; z > RIS.z1 + 0.3; z -= 0.75) { const m = oct(z); for (let k = 0; k < 8; k++) L.push(m[k], m[(k + 1) % 8]); }
  L.push(...ring(V(0, 0, RIS.z0 + 0.02), RIS.R * 1.1, 32, "z"));             // collar at the bus
  for (let z = RIS.z0 - 0.2; z > RIS.z1; z -= 0.2) for (const k of [3, 4, 5, 6]) for (let u = 0.12; u < 1; u += 0.22) D.push(onFacet(k, u, z, 0.01));   // gold blanket
  const cap = oct(RIS.z1 - 0.02);
  for (let k = 0; k < 8; k++) L.push(cap[k], cap[(k + 1) % 8]);
  for (let x = -1.0; x <= 1.0; x += 0.15) for (let y = -1.0; y <= 1.0; y += 0.15) if (Math.abs(x) + Math.abs(y) < 1.4) E.push(V(x, y, RIS.z1 - 0.03));
  L.push(V(0.3, 0.3, RIS.z1), V(0.75, 0.75, RIS.z1 - 0.6), V(-0.3, 0.3, RIS.z1), V(0.75, 0.75, RIS.z1 - 0.6), V(0.3, -0.3, RIS.z1), V(0.75, 0.75, RIS.z1 - 0.6));   // small end antenna mast
  const t = lines(L, COL.ice, 0.75); t.userData.frame = true; modG.ris.add(t);
  modG.ris.add(dots(D, COL.rust, 2.2, 0.55)); modG.ris.add(dots(E, COL.peach, 2.4, 0.7));
}
// 06 L-SAR feed aperture: tile strip over the top and upper-right faces, looking up at the reflector
const FEED_C = V(0.3, TOP + 0.1, -3.55);
{
  const g = component("lfeed", [0, 2.3, 0]), L = [], P = [];
  const z0 = -1.25, z1 = -5.9, tz = 0.46;
  for (const k of [0, 1]) {
    L.push(onFacet(k, 0, z0), onFacet(k, 1, z0), onFacet(k, 0, z1), onFacet(k, 1, z1), onFacet(k, 0, z0), onFacet(k, 0, z1), onFacet(k, 1, z0), onFacet(k, 1, z1));
    for (let z = z0 - tz; z > z1 + 0.01; z -= tz) L.push(onFacet(k, 0, z), onFacet(k, 1, z));
    for (let z = z0 - 0.08; z > z1; z -= 0.12) for (let u = 0.08; u < 1; u += 0.13) P.push(onFacet(k, u, z, 0.05));
  }
  g.add(lines(L, COL.cream, 0.95)); g.add(dots(P, COL.ice, 2.6, 0.9));
}
// 07 S-SAR feed aperture: green tile row along the upper-left face
{
  const g = component("sfeed", [-1.8, 1.2, 0]), L = [], P = [];
  const k = 2, z0 = -1.25, z1 = -5.9;
  L.push(onFacet(k, 0.08, z0, 0.06), onFacet(k, 0.92, z0, 0.06), onFacet(k, 0.08, z1, 0.06), onFacet(k, 0.92, z1, 0.06), onFacet(k, 0.08, z0, 0.06), onFacet(k, 0.08, z1, 0.06), onFacet(k, 0.92, z0, 0.06), onFacet(k, 0.92, z1, 0.06));
  for (let z = z0 - 0.58; z > z1 + 0.01; z -= 0.58) L.push(onFacet(k, 0.08, z, 0.06), onFacet(k, 0.92, z, 0.06));
  for (let z = z0 - 0.08; z > z1; z -= 0.12) for (let u = 0.15; u < 0.9; u += 0.15) P.push(onFacet(k, u, z, 0.07));
  g.add(lines(L, COL.cream, 0.9)); g.add(dots(P, COL.green, 2.6, 1));
}
// 08 L-SAR transmit/receive modules: four boxes with dot grids on the right side
{
  const g = component("trm", [1.4, 0, 0]), L = [], P = [];
  for (const z of [-1.8, -2.95, -4.1, -5.25]) {
    L.push(...box(TOP + 0.07, -0.08, z, 0.14, 0.62, 0.92));
    for (let y = -0.3; y <= 0.15; y += 0.09) for (let dz = -0.38; dz <= 0.38; dz += 0.09) P.push(V(TOP + 0.15, y, z + dz));
  }
  g.add(lines(L, COL.cream, 0.95)); g.add(dots(P, COL.green, 2, 0.85));
}
// 09 L-SAR instrument controller & RF back-end (inside, next to the bus)
{
  const g = component("ctrl", [-2.2, 0.4, 0]);
  g.add(lines(box(0, 0.05, -1.75, 1.1, 0.85, 0.8), COL.peach, 0.95));
  g.add(dots(shell(0, 0.05, -1.75, 1.1, 0.85, 0.8, 0.13), COL.peach, 2, 0.6));
}
// 10 L-SAR digital signal processing: card cage (inside, middle)
{
  const g = component("dsp", [0, -2.2, 0]), L = [...box(0.35, -0.2, -3.2, 0.65, 0.85, 1.1)];
  for (let i = 0; i < 7; i++) { const z = -2.75 - i * 0.14; L.push(V(0.08, -0.58, z), V(0.08, 0.18, z), V(0.08, 0.18, z), V(0.64, 0.18, z)); }
  g.add(lines(L, COL.peri, 0.95));
}
// 11 S-SAR electronics (inside, far end)
{
  const g = component("selec", [-2.2, -0.4, 0]);
  g.add(lines(box(-0.38, -0.2, -4.6, 0.6, 0.8, 1.0), COL.peach, 0.95));
  g.add(dots(shell(-0.38, -0.2, -4.6, 0.6, 0.8, 1.0, 0.12), COL.rust, 2, 0.7));
}
// 03 antenna holding mechanism: curved ladder truss hanging under the tower + hooks at its end
{
  const g = component("hold", [0, -1.6, 0]), L = [];
  const path = [V(0.35, -TOP, 0), V(0.95, -1.9, 0), V(0.55, -2.8, 0), V(0.95, -3.7, 0)];   // S-curve, in x–y
  const rails = [-3.3, -3.95];                                                              // the two rails' z
  const pts = (z) => { const o = []; for (let i = 0; i < path.length - 1; i++) for (let t = 0; t < 1; t += 0.25) o.push(path[i].clone().lerp(path[i + 1], t).setZ(z)); o.push(path[path.length - 1].clone().setZ(z)); return o; };
  const r0 = pts(rails[0]), r1 = pts(rails[1]);
  for (let i = 0; i < r0.length - 1; i++) { L.push(r0[i], r0[i + 1], r1[i], r1[i + 1], r0[i], r1[i]); if (i % 2) L.push(r0[i], r1[i + 1]); }
  L.push(r0[r0.length - 1], r1[r1.length - 1]);
  L.push(V(-0.2, -TOP, -2.4), r0[2], V(-0.2, -TOP, -4.6), r1[2]);                           // braces back to the tower
  for (const x of [-0.45, 0.45]) {                                                          // hooks at the far end
    L.push(V(x, -TOP, RIS.z1 + 0.35), V(x * 1.3, -1.55, RIS.z1 - 0.1), V(x * 1.3, -1.55, RIS.z1 - 0.1), V(x * 1.3 + 0.18, -1.45, RIS.z1 - 0.25));
  }
  g.add(lines(L, COL.cream, 0.9));
}
// 05 reflector geometry (needed by the boom): level drum above the tower
const DISH_C = V(0.2, 11.0, -2.8), DR = 6, DH = 1.1;
const rimAt = (t, dy) => V(DISH_C.x + Math.cos(t) * DR, DISH_C.y + dy, DISH_C.z + Math.sin(t) * DR);
// 04 boom: solid square tube, two segments, from the top of the bus to the reflector rim
const B0 = V(0.55, 1.2, 0.5), B1 = V(1.1, 5.7, 2.7);
const tRim = Math.atan2(B1.z - DISH_C.z, B1.x - DISH_C.x);
const B2 = rimAt(tRim, DH / 2 + 0.45);
{
  const g = component("boom"), L = [...tube(B0, B1, 0.3), ...tube(B1, B2, 0.3)], G = [];
  G.push(...box(B1.x, B1.y, B1.z, 0.5, 0.5, 0.5), ...box(B0.x, B0.y + 0.1, B0.z, 0.55, 0.25, 0.55), ...box(B2.x, B2.y + 0.15, B2.z, 0.4, 0.6, 0.4));   // hinges + top fitting
  for (const t of [0.35, 0.7]) { const p = B0.clone().lerp(B1, t); G.push(...box(p.x + 0.2, p.y, p.z, 0.1, 0.15, 0.35)); }   // small brackets
  for (const t of [0.3, 0.6]) { const p = B1.clone().lerp(B2, t); G.push(...box(p.x + 0.2, p.y, p.z, 0.1, 0.15, 0.35)); }
  g.add(lines(L, COL.ice, 0.85)); g.add(lines(G, COL.peach, 1));
}
// 05 reflector: drum hoop (two rings + zigzag struts) with a shallow mesh facing down at the feeds
{
  const g = component("dish"), N = 96, POSTS = 24, ringL = [], strut = [], ribs = [], mesh = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, b = ((i + 1) / N) * Math.PI * 2;
    ringL.push(rimAt(a, DH / 2), rimAt(b, DH / 2), rimAt(a, -DH / 2), rimAt(b, -DH / 2));
  }
  for (let i = 0; i < POSTS; i++) {
    const a = (i / POSTS) * Math.PI * 2, b = ((i + 1) / POSTS) * Math.PI * 2;
    strut.push(rimAt(a, DH / 2), rimAt(a, -DH / 2));                                  // vertical posts
    strut.push(i % 2 ? rimAt(a, DH / 2) : rimAt(a, -DH / 2), i % 2 ? rimAt(b, -DH / 2) : rimAt(b, DH / 2));   // zigzag
  }
  const surf = (r, t) => V(DISH_C.x + Math.cos(t) * r, DISH_C.y - DH / 2 + 0.55 * (1 - (r / DR) ** 2), DISH_C.z + Math.sin(t) * r);   // concave side down
  for (let k = 0; k < 24; k++) { const t = (k / 24) * Math.PI * 2; for (let r = 0.4; r < DR; r += 0.5) ribs.push(surf(r, t), surf(Math.min(DR, r + 0.5), t)); }
  for (let r = 0.5; r <= DR - 0.1; r += 0.3) { const n = Math.round((2 * Math.PI * r) / 0.3); for (let k = 0; k < n; k++) mesh.push(surf(r, (k / n) * Math.PI * 2 + r)); }
  g.add(lines(ringL, COL.peach, 1)); g.add(lines(strut, COL.peach, 0.7));
  g.add(lines(ribs, COL.cream, 0.32)); g.add(dots(mesh, COL.ice, 1.8, 0.4));
  const bm = [], top = surf(0, 0);
  for (let i = 0; i < 24; i += 2) bm.push(FEED_C.clone().lerp(top, i / 24), FEED_C.clone().lerp(top, (i + 1) / 24));
  g.add(lines(bm, COL.peach, 0.3));                                                   // radar beam between feed and dish
}

// centre and scale, then measure hit boxes + label anchors in final coordinates
const SCALE = 0.13;
root.scale.setScalar(SCALE);
const ctr = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
root.position.copy(ctr.multiplyScalar(-1));
root.updateMatrixWorld(true);

const parts = {};
for (const key in comp) {
  const g = comp[key], b = new THREE.Box3().setFromObject(g);
  const size = b.getSize(new THREE.Vector3()).divideScalar(SCALE).addScalar(0.25);
  const c = g.worldToLocal(b.getCenter(new THREE.Vector3()));
  const hit = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.copy(c); hit.userData.key = key; g.add(hit);
  parts[key] = { def: PARTS[key], g, hit, vol: size.x * size.y * size.z, anchor: c.clone().add(V(0, size.y / 2, 0)) };
}
const mods = {};
for (const m of MODULES) {
  // faint "ghost" of the module at its home slot, shown while it is detached
  const ghost = modG[m.key].clone(true);
  ghost.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.opacity = (o.material.userData.base ?? 0.5) * 0.14; } if (o.isMesh) o.visible = false; });
  ghost.visible = false; root.add(ghost);
  mods[m.key] = { def: m, g: modG[m.key], ghost, target: V(0, 0, 0), attached: true, reach: V(...m.explode).length() };
}
// the solar module spans both sides of the bus, so pin its label to the outer end of one wing
parts.solar.anchor.set(6.6, 1.5, 0);

// ---------- UI (minimal: the card unfolds only when you click a part) ----------
const $ = (id) => document.getElementById(id);
const labelsEl = $("ana-labels"), card = $("ana-card"), body = $("ana-body"), prog = $("ana-progress"), done = $("ana-done"), hint = $("ana-hint");
const labels = {};
for (const key in parts) {
  const l = document.createElement("div"); l.className = "ana-label"; l.textContent = PARTS[key].name;
  labelsEl.appendChild(l); labels[key] = l;
}
let selected = null, exploded = false, doneT = 0;
function paint() {                                   // selected part: ice and full strength; others: periwinkle, dimmed while a card is open
  for (const k in parts) parts[k].g.traverse((o) => {
    if (o.material?.userData.base == null) return;
    o.material.color.setHex(k === selected ? MONO_SEL : MONO);
    o.material.opacity = o.material.userData.base * (!selected || k === selected ? 1 : 0.35);
  });
}
function select(key) {                              // click: toggles the card
  if (!key || key === selected) return close();
  show(key);
}
function show(key) {                                // open a part's card (no toggle: grabbing a part never closes it)
  if (key === selected) return;
  selected = key;
  const p = PARTS[key];
  body.innerHTML = `<div class="who">${p.who}</div><h3>${p.name}</h3><div class="big">${p.big}<small>${p.unit}</small></div><p>${p.text[0]}</p>`;
  card.classList.remove("open"); void card.offsetWidth; card.classList.add("open");   // replay the unfold for each part
  paint();
}
function close() { selected = null; card.classList.remove("open"); paint(); }
$("ana-close").onclick = close;
addEventListener("keydown", (ev) => { if (ev.key === "Escape" && selected) close(); });
function showDone(on) {
  clearTimeout(doneT); done.hidden = !on; hint.hidden = on;
  if (on) doneT = setTimeout(() => showDone(false), 4500);
}
function progress() {
  const list = Object.values(mods), n = list.filter((m) => m.attached).length;
  prog.hidden = !exploded;                           // the progress bar only exists while you are reassembling
  prog.innerHTML = list.map((m) => `<i class="${m.attached ? "on" : ""}" title="${m.def.name}"></i>`).join("");
  if (exploded && n === list.length) { exploded = false; prog.hidden = true; showDone(true); $("ana-explode").textContent = "Take apart"; hint.textContent = "Drag to spin · click a part"; }
}
const firstOf = (mod) => Object.keys(PARTS).find((k) => PARTS[k].mod === mod);
$("ana-explode").onclick = () => {
  exploded = true; showDone(false); controls.autoRotate = false;
  for (const m of Object.values(mods)) if (!m.def.anchor) { m.attached = false; m.target.set(...m.def.explode); }
  $("ana-explode").textContent = "Take apart again";
  hint.textContent = "Drag each loose part back onto its outline";
  progress();
};
$("ana-reset").onclick = () => {
  for (const m of Object.values(mods)) { m.attached = true; m.target.set(0, 0, 0); }
  exploded = false; progress();
  $("ana-explode").textContent = "Take apart"; hint.textContent = "Drag to spin · click a part";
};
progress();

// ---------- picking + drag-to-snap ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), plane = new THREE.Plane(), hitP = new THREE.Vector3();
let drag = null, down = null;
function setRay(ev) {
  const r = canvas.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  camera.updateMatrixWorld(); ray.setFromCamera(mouse, camera);
}
function pickPart(ev) {
  setRay(ev);
  const hits = ray.intersectObjects(Object.values(parts).map((p) => p.hit));
  if (!hits.length) return null;
  // smallest box among the hits wins, so inner parts can be clicked through the tower and dish boxes
  hits.sort((a, b) => parts[a.object.userData.key].vol - parts[b.object.userData.key].vol);
  return hits[0].object.userData.key;
}
canvas.addEventListener("pointerdown", (ev) => {
  down = { x: ev.clientX, y: ev.clientY };
  const key = pickPart(ev); if (!key) return;
  const m = mods[PARTS[key].mod];
  if (m.def.anchor || m.attached) return;
  const world = m.g.getWorldPosition(new THREE.Vector3());
  plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), world);
  ray.ray.intersectPlane(plane, hitP);
  drag = { mod: m.def.key, offset: root.worldToLocal(hitP.clone()).sub(m.g.position) };
  show(key); down.shown = true;                      // grabbing a loose part brings up its card too
  controls.enabled = false; canvas.classList.add("drag");
  try { canvas.setPointerCapture(ev.pointerId); } catch {}
});
canvas.addEventListener("pointermove", (ev) => {
  if (drag) {
    setRay(ev);
    if (ray.ray.intersectPlane(plane, hitP)) { const m = mods[drag.mod]; m.target.copy(root.worldToLocal(hitP.clone()).sub(drag.offset)); m.g.position.copy(m.target); }
    return;
  }
  canvas.style.cursor = pickPart(ev) ? "pointer" : "grab";
});
canvas.addEventListener("pointerup", (ev) => {
  const moved = down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4;
  if (drag) {
    const m = mods[drag.mod];
    // snap when the module lines up with its ghost ON SCREEN (depth can't be fixed by dragging)
    const ref = parts[firstOf(m.def.key)].anchor, px = (off) => {
      const p = ref.clone().add(off); root.localToWorld(p); p.project(camera);
      return V((p.x + 1) / 2 * stage.clientWidth, (1 - p.y) / 2 * stage.clientHeight, 0);
    };
    if (px(m.g.position).distanceTo(px(V(0, 0, 0))) < 70 || m.g.position.length() < 2.2) { m.attached = true; m.target.set(0, 0, 0); }
    drag = null; controls.enabled = true; canvas.classList.remove("drag"); progress();
  }
  if (!moved && !down?.shown) select(pickPart(ev));  // click a part: unfold its card; click empty space: fold it away
  down = null;
});

// ---------- loop ----------
function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(stage); resize();
let visible = true;
new IntersectionObserver((e) => (visible = e[0].isIntersecting)).observe(stage);
const tmp = new THREE.Vector3();
(function loop() {
  requestAnimationFrame(loop);
  if (!visible) return;
  for (const m of Object.values(mods)) {
    if (!drag || drag.mod !== m.def.key) m.g.position.lerp(m.target, 0.1);
    m.ghost.visible = !m.attached;
  }
  for (const key in parts) {
    const p = parts[key], g = p.g, loose = !mods[PARTS[key].mod].attached;
    g.position.lerp(loose ? g.userData.sub : V(0, 0, 0), 0.1);                          // inner parts slide out when apart
    tmp.copy(p.anchor); g.localToWorld(tmp); tmp.project(camera);
    const l = labels[key];
    const show = tmp.z < 1 && (key === selected || (loose && key === firstOf(PARTS[key].mod)));   // only the selected part, and loose modules while reassembling
    const asMod = loose && key !== selected, txt = asMod ? MODULES.find((m) => m.key === PARTS[key].mod).name : PARTS[key].name;
    if (l.textContent !== txt) l.textContent = txt;   // loose modules are labelled by module ("Boom"), a selected part by its own name
    l.style.display = show ? "" : "none"; l.classList.toggle("loose", asMod);
    l.style.left = ((tmp.x + 1) / 2) * stage.clientWidth + "px";
    l.style.top = ((1 - tmp.y) / 2) * stage.clientHeight - 6 + "px";
  }
  controls.update();
  renderer.render(scene, camera);
})();
