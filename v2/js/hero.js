/* Hero: decorative glyph globe + a small 3D NISAR (sat-model.js) on a near-polar orbit. The radar footprint
   pulses under the satellite and leaves a fading swath of peach dots on the ground. */
import { createGlobe, THREE, toLatLon, hex } from "./globe-core.js";
import { buildSat, satTime } from "./sat-model.js";

const canvas = document.getElementById("hero-globe");
// fov 43 (not the default 38) + orbit radius 1.1 keep the whole satellite inside the canvas (checked: ≤ 97 % of the frame)
const G = await createGlobe(canvas, { camera: new THREE.Vector3(0.4, 0.75, 3.35), fov: 43, step: 1.15, fillStrength: 0.38 });
G.spin.rotation.z = THREE.MathUtils.degToRad(-12);

const sat = buildSat();
G.scene.add(sat);
const velo = new THREE.Vector3();

// radar beam: dotted line + pulsing footprint ring
const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const beam = new THREE.Line(beamGeo, new THREE.LineDashedMaterial({ color: 0xffbb82, dashSize: 0.012, gapSize: 0.012, transparent: true, opacity: 0.5 }));
G.scene.add(beam);
const ringPts = Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2; return new THREE.Vector3(Math.cos(a), Math.sin(a), 0); });
const foot = new THREE.Points(new THREE.BufferGeometry().setFromPoints(ringPts),
  new THREE.PointsMaterial({ color: 0xffbb82, size: 2.2, sizeAttenuation: false, transparent: true }));
G.scene.add(foot);

// swath trail: fixed pool of glow points stuck to the spinning Earth
const TRAIL = 220;
const trail = G.pointsFrom(Array.from({ length: TRAIL }, () => ({ lat: 0, lon: 0, r: 1.004, glyph: 0, size: 0.012, color: hex("#ffbb82") })), false);
trail.material.depthWrite = false;
G.spin.add(trail);
const tpos = trail.geometry.attributes.position, tsize = trail.geometry.attributes.aSize;
for (let i = 0; i < TRAIL; i++) tsize.setX(i, 0);
let ti = 0, lastDrop = 0;

const ORBIT_R = 1.1, INC = THREE.MathUtils.degToRad(98.4);
const orbitAxis = new THREE.Vector3(0, Math.cos(INC - Math.PI / 2), Math.sin(INC - Math.PI / 2)).normalize();
const start = new THREE.Vector3(1, 0, 0);
const hudPos = document.getElementById("hud-pos");
let hudT = 0;

G.onFrame((t, reduce) => {
  const s = reduce ? 0 : t / 1000;
  G.spin.rotation.y = s * 0.06;
  const ang = s * 0.32 + 0.6;
  const p = start.clone().applyAxisAngle(orbitAxis, ang).multiplyScalar(ORBIT_R);
  sat.position.copy(p).multiplyScalar(1 + Math.sin(s * 0.9) * 0.008);   // slow drift in and out, so it floats
  velo.crossVectors(orbitAxis, p).normalize();
  sat.up.copy(velo);
  sat.lookAt(0, 0, 0);                                            // +z at Earth, +y along the orbit
  sat.rotateY(0.35 + Math.sin(s * 0.47) * 0.08);                  // look off-nadir, with a gentle sway
  sat.rotateX(Math.sin(s * 0.31 + 1) * 0.06);
  satTime.value = s;
  const ground = p.clone().normalize().multiplyScalar(1.003);
  const bp = beamGeo.attributes.position;
  bp.setXYZ(0, p.x, p.y, p.z); bp.setXYZ(1, ground.x, ground.y, ground.z); bp.needsUpdate = true;
  beam.computeLineDistances();
  const pulse = (s * 1.4) % 1;
  foot.position.copy(ground);
  foot.lookAt(0, 0, 0);
  foot.scale.setScalar(0.02 + pulse * 0.07);
  foot.material.opacity = 1 - pulse;

  // drop swath points (in Earth-fixed coordinates) every ~60 ms
  if (t - lastDrop > 60) {
    lastDrop = t;
    const local = G.spin.worldToLocal(ground.clone());
    const side = new THREE.Vector3().crossVectors(local, orbitAxis.clone().applyQuaternion(G.spin.quaternion.clone().invert())).normalize();
    for (let k = -1; k <= 1; k++) {
      const q = local.clone().add(side.clone().multiplyScalar(k * 0.022)).normalize().multiplyScalar(1.004);
      tpos.setXYZ(ti, q.x, q.y, q.z); tsize.setX(ti, 0.013); ti = (ti + 1) % TRAIL;
    }
    for (let i = 0; i < TRAIL; i++) tsize.setX(i, tsize.getX(i) * 0.985);
    tpos.needsUpdate = tsize.needsUpdate = true;
    if (t - hudT > 400) {
      hudT = t;
      const ll = toLatLon(local);
      hudPos.textContent = `LAT ${ll.lat >= 0 ? "+" : ""}${ll.lat.toFixed(2)} LON ${ll.lon >= 0 ? "+" : ""}${ll.lon.toFixed(2)}`;
    }
  }
});

// live "next pass over Poznań" from NASA's NISAR observation plans (ArcGIS)
const np = document.getElementById("next-pass");
if (np) window.NASA_GIS?.passesOver(52.41, 16.93).then((frames) => {   // only when the page shows the next-pass line
  const next = frames.flatMap((f) => f.next.map((d) => ({ d, f }))).sort((a, b) => a.d.localeCompare(b.d))[0];
  if (!next) { np.textContent = "No NISAR pass over Poznań planned in the current schedule."; return; }
  const when = new Date(next.d + "T" + next.f.acquisition_time + "Z");
  const days = Math.max(0, Math.round((when - Date.now()) / 864e5));
  np.innerHTML = `Next pass over Poznań: <b>${when.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${next.f.acquisition_time.slice(0, 5)} UTC</b> · track ${next.f.track} ${next.f.passdirection === "Ascending" ? "northbound" : "southbound"} · in ${days} day${days === 1 ? "" : "s"}`;
}).catch(() => (np.textContent = "Next pass over Poznań: NASA's schedule is unavailable right now."));
