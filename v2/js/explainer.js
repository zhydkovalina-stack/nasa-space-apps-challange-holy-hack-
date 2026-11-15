/* "How NISAR sees" — one sticky canvas stage, three scenes, all drawn in dots:
   0 own light (weather vs camera/radar) · 1 echoes (surface-dependent scattering) ·
   2 change (phase shift and interferogram fringes for a sinking bowl). */
(function () {
  const cv = document.getElementById("stage"), ctx = cv.getContext("2d");
  const read = document.getElementById("stage-read"), ctl = document.getElementById("stage-ctl");
  const C = { void: "#07040d", plum: "#150a24", violet: "#3a1d6e", indigo: "#5a45c2", peri: "#8f9cf2", ice: "#d6defc", rust: "#c4573a", peach: "#ffbb82", cream: "#f6ebe1", green: "#6fd08c", water: "#2a3e9e" };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = { step: 0, sky: "day", surf: "forest", sink: 3 };
  let W = 0, H = 0, dpr = 1, particles = [], returned = [], echo = 0, visible = true;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
  }
  new ResizeObserver(resize).observe(cv); resize();
  new IntersectionObserver((e) => (visible = e[0].isIntersecting)).observe(cv);

  // ---------- drawing helpers ----------
  const dot = (x, y, r, col, a = 1) => { ctx.globalAlpha = a; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1; };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function dither(x0, y0, w, h, colTop, colBot, step = 6, dense = 1) {      // stepped vertical gradient: hard colour bands
    const a = rgb(colTop), b = rgb(colBot), n = 7;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1), c = a.map((v, j) => Math.round(v + (b[j] - v) * k));
      ctx.globalAlpha = (0.35 + 0.65 * k) * Math.min(1, dense + 0.2);
      ctx.fillStyle = `rgb(${c})`;
      ctx.fillRect(x0, y0 + (h * i) / n, w, h / n + 1);
    }
    ctx.globalAlpha = 1;
  }
  function satellite(x, y, s = 1) {
    const p = 3 * s;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) { ctx.fillStyle = (i + j) % 2 ? C.indigo : C.peri; ctx.fillRect(x - 30 * s + i * p, y + j * p, p - 0.6, p - 0.6); }
    ctx.fillStyle = C.ice; ctx.fillRect(x - 3 * s, y - 2 * s, 9 * s, 10 * s);
    ctx.strokeStyle = C.ice; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 6 * s, y + 2 * s); ctx.lineTo(x + 20 * s, y - 6 * s); ctx.stroke();
    ctx.setLineDash([2, 2]); ctx.strokeStyle = C.peach; ctx.beginPath(); ctx.ellipse(x + 24 * s, y - 10 * s, 12 * s, 5 * s, -0.5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  function label(x, y, text, col = C.muted || "#8a84a8", align = "left") {
    ctx.font = "10px Nasalization, sans-serif"; ctx.fillStyle = col; ctx.textAlign = align; ctx.fillText(text.toUpperCase(), x, y); ctx.textAlign = "left";
  }
  function setRead(big, small) { read.innerHTML = `<b>${big}</b>${small}`; }

  // ---------- scene 0: own light ----------
  function scene0(t) {
    const night = state.sky === "night", storm = state.sky === "storm";
    dither(0, 0, W, H * 0.8, night ? C.void : C.violet, night ? C.plum : C.indigo, 7, night ? 0.5 : 0.8);
    if (night) for (let i = 0; i < 60; i++) dot((i * 97) % W, (i * 53) % (H * 0.6), 0.9, C.ice, 0.3 + 0.3 * Math.sin(t / 700 + i));
    // sun or moon
    const sx = W * 0.82, sy = H * 0.14;
    if (night) { dot(sx, sy, 14, C.ice, 0.9); dot(sx + 6, sy - 4, 13, C.void); }
    else for (let a = 0; a < 7; a++) for (let r = 4; r < 22; r += 4) dot(sx + Math.cos(a) * r * 0.2, sy + Math.sin(a) * r * 0.2, 16 - r * 0.5, C.cream, 0.15);
    if (!night) dot(sx, sy, 12, C.cream);
    // sunlight rays (cream) reach ground unless storm
    const gY = H * 0.8;
    if (!night) {
      ctx.setLineDash([2, 5]); ctx.strokeStyle = C.cream; ctx.globalAlpha = 0.5;
      for (let i = 0; i < 5; i++) { const ex = W * (0.35 + i * 0.09); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, storm ? H * 0.47 : gY); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // clouds
    if (storm) for (let i = 0; i < 260; i++) {
      const cx = (i * 37.3) % W, cy = H * 0.42 + Math.sin(i * 1.7) * 18 + ((i * 13) % 30);
      dot((cx + t * 0.01) % W, cy, 3 + (i % 4), "#9a95b8", 0.55);
    }
    // ground: patchwork fields
    for (let x = 0; x < W; x += 8) for (let y = gY; y < H; y += 8) {
      const f = Math.floor(x / 70 + Math.floor(y / 30)) % 3;
      dot(x, y, 2.4, f === 0 ? "#6fd08c" : f === 1 ? "#c9a36a" : "#8a6a48", night ? 0.35 : 0.85);
    }
    // satellite + radar pulses (pass through everything)
    const satX = W * 0.22, satY = H * 0.12;
    satellite(satX, satY, 1.2);
    for (let k = 0; k < 4; k++) {
      const ph = ((t / 1600 + k / 4) % 1);
      const r = ph * Math.hypot(W * 0.5, gY - satY);
      ctx.strokeStyle = C.peach; ctx.globalAlpha = (1 - ph) * 0.9; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(satX, satY + 12, r, 0.25, 1.35); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    const cam = night ? 0 : storm ? 4 : 100;
    setRead(`${cam}% / 100%`, `Camera sees · Radar sees<br>${night ? "No sunlight to reflect" : storm ? "Clouds block the camera" : "Both see the ground"}`);
    label(16, 24, "NISAR · 747 km", C.ice);
    label(16, gY - 8, "Ground", C.ice);
  }

  // ---------- scene 1: echoes ----------
  const SURF = {
    water:  { name: "Lake", map: "#141b4a", note: "Mirror bounce · almost no echo · dark", ret: 0.03 },
    field:  { name: "Bare field", map: "#a0704a", note: "Rough surface · some echo · brown", ret: 0.28 },
    forest: { name: "Forest", map: "#3f8f5a", note: "Volume scattering · echo changes polarisation · green", ret: 0.5 },
    city:   { name: "City", map: "#ffb05a", note: "Double bounce off walls · strong echo · yellow", ret: 0.85 }
  };
  function spawn(t) {
    const gY = H * 0.72, S = { x: W * 0.18, y: H * 0.14 };
    const hx = W * (0.45 + Math.random() * 0.35);
    const path = [S, { x: hx, y: gY }];
    const surf = state.surf, back = Math.random() < SURF[surf].ret;
    if (surf === "water") path.push({ x: hx + (hx - S.x), y: S.y - 40 });                 // mirror away
    else if (surf === "forest") {
      path[1].y = gY - 30 - Math.random() * 40;
      for (let i = 0; i < 3; i++) path.push({ x: hx + (Math.random() - 0.5) * 60, y: gY - 10 - Math.random() * 70 });
      path.push(back ? { x: S.x + 10, y: S.y + 10 } : { x: hx + (Math.random() - 0.3) * W, y: -20 });
    } else if (surf === "city") {
      const wallX = Math.min(W - 40, hx + 40); path[1].x = wallX - 30;
      path.push({ x: wallX, y: gY - 50 - Math.random() * 30 });
      path.push(back ? { x: S.x + 10, y: S.y + 10 } : { x: W + 20, y: Math.random() * H * 0.5 });
    } else {
      path.push(back ? { x: S.x + 10, y: S.y + 10 } : { x: hx + (Math.random() - 0.5) * W * 0.9, y: -20 });
    }
    particles.push({ path, t0: t, dur: 2200 + Math.random() * 600, back, surf });
  }
  function scene1(t) {
    dither(0, 0, W, H, C.plum, C.violet, 8, 0.5);
    const gY = H * 0.72, s = state.surf;
    // surface drawing
    if (s === "water") for (let x = 0; x < W; x += 6) for (let y = gY; y < H; y += 6) dot(x, y + Math.sin(x / 20 + t / 500) * 1.5, 2, C.water, 0.8);
    if (s === "field") for (let x = 0; x < W; x += 6) for (let y = gY + Math.abs(Math.sin(x * 0.7)) * 8; y < H; y += 6) dot(x, y, 2.2, "#a0704a", 0.85);
    if (s === "forest") {
      for (let x = 0; x < W; x += 6) for (let y = gY; y < H; y += 6) dot(x, y, 2, "#5b4632", 0.8);
      for (let tr = 0; tr < W; tr += 34) for (let k = 0; k < 26; k++) dot(tr + 17 + Math.cos(k * 2.4) * (k % 5) * 3.2, gY - 30 - Math.sin(k * 1.3) * 26 - k, 2.2, C.green, 0.75);
    }
    if (s === "city") {
      for (let x = 0; x < W; x += 6) for (let y = gY; y < H; y += 6) dot(x, y, 2, "#6b6680", 0.8);
      for (let b = 0; b < W; b += 46) { const bh = 40 + ((b * 7) % 50); for (let x = b + 6; x < b + 34; x += 5) for (let y = gY - bh; y < gY; y += 5) dot(x, y, 1.7, "#c9c3dc", 0.7); }
    }
    satellite(W * 0.18, H * 0.14, 1.1);
    if (!reduce && t - (scene1.last || 0) > 70) { scene1.last = t; spawn(t); }
    particles = particles.filter((p) => t - p.t0 < p.dur);
    for (const p of particles) {
      const u = (t - p.t0) / p.dur, segs = p.path.length - 1, f = Math.min(segs - 1e-6, u * segs), i = Math.floor(f), k = f - i;
      const a = p.path[i], b = p.path[i + 1];
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
      const col = i === 0 ? C.peach : p.surf === "forest" ? C.green : C.peri;
      dot(x, y, 2.4, col, 0.95);
      if (p.back && u > 0.97 && !p.counted) { p.counted = true; returned.push(t); }
    }
    returned = returned.filter((r) => t - r < 3000);
    const target = SURF[s].ret;
    echo += (target - echo) * 0.03;
    // returned-echo meter as dot bar
    for (let i = 0; i < 20; i++) dot(W - 150 + i * 7, 96, 2.6, i / 20 < echo ? SURF[s].map : C.violet, 1);
    label(W - 150, 84, "Echo strength", "#8a84a8");
    // how it looks on the map
    ctx.fillStyle = SURF[s].map; ctx.fillRect(W - 150, 114, 40, 22);
    label(W - 104, 129, "on the NISAR map", "#8a84a8");
    setRead(`${Math.round(echo * 100)}%`, `${SURF[s].name} · ${SURF[s].note}`);
    read.style.top = "150px";
    label(16, 24, "Outgoing pulse", C.peach); label(16, 40, s === "forest" ? "Echo (cross-polarised)" : "Echo", s === "forest" ? C.green : C.peri);
  }

  // ---------- scene 2: change between passes ----------
  const twilight = ["#d6defc", "#8f9cf2", "#5a45c2", "#3a1d6e", "#2c1450", "#4d1648", "#9a3044", "#de6a3e", "#ffbb82", "#fff3dc", "#d6defc"];
  const cyc = (p) => { const u = ((p % 1) + 1) % 1 * (twilight.length - 1); return twilight[Math.round(u)]; };
  function scene2(t) {
    dither(0, 0, W, H, C.plum, C.violet, 8, 0.5);
    const sink = state.sink, gY0 = H * 0.62, drop = sink * 3.2;
    const S = { x: W * 0.14, y: H * 0.14 };
    satellite(S.x, S.y, 1.05);
    // ground: left stable, centre bowl sinks
    for (let x = 0; x < W * 0.62; x += 6) {
      const r = Math.abs(x - W * 0.42) / (W * 0.18), bowl = r < 1 ? (1 - r * r) : 0;
      for (let y = gY0 + bowl * drop; y < H * 0.8; y += 6) dot(x, y, 2, "#8a6a48", 0.85);
      if (bowl > 0 && sink > 0.2) dot(x, gY0, 1, C.ice, 0.35);
    }
    label(W * 0.42 - 40, gY0 - 10, "before", "#8a84a8"); label(W * 0.42 - 40, gY0 + drop + 18, sink > 0.2 ? "12 days later" : "", C.peach);
    // two waves from satellite to bowl centre
    const T = { x: W * 0.42, y: gY0 }, L = Math.hypot(T.x - S.x, T.y - S.y);
    const dir = { x: (T.x - S.x) / L, y: (T.y - S.y) / L }, nrm = { x: -dir.y, y: dir.x };
    const lam = 42, flow = reduce ? 0 : t / 600;
    for (const [col, extra, off] of [[C.peri, 0, -7], [C.peach, drop, 7]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath();
      const len = L + extra;
      for (let d = 0; d <= len; d += 3) {
        const amp = 9 * Math.sin((d / lam) * Math.PI * 2 - flow);
        const x = S.x + dir.x * d + nrm.x * (amp + off), y = S.y + dir.y * d + nrm.y * (amp + off);
        d === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // interferogram fringe tile
    const tile = Math.min(W * 0.32, H * 0.42), tx = W - tile - 18, ty = H * 0.16, cell = 5;
    for (let y = 0; y < tile; y += cell) for (let x = 0; x < tile; x += cell) {
      const r = Math.hypot(x - tile / 2, y - tile / 2) / (tile / 2);
      const disp = r < 1 ? sink * (1 - r * r) * (1 - r * r) : 0;
      dot(tx + x, ty + y, cell * 0.46, cyc(disp / 12 + 0.36), 1);
    }
    label(tx, ty - 8, "Interferogram, from above", "#8a84a8");
    label(tx, ty + tile + 16, "1 colour cycle = 12 cm", C.ice);
    const deg = (sink / 12) * 360;
    setRead(`${sink.toFixed(1)} cm`, `Echo shifted ${Math.round(deg)}° · ${(sink / 12).toFixed(2)} colour cycles`);
    read.style.top = `${ty + tile + 36}px`;
    label(16, 24, "Pass 1 echo", C.peri); label(16, 40, "Pass 2 echo (12 days later)", C.peach);
  }

  // ---------- loop ----------
  const scenes = [scene0, scene1, scene2];
  function frame(t) {
    if (visible && W) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      read.style.top = "16px";
      scenes[state.step](t);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- step activation + controls ----------
  const steps = [...document.querySelectorAll(".step")];
  function setStep(i) {
    state.step = i; particles = []; echo = 0;
    steps.forEach((s, k) => s.classList.toggle("on", k === i));
    ctl.hidden = i !== 2;
    photo();
  }
  // step 2 + Forest: show the illustrated forest echo (img/forest-bounce.png) over the animation
  const photoEl = document.getElementById("stage-photo");
  function photo() { if (photoEl) photoEl.hidden = !(state.step === 1 && state.surf === "forest"); }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setStep(+e.target.dataset.step); }),
    { rootMargin: "-40% 0px -50% 0px" });
  steps.forEach((s) => { io.observe(s); s.addEventListener("click", () => setStep(+s.dataset.step)); });
  const group = (attr, key) => document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener("click", () => {
    state[key] = b.dataset[attr]; particles = [];
    document.querySelectorAll(`[data-${attr}]`).forEach((o) => o.setAttribute("aria-pressed", o === b));
    photo();
  }));
  group("sky", "sky"); group("surf", "surf");
  const sink = document.getElementById("sink"), sinkV = document.getElementById("sink-v");
  sink.addEventListener("input", () => { state.sink = +sink.value; sinkV.textContent = state.sink.toFixed(1) + " cm"; });
})();
