/* Background sky: a sparse lattice of thin-line glyphs (ring, ring+dot, x, plus, square, dot)
   that appear in drifting patches like the texture reference, about one in ten glowing and
   twinkling like stars, plus scattered four-point sparkle stars (the hero's shape) in the golden
   highlight. Plus page chrome: UTC clock and section highlighting. */
(function () {
  const cv = document.getElementById("sky"), ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COLORS = ["#8f9cf2", "#d6defc", "#5a45c2", "#ffbb82"];
  const CELL = 26;
  let W, H, dpr, stars = [];

  // cheap value noise for patchiness
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf);
  }

  function build() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.width = Math.round(innerWidth * dpr); H = cv.height = Math.round(innerHeight * dpr);
    stars = [];
    const cols = Math.ceil(innerWidth / CELL) + 1, rows = Math.ceil(innerHeight * 1.6 / CELL) + 1;   // taller than screen for parallax
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const n = noise(c / 9, r / 7);                 // patch field
      const j = hash(c, r);
      if (n < 0.58 && j > 0.012) continue;            // empty sky, with rare lone stars
      const dense = n > 0.72;
      if (!dense && j > 0.45) continue;
      const glyph = dense ? Math.floor(hash(c * 3, r * 5) * 5) : (j < 0.3 ? 5 : Math.floor(j * 10) % 5);
      stars.push({
        x: c * CELL + CELL / 2, y: r * CELL + CELL / 2, g: glyph,
        s: dense ? 5.5 : 3.2, col: COLORS[j < 0.04 ? 3 : Math.floor(hash(r, c) * 3)],
        a: dense ? 0.07 + (n - 0.72) * 0.35 : 0.1, glow: j < 0.11, ph: j * 40, sp: 0.6 + hash(c, r * 2) * 1.6
      });
    }
    // four-point sparkle stars (the hero's shape), scattered over the whole sky: mostly the golden highlight, some ice
    sparkles = [];
    const hi = getComputedStyle(document.documentElement).getPropertyValue("--hi").trim() || "#eeff1a";
    const count = Math.round((innerWidth * innerHeight * 1.6) / 70000);
    for (let i = 0; i < count; i++) {
      const u = hash(i * 7.1, 3.3), v = hash(i * 2.9, 8.7), k = hash(i * 5.3, 1.1);
      sparkles.push({ x: u * innerWidth, y: v * innerHeight * 1.6, s: 4.5 + k * k * 11, col: k < 0.7 ? hi : "#d6defc", ph: k * 50, sp: 0.4 + hash(i, 9) * 1.2 });
    }
  }
  let sparkles = [];
  function sparkle(x, y, s) {           // the hero's four-point star: thin curved arms (same curve as the SVG path)
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.bezierCurveTo(x + 0.06 * s, y - 0.24 * s, x + 0.24 * s, y - 0.06 * s, x + s, y);
    ctx.bezierCurveTo(x + 0.24 * s, y + 0.06 * s, x + 0.06 * s, y + 0.24 * s, x, y + s);
    ctx.bezierCurveTo(x - 0.06 * s, y + 0.24 * s, x - 0.24 * s, y + 0.06 * s, x - s, y);
    ctx.bezierCurveTo(x - 0.24 * s, y - 0.06 * s, x - 0.06 * s, y - 0.24 * s, x, y - s);
    ctx.fill();
  }

  function glyph(x, y, s, g) {
    ctx.beginPath();
    switch (g) {
      case 0: ctx.arc(x, y, s, 0, 7); break;                                      // ring
      case 1: ctx.arc(x, y, s, 0, 7); ctx.moveTo(x + 1.4, y); ctx.arc(x, y, 1.4, 0, 7); break;  // ring + dot
      case 2: ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); break; // x
      case 3: ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); break;  // plus
      case 4: ctx.rect(x - s, y - s, s * 2, s * 2); break;                       // square
      default: ctx.arc(x, y, 0.9, 0, 7);                                          // dot
    }
    g === 5 ? ctx.fill() : ctx.stroke();
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const off = (scrollY * 0.12) % (innerHeight * 0.6);
    ctx.lineWidth = 0.7;
    for (const s of stars) {
      const y = s.y - off;
      if (y < -10 || y > innerHeight + 10) continue;
      let a = s.a;
      if (s.glow) {
        a = 0.22 + 0.3 * (0.5 + 0.5 * Math.sin(t / 1000 * s.sp + s.ph));
        ctx.shadowColor = s.col; ctx.shadowBlur = 7;
      } else ctx.shadowBlur = 0;
      ctx.globalAlpha = a; ctx.strokeStyle = ctx.fillStyle = s.col;
      glyph(s.x, y, s.s, s.g);
    }
    for (const s of sparkles) {                                   // glowing, slowly twinkling sparkles
      const y = s.y - off;
      if (y < -20 || y > innerHeight + 20) continue;
      const tw = 0.5 + 0.5 * Math.sin(t / 1000 * s.sp + s.ph);
      ctx.globalAlpha = 0.22 + 0.36 * tw; ctx.fillStyle = ctx.shadowColor = s.col; ctx.shadowBlur = 4 + s.s * 0.8;
      sparkle(s.x, y, s.s * (0.85 + 0.15 * tw));
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    if (!reduce) requestAnimationFrame(draw);
  }

  build(); requestAnimationFrame(draw);
  addEventListener("resize", () => { build(); if (reduce) draw(0); });
  if (reduce) addEventListener("scroll", () => draw(0), { passive: true });

  // ---- chrome: section highlight (the top bar's live NISAR readout is js/nisar-now.js) ----
  const links = [...document.querySelectorAll('.rail nav a, .secnav a, .topnav a[href^="#"]')];   // in-page links only: page links keep their aria-current state
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    // a section without its own link (e.g. the photo between passes) keeps the previous one lit
    if (e.isIntersecting && links.some((a) => a.getAttribute("href") === "#" + e.target.id))
      links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id));
  }), { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll("main > section[id]").forEach((s) => io.observe(s));
})();
