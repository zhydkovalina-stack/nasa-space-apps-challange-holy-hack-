/* Top bar: where NISAR is right now (the point on the ground under it), updated every second.
   The readout is a link to orbit.html#now, which opens the orbit page in its "Now" view.

   Same orbit model and maths as js/orbit-sim.js (circular, sun-synchronous, exact 12-day / 173-orbit
   repeat). The constants are copied from demo/data/orbit/orbit-data.json ("orbit"), so the page doesn't
   have to download that 250 kB file just for six numbers. If the fit there changes, update them here too. */
(() => {
  const el = document.getElementById("sat-now");
  if (!el) return;
  const O = { T: 5993.063583815029, t1: 1792821745.042, ltan: 6.0277, inc: 98.4832 };
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;
  const INC = O.inc * D2R, HN = 15 * (O.ltan - 12) * D2R;
  // sun-fixed frame (+X toward the mean sun, +Y north): ascending node, and the orbit's top (90° past it)
  const nH = [Math.cos(HN), 0, -Math.sin(HN)];
  const eH = [-Math.sin(HN), 0, -Math.cos(HN)];
  const mH = [Math.cos(INC) * eH[0], Math.sin(INC), Math.cos(INC) * eH[2]];
  const rotE = (t) => ((((t % 86400) + 86400) % 86400) / 86400) * TAU - Math.PI;

  function subPoint(t) {
    const x = (t - O.t1) / O.T, u = (x - Math.floor(x)) * TAU, cu = Math.cos(u), su = Math.sin(u);
    const sx = cu * nH[0] + su * mH[0], sy = cu * nH[1] + su * mH[1], sz = cu * nH[2] + su * mH[2];
    const a = rotE(t), ca = Math.cos(a), sa = Math.sin(a);
    const ex = sx * ca - sz * sa, ez = sx * sa + sz * ca;        // into the Earth-fixed frame
    return { lat: Math.asin(sy) * R2D, lon: Math.atan2(-ez, ex) * R2D };
  }

  const lat = el.querySelector(".lat"), lon = el.querySelector(".lon");
  // fixed-length strings ("05.20°N", "016.90°E"), one span per character: digits get class "d" and
  // N/S/E/W class "h", both fixed-width in the CSS, so the readout never changes width
  const fmt = (v, int, pos, neg) => Math.abs(v).toFixed(2).padStart(int + 3, "0") + "°" + (v >= 0 ? pos : neg);
  function render(box, str) {
    if (box.childElementCount !== str.length) box.replaceChildren(...[...str].map(() => document.createElement("span")));
    [...str].forEach((c, i) => {
      const s = box.children[i];
      if (s.textContent === c) return;
      s.textContent = c;
      s.className = /\d/.test(c) ? "d" : /[NSEW]/.test(c) ? "h" : "";
    });
  }
  const tick = () => {
    const p = subPoint(Date.now() / 1000);
    render(lat, fmt(p.lat, 2, "N", "S"));
    render(lon, fmt(p.lon, 3, "E", "W"));
    el.setAttribute("aria-label", `NISAR is over ${lat.textContent}, ${lon.textContent}. Open the live orbit view`);
  };
  tick(); setInterval(tick, 1000);
})();
