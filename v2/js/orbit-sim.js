/* NISAR orbit simulation on the v2 glyph globe (Pass 05). Ported from demo/src/orbit.template.html:
   the same orbit model (circular, sun-synchronous, exact 12-day / 173-orbit repeat, fitted to real
   GCOV frame footprints; data in demo/data/orbit/orbit-data.json), drawn in the v2 palette.

   Frames: G.spin is the Earth-fixed frame (events and swaths live there and it never rotates).
   `root` is the sun-fixed frame of the orbit; it turns by -rotE(t) around the pole, so the orbit
   plane stays lined up with the day/night boundary while Earth (and the camera) stay put.

   Shown: the satellite (sat-model.js), its orbit ring with a bright wake, the left-looking radar
   beam with a sweeping receive line, and a short trail of ground track and imaged swath behind it
   that fades out completely over eight Earth diameters (bright over land and ice, where the radar collects). */
import { THREE } from "./globe-core.js";
import { buildSat, satTime } from "./sat-model.js";

const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;
const DATA_URL = new URL("../../demo/data/orbit/orbit-data.json", import.meta.url);
const ASC = [255, 187, 130], DSC = [143, 156, 242];   // peach = northbound (dawn), periwinkle = southbound (dusk)

export async function addOrbit(G, opts = {}) {
  const DATA = await fetch(DATA_URL).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const O = DATA.orbit, T = O.T, CYC = O.cycle, T1 = O.t1, C1 = O.t1Cycle;
  const DT = 6, NSTEP = Math.round(CYC / DT), SPO = T / DT, DAY = Math.round(86400 / DT);
  // trail behind the satellite: swaths and ground track fade to nothing over this much of the orbit.
  // 1 radian of orbit ≈ one Earth radius of ground (≈ 16 minutes of flight); 16 = eight Earth diameters, ≈ 4 h 15 min (about 2.5 orbits).
  const TRAIL = SPO * (opts.trailRad ?? 16.0) / TAU;
  const WAKE = opts.wakeRad ?? 1.5;    // bright tail of the orbit ring (in space) behind the satellite, in radians of orbit
  const NADIR_TRAIL = TRAIL * (opts.trackShare ?? 0.5);   // the white ground-track line under the satellite: half as long as the swaths
  const R_ORB = 1 + O.altKm / 6371, INC = O.inc * D2R, HN = 15 * (O.ltan - 12) * D2R;
  const GN = O.gNear * D2R, GF = O.gFar * D2R, GC = (GN + GF) / 2;

  // ---- orbit geometry in the sun-fixed frame (+X toward the mean sun, +Y north) ----
  const nH = [Math.cos(HN), 0, -Math.sin(HN)];                                  // ascending node
  const eH = [-Math.sin(HN), 0, -Math.cos(HN)];                                 // east at the node
  const mH = [Math.cos(INC) * eH[0], Math.sin(INC), Math.cos(INC) * eH[2]];
  const hH = [nH[1] * mH[2] - nH[2] * mH[1], nH[2] * mH[0] - nH[0] * mH[2], nH[0] * mH[1] - nH[1] * mH[0]];   // orbit normal = left of track
  const rotE = (t) => ((((t % 86400) + 86400) % 86400) / 86400) * TAU - Math.PI;
  function dirF(cu, su, cg, sg, out, o) {
    const rx = cu * nH[0] + su * mH[0], ry = cu * nH[1] + su * mH[1], rz = cu * nH[2] + su * mH[2];
    out[o] = cg * rx + sg * hH[0]; out[o + 1] = cg * ry + sg * hH[1]; out[o + 2] = cg * rz + sg * hH[2];
  }
  function toLocal(out, o, ca, sa) { const x = out[o], z = out[o + 2]; out[o] = x * ca - z * sa; out[o + 2] = x * sa + z * ca; }
  const cycleOf = (t) => { const c = Math.floor((t - T1) / CYC); return { n: C1 + c, start: T1 + c * CYC }; };

  // ---- where the radar collects: land and ice sheets + ~50 km coastal margin (from the orbit data's coastlines) ----
  const decode = (a) => { const o = new Float32Array(a.length); let x = 0, y = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; o[i] = x / 100; o[i + 1] = y / 100; } return o; };
  const LAND = DATA.land.map(decode);
  const MW = 2048, MH = 1024, mk = document.createElement("canvas"); mk.width = MW; mk.height = MH;
  const k2 = mk.getContext("2d", { willReadFrequently: true });
  k2.fillStyle = "#000"; k2.fillRect(0, 0, MW, MH);
  k2.fillStyle = "#fff"; k2.strokeStyle = "#fff"; k2.lineWidth = 5; k2.lineJoin = "round";
  // the Antarctica outline stops near 84°S, so fill the cap south of 78°S (all ice sheet or ice shelf);
  // open ocean around the poles stays dark (the old 60°S / 62°N bands lit up a ring of sea)
  k2.fillRect(0, ((90 + 78) / 180) * MH, MW, MH);
  for (const r of LAND) {
    k2.beginPath();
    for (let i = 0; i < r.length; i += 2) { const x = ((r[i] + 180) / 360) * MW, y = ((90 - r[i + 1]) / 180) * MH; i ? k2.lineTo(x, y) : k2.moveTo(x, y); }
    k2.closePath(); k2.fill(); k2.stroke();
  }
  const mdata = k2.getImageData(0, 0, MW, MH).data;
  function collecting(x, y, z) {
    const lat = Math.asin(Math.max(-1, Math.min(1, y))) * R2D, lon = Math.atan2(-z, x) * R2D;
    const r = Math.min(MH - 1, Math.max(0, Math.floor(((90 - lat) / 180) * MH))), c = Math.min(MW - 1, Math.max(0, Math.floor(((lon + 180) / 360) * MW)));
    return mdata[(r * MW + c) * 4] > 127;
  }

  // ---- precompute one cycle plus the day before it (the pattern repeats exactly every cycle) ----
  // buffer step k ↔ time (k − DAY)·DT into the cycle, so a 24 h window never has to wrap
  const NB = NSTEP + DAY;
  const ribPos = new Float32Array(NB * 6), ribCol = new Uint8Array(NB * 6), ribStep = new Float32Array(NB * 2);
  const nadPos = new Float32Array(NB * 3), nadStep = new Float32Array(NB), ribIdx = new Uint32Array((NB - 1) * 6);
  const cN = Math.cos(GN), sN = Math.sin(GN), cF = Math.cos(GF), sF = Math.sin(GF), tmp = new Float32Array(3);
  for (let k = 0; k < NB; k++) {
    const tt = (k - DAY) * DT, x = tt / T, u = (x - Math.floor(x)) * TAU;
    const cu = Math.cos(u), su = Math.sin(u), a = rotE(T1 + tt), ca = Math.cos(a), sa = Math.sin(a);
    dirF(cu, su, 1, 0, tmp, 0); toLocal(tmp, 0, ca, sa);
    nadPos[k * 3] = tmp[0] * 1.004; nadPos[k * 3 + 1] = tmp[1] * 1.004; nadPos[k * 3 + 2] = tmp[2] * 1.004; nadStep[k] = k;
    dirF(cu, su, cN, sN, ribPos, k * 6); toLocal(ribPos, k * 6, ca, sa);
    dirF(cu, su, cF, sF, ribPos, k * 6 + 3); toLocal(ribPos, k * 6 + 3, ca, sa);
    for (let q = 0; q < 6; q++) ribPos[k * 6 + q] *= 1.003;
    const col = cu > 0 ? ASC : DSC;
    for (let v = 0; v < 2; v++) { const o = k * 6 + v * 3; ribCol[o] = col[0]; ribCol[o + 1] = col[1]; ribCol[o + 2] = col[2]; ribStep[k * 2 + v] = k; }
    if (k < NB - 1) { const b = k * 2, o = k * 6; ribIdx[o] = b; ribIdx[o + 1] = b + 1; ribIdx[o + 2] = b + 2; ribIdx[o + 3] = b + 1; ribIdx[o + 4] = b + 3; ribIdx[o + 5] = b + 2; }
  }

  // ---- swaths (Earth frame) ----
  const ribGeo = new THREE.BufferGeometry();
  ribGeo.setAttribute("position", new THREE.BufferAttribute(ribPos, 3));
  ribGeo.setAttribute("aCol", new THREE.BufferAttribute(ribCol, 3, true));
  ribGeo.setAttribute("aStep", new THREE.BufferAttribute(ribStep, 1));
  ribGeo.setIndex(new THREE.BufferAttribute(ribIdx, 1));
  const maskTex = new THREE.CanvasTexture(mk);
  maskTex.generateMipmaps = false; maskTex.minFilter = THREE.LinearFilter; maskTex.wrapS = THREE.RepeatWrapping;
  const ribMat = new THREE.ShaderMaterial({
    uniforms: { uStep: { value: 0 }, uTrail: { value: TRAIL }, uMask: { value: maskTex } },
    vertexShader: `attribute vec3 aCol; attribute float aStep; uniform float uStep;
      varying vec3 vCol; varying float vAge; varying vec3 vP;
      void main(){ vCol = aCol; vP = position; vAge = uStep - aStep; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D uMask; uniform float uTrail;
      varying vec3 vCol; varying float vAge; varying vec3 vP;
      void main(){
        vec3 p = normalize(vP);
        vec2 uv = vec2(atan(-p.z, p.x) / 6.2831853 + 0.5, asin(clamp(p.y, -1.0, 1.0)) / 3.1415927 + 0.5);
        float on = texture2D(uMask, uv).r;
        float f = 1.0 - clamp(vAge / uTrail, 0.0, 1.0); f *= f;          // bright under the satellite, gone eight Earth diameters back
        float a = mix(0.1, 0.6, on) * f;                                 // additive: keep it below white so the pass colour shows
        gl_FragColor = vec4(vCol * (1.0 + 0.25 * f * on), a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,   // strips add light: they glow over the flat land
  });
  const ribbon = new THREE.Mesh(ribGeo, ribMat); ribbon.renderOrder = 2; ribbon.frustumCulled = false;

  const nadGeo = new THREE.BufferGeometry();
  nadGeo.setAttribute("position", new THREE.BufferAttribute(nadPos, 3));
  nadGeo.setAttribute("aStep", new THREE.BufferAttribute(nadStep, 1));
  const nadMat = new THREE.ShaderMaterial({
    uniforms: { uStep: { value: 0 }, uSpo: { value: NADIR_TRAIL } },                // ground track fades over its own, shorter trail
    vertexShader: `attribute float aStep; uniform float uStep; uniform float uSpo; varying float vAge;
      void main(){ vAge = (uStep - aStep) / uSpo; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vAge; void main(){ float a = 1.0 - clamp(vAge, 0.0, 1.0); gl_FragColor = vec4(0.84, 0.87, 0.99, a * a * 0.75); }`,
    transparent: true, depthWrite: false,
  });
  const nadir = new THREE.Line(nadGeo, nadMat); nadir.renderOrder = 3; nadir.frustumCulled = false;
  const swaths = new THREE.Group(); swaths.add(ribbon, nadir); G.spin.add(swaths);

  // ---- orbit frame: ring, satellite, beam ----
  const root = new THREE.Group(); G.scene.add(root);
  const RN = 720, ringPos = new Float32Array((RN + 1) * 3), ringU = new Float32Array(RN + 1);
  for (let i = 0; i <= RN; i++) { const u = (i / RN) * TAU; dirF(Math.cos(u), Math.sin(u), 1, 0, ringPos, i * 3); for (let q = 0; q < 3; q++) ringPos[i * 3 + q] *= R_ORB; ringU[i] = u; }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3)); ringGeo.setAttribute("aU", new THREE.BufferAttribute(ringU, 1));
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uSat: { value: 0 }, uWake: { value: WAKE } },
    vertexShader: `attribute float aU; varying float vU; void main(){ vU = aU; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uSat; uniform float uWake; varying float vU;
      void main(){ float b = mod(uSat - vU + 6.2831853, 6.2831853); float w = 1.0 - smoothstep(0.0, uWake, b);
        gl_FragColor = vec4(mix(vec3(0.56, 0.61, 0.95), vec3(1.0, 0.73, 0.51), w), 0.2 + 0.6 * w); }`,
    transparent: true, depthWrite: false,
  });
  const ring = new THREE.Line(ringGeo, ringMat); ring.renderOrder = 3; root.add(ring);

  // glow along the lines: soft additive dots on every vertex of the orbit ring and the ground track
  const px = G.renderer?.getPixelRatio?.() ?? Math.min(devicePixelRatio || 1, 2);
  const SOFT = "float r = length(gl_PointCoord - 0.5) * 2.0; float s = pow(max(0.0, 1.0 - r), 2.0);";
  const ringGlow = new THREE.Points(ringGeo, new THREE.ShaderMaterial({
    uniforms: { uSat: ringMat.uniforms.uSat, uWake: ringMat.uniforms.uWake, uSize: { value: 22 * px } },
    vertexShader: `attribute float aU; uniform float uSize; varying float vU; void main(){ vU = aU; gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uSat; uniform float uWake; varying float vU;
      void main(){ ${SOFT} float b = mod(uSat - vU + 6.2831853, 6.2831853); float w = 1.0 - smoothstep(0.0, uWake, b);
        gl_FragColor = vec4(mix(vec3(0.56, 0.61, 0.95), vec3(1.0, 0.73, 0.51), w), s * (0.1 + 0.45 * w)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  ringGlow.renderOrder = 3; ringGlow.frustumCulled = false; root.add(ringGlow);
  const nadGlow = new THREE.Points(nadGeo, new THREE.ShaderMaterial({
    uniforms: { uStep: nadMat.uniforms.uStep, uSpo: nadMat.uniforms.uSpo, uSize: { value: 20 * px } },
    vertexShader: `attribute float aStep; uniform float uStep; uniform float uSpo; uniform float uSize; varying float vAge;
      void main(){ vAge = (uStep - aStep) / uSpo; gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vAge; void main(){ ${SOFT} float a = 1.0 - clamp(vAge, 0.0, 1.0); gl_FragColor = vec4(0.62, 0.68, 1.0, s * a * a * 0.4); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  nadGlow.renderOrder = 3; nadGlow.frustumCulled = false; swaths.add(nadGlow);

  const sat = buildSat(); sat.scale.setScalar(opts.satScale ?? 0.0085); root.add(sat);

  const quadGeo = (nv, idx) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3)); g.setIndex(idx); return g; };
  const glow = (opacity, color = 0xffbb82) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beamGeo = quadGeo(5, [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]), footGeo = quadGeo(4, [0, 1, 2, 0, 2, 3]), sweepGeo = quadGeo(4, [0, 1, 2, 0, 2, 3]);
  const beamMat = glow(0.12), footMat = glow(0.45), sweepMat = glow(0.9, 0xf6ebe1);
  const rayGeo = new THREE.BufferGeometry(); rayGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const ray = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xffbb82, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  const beam = new THREE.Mesh(beamGeo, beamMat), foot = new THREE.Mesh(footGeo, footMat), sweep = new THREE.Mesh(sweepGeo, sweepMat);
  const radar = new THREE.Group();
  [beam, foot, sweep, ray].forEach((m, i) => { m.frustumCulled = false; m.renderOrder = 5 + i; radar.add(m); });
  root.add(radar);

  // ---- state + per-frame update ----
  const state = { t: Date.now() / 1000, speed: opts.speed ?? 600, playing: true };
  const S = new THREE.Vector3(), Vv = new THREE.Vector3(), Hv = new THREE.Vector3(...hH), Y = new THREE.Vector3(0, 1, 0);
  const look = new THREE.Vector3(), xAx = new THREE.Vector3(), mat4 = new THREE.Matrix4(), apex = new THREE.Vector3();
  const gP = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], q = new THREE.Vector3(), tmpW = new THREE.Vector3();
  const LOOK = 35.3 * D2R, pts = new Float32Array(3);
  const groundF = (u, gam, r, out) => { dirF(Math.cos(u), Math.sin(u), Math.cos(gam), Math.sin(gam), pts, 0); return out.set(pts[0] * r, pts[1] * r, pts[2] * r); };
  const info = {};
  let last = performance.now();

  G.onFrame((now, reduce) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    if (state.playing) state.t += dt * state.speed;
    const simT = state.t, cy = cycleOf(simT), tc = simT - cy.start;
    const a = rotE(simT);
    root.rotation.y = -a;

    // satellite: position, velocity, attitude (dish looking 35° off nadir to the left)
    const x = (simT - T1) / T, u = (x - Math.floor(x)) * TAU, cu = Math.cos(u), su = Math.sin(u);
    S.set(cu * nH[0] + su * mH[0], cu * nH[1] + su * mH[1], cu * nH[2] + su * mH[2]);
    Vv.set(-su * nH[0] + cu * mH[0], -su * nH[1] + cu * mH[1], -su * nH[2] + cu * mH[2]);
    apex.copy(S).multiplyScalar(R_ORB);
    sat.position.copy(apex);
    look.copy(S).multiplyScalar(-Math.cos(LOOK)).addScaledVector(Hv, Math.sin(LOOK));   // +z of the model = look direction
    xAx.crossVectors(Vv, look);
    sat.quaternion.setFromRotationMatrix(mat4.makeBasis(xAx, Vv, look));
    ringMat.uniforms.uSat.value = u;
    satTime.value = now / 1000;

    // is the beam centre over land/ice right now?
    groundF(u, GC, 1, tmpW).applyAxisAngle(Y, -a);
    const on = collecting(tmpW.x, tmpW.y, tmpW.z);

    // beam wedge, footprint and the receive line sweeping across the swath
    const du = (TAU * 4.5) / T, rg = 1.004;
    groundF(u - du, GN, rg, gP[0]); groundF(u - du, GF, rg, gP[1]); groundF(u + du, GF, rg, gP[2]); groundF(u + du, GN, rg, gP[3]);
    const bp = beamGeo.attributes.position; bp.setXYZ(0, apex.x, apex.y, apex.z); for (let i = 0; i < 4; i++) bp.setXYZ(i + 1, gP[i].x, gP[i].y, gP[i].z); bp.needsUpdate = true;
    const fp = footGeo.attributes.position; for (let i = 0; i < 4; i++) fp.setXYZ(i, gP[i].x, gP[i].y, gP[i].z); fp.needsUpdate = true;
    const ph = reduce ? 0.5 : (now / 750) % 1, gs = GN + (GF - GN) * ph, dg = (GF - GN) * 0.035, sw = sweepGeo.attributes.position;
    groundF(u - du, gs - dg, rg + 0.0005, q); sw.setXYZ(0, q.x, q.y, q.z); groundF(u - du, gs + dg, rg + 0.0005, q); sw.setXYZ(1, q.x, q.y, q.z);
    groundF(u + du, gs + dg, rg + 0.0005, q); sw.setXYZ(2, q.x, q.y, q.z); groundF(u + du, gs - dg, rg + 0.0005, q); sw.setXYZ(3, q.x, q.y, q.z); sw.needsUpdate = true;
    groundF(u, gs, rg, q); const rp = rayGeo.attributes.position; rp.setXYZ(0, apex.x, apex.y, apex.z); rp.setXYZ(1, q.x, q.y, q.z); rp.needsUpdate = true;
    beamMat.opacity = on ? 0.2 : 0.05; footMat.opacity = on ? 0.6 : 0.12; sweep.visible = ray.visible = on;

    // swaths and ground track: a trail eight Earth diameters long behind the satellite
    const jb = tc / DT + DAY, j = Math.min(NB - 1, Math.floor(jb));
    ribMat.uniforms.uStep.value = jb; nadMat.uniforms.uStep.value = jb;
    const r0 = Math.max(0, Math.floor(jb - TRAIL)); ribGeo.setDrawRange(r0 * 6, (j - r0) * 6);   // only the fading trail is drawn
    const n0 = Math.max(0, Math.floor(jb - NADIR_TRAIL)); nadGeo.setDrawRange(n0, j - n0 + 1);

    const nl = tmpW.copy(S).applyAxisAngle(Y, -a);
    Object.assign(info, { t: simT, cycle: cy.n, day: tc / 86400, track: Math.floor(tc / T) + 1, asc: cu > 0, on,
      lat: Math.asin(nl.y) * R2D, lon: Math.atan2(-nl.z, nl.x) * R2D });
    opts.onTick?.(info, now);
  });

  return {
    swaths, radar, state,
    setVisible(v) { swaths.visible = v; root.visible = v; },
    live() { state.t = Date.now() / 1000; },
    satPosition: (out) => sat.getWorldPosition(out),   // world position as of the last frame
  };
}
