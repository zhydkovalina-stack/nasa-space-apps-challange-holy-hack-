/* Small time-series chart (SVG): one shared y-axis, 2px lines, 8px markers with a surface ring,
   a legend, direct labels at the line ends, a crosshair tooltip and a table view.
   Colours are validated for the dark panel (dataviz validate_palette: HH #c962be, HV #3fab70). */

const NS = "http://www.w3.org/2000/svg";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent && parent.appendChild(e);
  return e;
};

/** rows: [{ date: Date, cycle, v: { key: number|null } }]; series: [{ key, name, color }] */
export function seriesChart(host, rows, series, { yMax = 255, unit = "", surface = "#141416" } = {}) {
  host.innerHTML = "";
  host.classList.add("ex-chart");
  const legend = document.createElement("div");
  legend.className = "ex-chart-legend";
  legend.innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("");
  host.appendChild(legend);

  const wrap = document.createElement("div");
  wrap.className = "ex-chart-plot";
  host.appendChild(wrap);
  const W = Math.max(260, host.clientWidth || 320), H = 168, M = { l: 32, r: 40, t: 10, b: 24 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": `Time series of ${series.map((s) => s.name).join(" and ")}` }, wrap);
  const t0 = +rows[0].date, t1 = +rows[rows.length - 1].date, span = Math.max(1, t1 - t0);
  const X = (d) => (rows.length === 1 ? (M.l + W - M.r) / 2 : M.l + ((+d - t0) / span) * (W - M.l - M.r));
  const Y = (v) => M.t + (1 - v / yMax) * (H - M.t - M.b);

  // recessive grid + axis labels
  const grid = el("g", { class: "ex-grid" }, svg);
  [0, 64, 128, 192, 255].forEach((v) => {
    el("line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v) }, grid);
    el("text", { x: M.l - 6, y: Y(v) + 3, "text-anchor": "end" }, grid).textContent = v;
  });
  const ticks = rows.length <= 6 ? rows : rows.filter((_, i) => i % Math.ceil(rows.length / 5) === 0);
  ticks.forEach((r) => { el("text", { x: X(r.date), y: H - 6, "text-anchor": "middle" }, grid).textContent = day(r.date); });

  // lines, markers, direct labels (end labels pushed apart so they never overlap)
  const ends = [];
  series.forEach((s) => {
    const pts = rows.filter((r) => r.v[s.key] != null);
    if (!pts.length) return;
    el("path", { d: pts.map((r, i) => `${i ? "L" : "M"}${X(r.date).toFixed(1)},${Y(r.v[s.key]).toFixed(1)}`).join(""), fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    pts.forEach((r) => el("circle", { cx: X(r.date), cy: Y(r.v[s.key]), r: 4, fill: s.color, stroke: surface, "stroke-width": 2 }, svg));
    const last = pts[pts.length - 1];
    ends.push({ x: X(last.date) + 8, y: Y(last.v[s.key]) + 4, name: s.name });
  });
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  ends.forEach((e) => { el("text", { x: e.x, y: e.y, class: "ex-direct" }, svg).textContent = e.name; });

  // crosshair + tooltip
  const cross = el("line", { y1: M.t, y2: H - M.b, class: "ex-cross", visibility: "hidden" }, svg);
  const tip = document.createElement("div");
  tip.className = "ex-chart-tip";
  tip.hidden = true;
  wrap.appendChild(tip);
  const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }, svg);
  const show = (ev) => {
    const box = svg.getBoundingClientRect(), x = ((ev.clientX - box.left) / box.width) * W;
    let best = rows[0];
    rows.forEach((r) => { if (Math.abs(X(r.date) - x) < Math.abs(X(best.date) - x)) best = r; });
    const cx = X(best.date);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${day(best.date)} ${best.date.getUTCFullYear()}</b>${best.cycle != null ? ` · cycle ${best.cycle}` : ""}` +
      series.map((s) => `<span><i style="background:${s.color}"></i>${s.name} ${best.v[s.key] == null ? "–" : Math.round(best.v[s.key]) + unit}</span>`).join("");
    tip.hidden = false;
    const left = (cx / W) * box.width;
    tip.style.left = `${Math.min(Math.max(left, 70), box.width - 70)}px`;
  };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });

  // table view
  const det = document.createElement("details");
  det.className = "ex-chart-table";
  det.innerHTML = `<summary>Table</summary><table><thead><tr><th>Date</th><th>Cycle</th>${series.map((s) => `<th>${s.name}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${r.date.toISOString().slice(0, 10)}</td><td>${r.cycle ?? ""}</td>${series.map((s) => `<td>${r.v[s.key] == null ? "–" : Math.round(r.v[s.key])}</td>`).join("")}</tr>`).join("") +
    "</tbody></table>";
  host.appendChild(det);
}
