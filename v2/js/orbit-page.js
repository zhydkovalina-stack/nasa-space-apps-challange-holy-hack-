/* Orbit & swath page: a full-screen, interactive glyph globe with the NISAR orbit simulation
   (orbit-sim.js): satellite, radar beam, ground track and the swaths of the last 24 hours. */
import { createGlobe, THREE, toLatLon } from "./globe-core.js";
import { addOrbit } from "./orbit-sim.js";

const $ = (id) => document.getElementById(id);
const canvas = $("orbit-canvas");
const G = await createGlobe(canvas, { interactive: true, camera: new THREE.Vector3(0.7, 1.3, 3.2), landGlow: false, rim: 0.12 });   // flat land, so the orbit lines stand out
G.uniforms.uDim.value = 0.45;

// ---------- simulation readout ----------
const pad = (n) => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let lastUi = 0, sim = null;
function onTick(s, now) {
  if (now - lastUi < 120) return;                           // ≈8 Hz is plenty for text
  lastUi = now;
  const d = new Date(s.t * 1000);
  $("sim-date").textContent = `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} · cycle ${s.cycle}, day ${s.day.toFixed(1)}`;
  $("sim-time").textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  $("sim-live").hidden = !(sim && sim.state.speed === 1 && sim.state.playing && Math.abs(s.t - Date.now() / 1000) < 5);
  $("sim-track").textContent = `${s.track} / 173`;
  const dir = $("sim-dir"); dir.textContent = s.asc ? "North" : "South"; dir.className = "dir" + (s.asc ? " a" : "");
  const r = $("sim-radar"); r.classList.toggle("on", s.on); r.lastChild.textContent = s.on ? "Imaging" : "Over ocean";
  $("sim-nadir").textContent = `${Math.abs(s.lat).toFixed(1)}° ${s.lat >= 0 ? "N" : "S"}  ${Math.abs(s.lon).toFixed(1)}° ${s.lon >= 0 ? "E" : "W"}`;
}

try {
  sim = await addOrbit(G, { onTick, speed: 300 });   // opens at 5 min/s (the highlighted button)
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const speedBtns = [...document.querySelectorAll("#sim [data-speed]")], play = $("sim-play"), nowBtn = $("sim-now");
  // `live`: Now was pressed, so Now is the highlighted button rather than 1×
  const setSpeed = (v, live = false) => {
    sim.state.speed = v;
    speedBtns.forEach((b) => b.setAttribute("aria-pressed", String(!live && +b.dataset.speed === v)));
    nowBtn.setAttribute("aria-pressed", String(live));
  };
  const setPlaying = (p) => { sim.state.playing = p; play.textContent = p ? "Pause" : "Play"; play.setAttribute("aria-label", p ? "Pause" : "Play"); };
  speedBtns.forEach((b) => b.addEventListener("click", () => { setSpeed(+b.dataset.speed); setPlaying(true); }));
  play.addEventListener("click", () => setPlaying(!sim.state.playing));

  // "Now": swing the camera round (same distance) until NISAR's position right now is in the
  // middle of the view. The target is re-read every frame, so the camera lands on the satellite
  // even though it keeps moving. Runs after the sim's own frame hook, so the position is fresh.
  const ctl = G.controls, from = new THREE.Spherical(), to = new THREE.Spherical(), cur = new THREE.Spherical(), satP = new THREE.Vector3();
  let fly = null;
  const endFly = () => { fly = null; ctl.enableDamping = true; };
  G.onFrame((now) => {
    if (!fly) return;
    fly.start ??= now;
    const k = fly.dur ? Math.min(1, (now - fly.start) / fly.dur) : 1;
    const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;                // ease in-out
    to.setFromVector3(sim.satPosition(satP));
    const dTh = Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));   // short way round
    cur.set(from.radius, from.phi + (to.phi - from.phi) * e, from.theta + dTh * e).makeSafe();
    G.camera.position.setFromSpherical(cur);
    if (k >= 1) endFly();
  });
  ctl.addEventListener("start", () => fly && endFly());                        // a drag takes over
  function flyToSat() {
    // drop any leftover drag momentum (damping) so it can't fight the move
    const p = G.camera.position.clone();
    ctl.autoRotate = false; ctl.enableDamping = false; ctl.update();
    G.camera.position.copy(p); ctl.update();
    from.setFromVector3(p);
    fly = { dur: reduce ? 0 : 1600, start: null };
  }

  nowBtn.addEventListener("click", () => { sim.live(); setSpeed(1, true); setPlaying(true); flyToSat(); });
  if (reduce) setPlaying(false);

  // orbit.html#now (the top bar's live NISAR readout links here): open in the Now view.
  // Clearing the hash afterwards lets the same link fire again when clicked on this page.
  const nowFromHash = () => {
    if (location.hash !== "#now") return;
    nowBtn.click();
    history.replaceState(null, "", location.pathname + location.search);
  };
  nowFromHash();
  addEventListener("hashchange", nowFromHash);
} catch (e) {
  console.error(e);
  $("sim-date").textContent = "Orbit model unavailable";
}

// ---------- latitude / longitude under the pointer ----------
const ray = new THREE.Raycaster(), m = new THREE.Vector2(), read = $("orbit-read");
canvas.addEventListener("pointermove", (ev) => {
  const r = canvas.getBoundingClientRect();
  m.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(m, G.camera);
  const hit = ray.intersectObject(G.core)[0];
  if (!hit) { read.textContent = ""; return; }
  const ll = toLatLon(G.spin.worldToLocal(hit.point.clone()));
  read.textContent = `${ll.lat.toFixed(2)}° · ${ll.lon.toFixed(2)}°`;
});
