/* Shared pixel-glyph globe (three.js). Land = thin-line glyphs on an even lat/lon lattice,
   heavier inland, lighter on coasts; ocean = faint dot lattice; a dithered dot halo for the
   atmosphere. Used by the hero (decorative) and the orbit page (interactive). */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { geoEquirectangular, geoPath } from "https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm";
import { feature } from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";

export { THREE };
const R = 1;
export const toXYZ = (lat, lon, r = R) => {
  const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
};
export const toLatLon = (v) => {
  const n = v.clone().normalize();
  return { lat: THREE.MathUtils.radToDeg(Math.asin(n.y)), lon: THREE.MathUtils.radToDeg(Math.atan2(-n.z, n.x)) };
};
export const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

// glyphs: 0 dot · 1 square · 2 ring · 3 ring+dot · 4 x · 5 plus · 6 hollow square · 8 glow halo · 9 solid · 10–14 see FRAG
const VERT = `
  attribute float aGlyph; attribute float aSize; attribute float aSeed; attribute vec3 aColor;
  uniform float uScale; uniform float uTime;
  varying float vGlyph; varying vec3 vColor; varying float vFade; varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normalize(position));
    vFade = smoothstep(-0.02, 0.3, dot(n, normalize(-mv.xyz)));
    vGlyph = aGlyph; vColor = aColor; vSeed = aSeed;
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform float uDim;
  varying float vGlyph; varying vec3 vColor; varying float vFade; varying float vSeed;
  float box(vec2 p, float r) { vec2 d = abs(p) - r; return max(d.x, d.y); }
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p), a = 0.0, w = 0.16;
    int g = int(vGlyph + 0.5);
    if (g == 0) a = step(r, 0.42);
    else if (g == 1) a = step(box(p, 0.7), 0.0);
    else if (g == 2) a = step(abs(r - 0.7), w * 0.6);
    else if (g == 3) a = max(step(abs(r - 0.72), w * 0.55), step(r, 0.24));
    else if (g == 4) a = step(min(abs(p.x - p.y), abs(p.x + p.y)), w * 1.25) * step(length(max(abs(p) - 0.5, 0.0)), 0.22);   // bold, rounded X
    else if (g == 5) a = step(min(abs(p.x), abs(p.y)), w * 0.55) * step(box(p, 0.82), 0.0);
    else if (g == 6) a = step(abs(box(p, 0.64)), w * 0.6);                              // hollow square
    else if (g == 9) {                                                                     // solid fill block (cells touch)
      if (step(box(p, 0.99), 0.0) < 0.5 || vFade < 0.02) discard;
      gl_FragColor = vec4(vColor * mix(1.0, 0.45, uDim), vFade * 0.9);
      return;
    }
    else if (g == 10) a = step(min(min(length(p - vec2(0.42, 0.42)), length(p - vec2(-0.42, 0.42))), min(length(p - vec2(0.42, -0.42)), length(p - vec2(-0.42, -0.42)))), 0.3);   // four-dot clover
    else if (g == 11) a = step(min(abs(p.x), abs(p.y)), 0.07) * step(box(p, 0.5), 0.0);   // thin plus
    else if (g == 12) a = step(min(abs(p.x - p.y), abs(p.x + p.y)), 0.1) * step(box(p, 0.42), 0.0);   // thin x
    else if (g == 13) a = step(abs(p.x - p.y), 0.1) * step(box(p, 0.5), 0.0);             // thin slash
    else if (g == 14) a = step(r, 0.17);                                                   // tiny grid dot
    else if (g == 8) {                                   // soft glow halo (drawn additively under the land glyphs)
      float gl = pow(max(0.0, 1.0 - r), 2.2) * 0.1 * vFade * mix(1.0, 0.4, uDim);
      if (gl < 0.01) discard;
      gl_FragColor = vec4(vColor, gl);
      return;
    }
    else discard;
    if (a < 0.5 || vFade < 0.02) discard;
    gl_FragColor = vec4(vColor * mix(1.0, 0.38, uDim), vFade);
  }`;

// stepped atmosphere glow (hard colour bands + grain) drawn on a camera-facing plane
const HALO_V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const HALO_F = `
  varying vec2 vUv; uniform vec3 uA; uniform vec3 uB; uniform float uPx; uniform float uRim;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    float d = length(vUv - 0.5) * 2.0 * 1.35;        // 1.0 = globe edge
    if (d < 0.995 || d > 1.2) discard;
    float k = clamp((1.2 - d) / 0.2, 0.0, 1.0);       // 1 at the rim, 0 at the outer edge
    float band = floor(k * 6.0) / 6.0;                // six hard steps
    vec3 col = mix(uB, uA, band);
    float g = (hash(floor(gl_FragCoord.xy)) - 0.5) * 0.12;   // grain
    gl_FragColor = vec4(col + g, band * uRim);
  }`;

export async function createGlobe(canvas, opts = {}) {
  const step = opts.step ?? 1.1;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 38, 1, 0.1, 100);
  camera.position.copy(opts.camera ?? new THREE.Vector3(0, 0.6, 3.4));
  camera.lookAt(0, 0, 0);
  const uniforms = { uScale: { value: 1 }, uTime: { value: 0 }, uDim: { value: 0 } };

  let controls = null;
  if (opts.interactive) {
    controls = new OrbitControls(camera, canvas);
    Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 1.4, maxDistance: 6, rotateSpeed: 0.5, autoRotate: true, autoRotateSpeed: 0.3 });
    controls.addEventListener("start", () => (controls.autoRotate = false));
  }
  const spin = new THREE.Group();     // the hero rotates this instead of the camera
  scene.add(spin);

  const core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.992, 64, 48), new THREE.MeshBasicMaterial({ color: 0x07040d }));
  spin.add(core);

  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.7), new THREE.ShaderMaterial({
    vertexShader: HALO_V, fragmentShader: HALO_F, transparent: true, depthWrite: false,
    uniforms: { uA: { value: new THREE.Color(opts.haloA ?? "#8f9cf2") }, uB: { value: new THREE.Color(opts.haloB ?? "#3a1d6e") }, uPx: { value: 5 * renderer.getPixelRatio() }, uRim: { value: opts.rim ?? 0.3 } }
  }));
  halo.renderOrder = -1;
  scene.add(halo);

  function pointsFrom(list, additive = false) {
    const g = new THREE.BufferGeometry(), n = list.length;
    const pos = new Float32Array(n * 3), gl = new Float32Array(n), sz = new Float32Array(n), sd = new Float32Array(n), col = new Float32Array(n * 3);
    list.forEach((p, i) => {
      const v = toXYZ(p.lat, p.lon, p.r || R);
      pos.set([v.x, v.y, v.z], i * 3); gl[i] = p.glyph; sz[i] = p.size; sd[i] = p.seed ?? Math.random(); col.set(p.color, i * 3);
    });
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aGlyph", new THREE.BufferAttribute(gl, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(sd, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    return new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true,
      depthWrite: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    }));
  }

  // land mask → glyph lattice
  const topo = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json").then((r) => r.json());
  const land = feature(topo, topo.objects.land);
  const MW = 1440, MH = 720;
  const mk = (blur) => {
    const c = document.createElement("canvas"); c.width = MW; c.height = MH;
    const x = c.getContext("2d", { willReadFrequently: true });
    return [c, x];
  };
  const [mc, mx] = mk();
  mx.fillStyle = "#fff"; mx.beginPath(); geoPath(geoEquirectangular().fitSize([MW, MH], { type: "Sphere" }), mx)(land); mx.fill();
  const [, bx] = mk(); bx.filter = "blur(10px)"; bx.drawImage(mc, 0, 0);
  const m = mx.getImageData(0, 0, MW, MH).data, b = bx.getImageData(0, 0, MW, MH).data;
  const sample = (d, lat, lon) => d[(Math.min(MH - 1, Math.floor(((90 - lat) / 180) * MH)) * MW + Math.min(MW - 1, Math.floor(((lon + 180) / 360) * MW))) * 4] / 255;

  // translucent banded fill under the glyphs: hard colour steps that follow the coastlines
  // (contour-like bands inland, a few fading bands out to sea), with grain. Painted as an
  // equirectangular texture on the dark core sphere.
  {
    const [, wx] = mk(); wx.filter = "blur(26px)"; wx.drawImage(mc, 0, 0);
    const wide = wx.getImageData(0, 0, MW, MH).data;
    const fc = document.createElement("canvas"); fc.width = MW; fc.height = MH;
    const fx = fc.getContext("2d"), img = fx.createImageData(MW, MH), d = img.data;
    const srgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);   // raw sRGB 0..1 for canvas pixels
    const LAND = ["#7d84de", "#6a5ad6", "#5a45c2", "#4a2f9a", "#3a1d6e", "#2c1450"].map(srgb);
    const SEAB = srgb("#0b0616");   // sea: one flat dark colour (no bands, so no meaningless blobs)
    for (let i = 0, n = MW * MH; i < n; i++) {
      const isLand = m[i * 4] > 127, w = wide[i * 4] / 255;
      let c;
      if (isLand) c = LAND[3];                         // one flat colour under the land (no colour gradient for now)
      else c = SEAB;
      const g = isLand ? (Math.random() - 0.5) * 0.06 : 0;
      d[i * 4] = (c[0] + g) * 255; d[i * 4 + 1] = (c[1] + g) * 255; d[i * 4 + 2] = (c[2] + g) * 255; d[i * 4 + 3] = 255;
    }
    fx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(fc);
    tex.colorSpace = THREE.SRGBColorSpace;
    core.material.map = tex;
    core.material.color.setScalar(opts.fillStrength ?? 0.3);    // low: the land fill sits faintly under the glyphs
    core.material.needsUpdate = true;
  }
  const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  // Glyph lattice modelled on the reference texture: one symbol per grid cell.
  //  · inland: heavy glyphs (ring+dot, hollow square, bold X, four-dot clover), mixed at random inside
  //    rectangular patches that each favour one family
  //  · underneath: a faint stepped gradient on the land only (the core-sphere texture above)
  //  · toward the coast: light marks (thin +, thin ×, slash) and tiny dots
  //  · sea: a sparse grid of tiny dots, with a few faint marks near shore; open ocean stays mostly empty
  const ICE = hex("#d6defc"), PERI = hex("#8f9cf2"), IND = hex("#5a45c2"), SEA = hex("#2b1752"), SHORE = hex("#3a1d6e");
  const FAMILIES = [[3, 6, 3, 6, 10], [3, 4, 3, 4, 6], [6, 4, 10, 6, 4], [3, 3, 6, 10, 4]];
  const LIGHT = [[11, 11, 12, 14], [12, 12, 13, 14], [13, 11, 14, 14]];
  const cell = step * 0.0175;
  const landPts = [], sea = [];
  for (let lat = -86 + step / 2; lat < 86; lat += step) {
    const n = Math.max(1, Math.round((360 / step) * Math.cos(THREE.MathUtils.degToRad(lat))));
    for (let i = 0; i < n; i++) {
      const lon = -180 + (i + 0.5) * (360 / n), j = h2(lat * 3.7, lon * 1.3);
      const depth = sample(b, lat, lon);
      if (sample(m, lat, lon) > 0.5) {
        const fam = h2(Math.floor(lat / 4.4) * 1.7, Math.floor(lon / 6.2) * 2.3);
        let glyph, color, size = cell * 0.92;
        if (depth > 0.74) {
          const set = FAMILIES[Math.floor(fam * FAMILIES.length)];
          glyph = j < 0.05 ? 14 : set[Math.floor(j * set.length)];
          color = depth > 0.86 ? ICE : PERI;
        } else if (depth > 0.6) {
          const set = LIGHT[Math.floor(fam * LIGHT.length)];
          glyph = set[Math.floor(j * set.length)]; color = PERI;
        } else {
          glyph = j < 0.55 ? 14 : j < 0.8 ? 11 : 12; color = IND;
        }
        landPts.push({ lat, lon, glyph, size, color });
      } else if (depth > 0.3 && j < 0.3) {
        sea.push({ lat, lon, glyph: j < 0.15 ? 12 : 11, size: cell * 0.9, color: SHORE });   // faint marks near shore
      } else if ((Math.round(lat / step) + i) % 2 === 0) {
        sea.push({ lat, lon, glyph: 14, size: cell * 0.9, color: SEA });                   // sparse grid dots
      }
    }
  }
  spin.add(pointsFrom(sea));
  spin.add(pointsFrom(landPts));
  // glow: every second land glyph also gets a small, faint soft halo, blended additively (kept low so the land reads flat)
  const glow = pointsFrom(landPts.filter((p, i) => i % 2 === 0).map((p) => ({ ...p, glyph: 8, size: p.size * (opts.glowSize ?? 2.2) })), true);
  glow.renderOrder = 1;
  if (opts.landGlow !== false) spin.add(glow);          // landGlow: false = flat land, no halos

  const frameFns = [];
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    uniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  let visible = true;
  new IntersectionObserver((es) => (visible = es[0].isIntersecting)).observe(canvas);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  (function loop(t) {
    if (visible) {
      uniforms.uTime.value = t / 1000;
      frameFns.forEach((f) => f(t, reduce));
      controls?.update();
      halo.quaternion.copy(camera.quaternion);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(loop);
  })(0);

  return { THREE, scene, spin, camera, renderer, controls, uniforms, core, pointsFrom, onFrame: (f) => frameFns.push(f), R };
}
