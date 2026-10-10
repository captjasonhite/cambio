// Water level tile for Bahía de Banderas: tide gauges vs their normal tide
// and an outlook for the next high tides.
// Shared by the PV dashboard and cambio. Needs Chart.js and window.SURGE_DATA
// (tide fits written by scripts/fetch_surge.py).
//   WaterLevel.render(rootEl, { ctrlEl })  -> fetches live gauge data and draws the tile
//   (with ctrlEl the caller supplies the header and the PV/Manz + ft/m toggles go there)
(() => {
  const IOC = "https://www.ioc-sealevelmonitoring.org/service.php";
  const BUC = { lat: 20.756, lon: -105.334 };
  const GAUGES = { puert: { short: "PV", color: "#22d3ee" }, mnza: { short: "Manz", color: "#fbbf24" } };
  const H = 3600e3, M_FT = 3.28084, CM_IN = 0.393701;

  const css = document.createElement("style");
  css.textContent = `
  .wl { display: flex; flex-direction: column; gap: 10px; min-width: 0; width: 100%; }
  .wl-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .wl-head h2 { font-size: 0.85rem; font-weight: 600; }
  .wl-sub { color: var(--muted); font-size: 0.72rem; margin-top: 2px; }
  .wl-badge { font-size: 0.72rem; font-weight: 700; padding: 4px 9px; border-radius: 999px; white-space: nowrap; margin-left: auto; align-self: center; }
  .wl-badge.red   { color: var(--red);   background: rgba(248, 113, 113, 0.14); }
  .wl-badge.amber { color: var(--amber); background: rgba(251, 191, 36, 0.12); }
  .wl-badge.flat  { color: var(--muted); background: rgba(123, 134, 152, 0.12); }
  .wl-bar { display: flex; gap: 6px; flex: none; }
  .wl-tog { display: inline-flex; border: 1px solid #1e2530; border-radius: 10px; overflow: hidden; }
  .wl-tog button {
    background: transparent; color: var(--muted); border: none; padding: 7px 8px;
    font: inherit; font-size: 0.74rem; font-weight: 700; cursor: pointer; touch-action: manipulation;
  }
  .wl-tog button.on { background: #1a2230; color: var(--text); }
  .wl-now { display: flex; align-items: baseline; gap: 8px; }
  .wl-val { font-size: 2.1rem; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .wl-unit { color: var(--muted); font-size: 0.8rem; }
  .wl-mini { display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .wl-mini b { color: var(--text); font-weight: 600; }
  .wl-chart { position: relative; height: 190px; width: 100%; min-width: 0; overflow: hidden; }
  .wl table { width: 100%; border-collapse: collapse; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .wl th { color: var(--muted); font-weight: 600; text-align: right; padding: 3px 4px; font-size: 0.7rem; }
  .wl td { text-align: right; padding: 5px 4px; border-top: 1px solid #1c2330; }
  .wl th:first-child, .wl td:first-child { text-align: left; }
  .wl td.est { font-weight: 700; }
  .wl-note { color: var(--muted); font-size: 0.74rem; line-height: 1.45; }
  .wl .error { color: var(--red); font-size: 0.8rem; }
  `;
  document.head.appendChild(css);

  const pad = n => String(n).padStart(2, "0");
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const when = t => { const d = new Date(t); return DOW[d.getDay()] + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const pref = (k, ok, d) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const prefs = { gauge: pref("wl-gauge", ["puert", "mnza"], "puert"), unit: pref("wl-unit", ["m", "ft"], "m") };

  // offsets (m) as cm or inches; heights (m) as m or ft
  const off = v => { const n = Math.round(prefs.unit === "ft" ? v * 100 * CM_IN : v * 100); return (n >= 0 ? "+" : "−") + Math.abs(n); };
  const offU = () => (prefs.unit === "ft" ? "in" : "cm");
  const ht = v => (prefs.unit === "ft" ? (v * M_FT).toFixed(1) : v.toFixed(2));

  // harmonic tide for one gauge at epoch ms -> metres in gauge units
  function tideAt(g, speeds, ms) {
    const h = ms / H;
    let v = g.coef[0];
    speeds.forEach((w, i) => {
      const a = (w * Math.PI / 180) * (h - g.t0_h);
      v += g.coef[1 + 2 * i] * Math.cos(a) + g.coef[2 + 2 * i] * Math.sin(a);
    });
    return v;
  }

  async function getJSON(url, ms = 25000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" }); if (!r.ok) throw new Error(r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }

  // last 3 days of a gauge, 10-min means, with residual = observed - normal tide
  async function gauge(code, g, speeds) {
    const start = new Date(Date.now() - 3 * 24 * H).toISOString().slice(0, 16);
    const rows = await getJSON(`${IOC}?query=data&code=${code}&timestart=${start}&format=json`);
    const bins = {};
    for (const r of rows) {
      if (r.sensor !== "rad" || r.slevel == null) continue;
      const t = Date.parse(r.stime.replace(" ", "T") + "Z");
      const k = Math.floor(t / 600e3);
      (bins[k] = bins[k] || []).push(r.slevel);
    }
    const pts = Object.keys(bins).sort((a, b) => a - b).map(k => {
      const t = k * 600e3 + 300e3;
      const obs = bins[k].reduce((a, b) => a + b, 0) / bins[k].length;
      const pred = tideAt(g, speeds, t);
      return { t, obs: obs - g.mllw, pred: pred - g.mllw, res: obs - pred };
    }).filter(p => Math.abs(p.res) < 2); // sensor spikes
    if (!pts.length) throw new Error("no data");
    // 3 h running mean smooths seiches and sensor noise
    const WIN = 3 * H;
    const mean = (t1) => { const w = pts.filter(p => p.t > t1 - WIN && p.t <= t1); return w.length > 9 ? w.reduce((a, p) => a + p.res, 0) / w.length : null; };
    pts.forEach(p => { p.avg = mean(p.t); });
    const last = pts[pts.length - 1].t;
    // next 48 h of normal tide, same 10-min grid
    const future = [];
    for (let t = last + 600e3; t < Date.now() + 48 * H; t += 600e3) future.push({ t, pred: tideAt(g, speeds, t) - g.mllw });
    return { pts, future, last, now: pts[pts.length - 1].avg ?? pts[pts.length - 1].res };
  }

  // normal high tides (PV fit) in the next 48 h, metres above the fit's MLLW
  function highs(g, speeds) {
    const out = [];
    const step = 6 * 60e3, t0 = Date.now();
    let a = tideAt(g, speeds, t0 - step), b = tideAt(g, speeds, t0);
    for (let t = t0 + step; t < t0 + 48 * H; t += step) {
      const c = tideAt(g, speeds, t);
      if (b > a && b >= c) out.push({ t: t - step, tide: b - g.mllw });
      a = b; b = c;
    }
    return out;
  }

  // forecast pressure change at Bucerías (model), hPa below now at a given time
  async function pressureDrop() {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${BUC.lat}&longitude=${BUC.lon}&hourly=pressure_msl&forecast_days=3&timeformat=unixtime`);
    const t = j.hourly.time.map(s => s * 1000), p = j.hourly.pressure_msl;
    const near = ms => t.reduce((best, x, i) => (Math.abs(x - ms) < Math.abs(t[best] - ms) ? i : best), 0);
    const i0 = near(Date.now());
    return ms => p[i0] - p[near(ms)];
  }

  const state = new WeakMap(); // root -> { data, opts, chart }

  async function render(root, opts = {}) {
    const S = window.SURGE_DATA;
    if (!S?.gauges?.puert) { root.innerHTML = '<div class="wl"><span class="error">no tide fit — run scripts/fetch_surge.py</span></div>'; return; }
    const speeds = Object.values(S.speeds);
    const [puert, mnza, drop] = await Promise.all([
      gauge("puert", S.gauges.puert, speeds).catch(() => null),
      S.gauges.mnza ? gauge("mnza", S.gauges.mnza, speeds).catch(() => null) : null,
      pressureDrop().catch(() => () => 0),
    ]);
    const base = puert ? puert.now : 0;
    const up = Math.max(base, mnza ? mnza.now : base);
    const rows = highs(S.gauges.puert, speeds).slice(0, 4).map(h => {
      const ib = Math.max(-0.15, drop(h.t) / 100); // ~1 cm per hPa
      return { ...h, ib, lo: h.tide + base + ib, hi: h.tide + up + ib };
    });
    const st = state.get(root) || {};
    st.data = { gauges: { puert, mnza }, rows };
    st.opts = opts;
    state.set(root, st);
    draw(root);
  }

  function draw(root) {
    const st = state.get(root);
    const { gauges, rows } = st.data;
    const pv = gauges.puert;
    const sel = gauges[prefs.gauge] ? prefs.gauge : (pv ? "puert" : "mnza");
    const g = gauges[sel];
    const other = sel === "puert" ? "mnza" : "puert";

    let badge = '<span class="wl-badge flat">normal</span>';
    if (pv && pv.now >= 0.3) badge = '<span class="wl-badge red">HIGH WATER</span>';
    else if (pv && pv.now >= 0.15) badge = '<span class="wl-badge amber">ABOVE NORMAL</span>';
    const stale = g && Date.now() - g.last > 2 * H ? ` · <span class="error">gauge ${Math.round((Date.now() - g.last) / H)} h old</span>` : "";
    const top = Math.max(...rows.map(r => r.tide));
    const tog = (name, items, cur) => `<div class="wl-tog" data-k="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === cur ? "on" : ""}">${l}</button>`).join("")}</div>`;

    const bar = `<div class="wl-bar">${tog("gauge", [["puert", "PV"], ["mnza", "Manz"]], sel)}${tog("unit", [["ft", "ft"], ["m", "m"]], prefs.unit)}</div>`;
    if (st.opts.ctrlEl) st.opts.ctrlEl.innerHTML = bar;
    root.innerHTML = `<div class="wl">
      ${st.opts.ctrlEl ? "" : `<div class="wl-head"><h2>Water Level</h2>${bar}</div>`}
      <div class="wl-now"><span class="wl-val">${g ? off(g.now) : "—"}</span><span class="wl-unit">${offU()} above normal tide${stale}</span>${badge}</div>
      <div class="wl-mini">
        <span>${GAUGES[other].short} <b>${gauges[other] ? off(gauges[other].now) + " " + offU() : "offline"}</b></span>
        <span>low-pressure rise, 48 h <b>${rows.length ? off(Math.max(...rows.map(r => r.ib))) + " " + offU() : "—"}</b></span>
      </div>
      <div class="wl-chart"><canvas></canvas></div>
      <table>
        <tr><th>next highs (PV)</th><th>normal</th><th>est. still water</th></tr>
        ${rows.map(r => `<tr><td>${when(r.t)}</td><td>${ht(r.tide)}</td><td class="est" style="color:${r.hi - top >= 0.3 ? "var(--red)" : r.hi - top >= 0.15 ? "var(--amber)" : "var(--text)"}">${ht(r.lo) === ht(r.hi) ? ht(r.hi) : ht(r.lo) + "–" + ht(r.hi)} ${prefs.unit}</td></tr>`).join("")}
      </table>
      <p class="wl-note">Heights above low-water datum (from the PV gauge). Estimate = normal tide + PV now (low) or Manzanillo now (high, it led PV by ~1 day last time) + forecast pressure drop. No waves, wind setup or surge. A rough guide, not a forecast — follow SMN / Protección Civil.</p>
    </div>`;

    const togs = [...root.querySelectorAll(".wl-tog"), ...(st.opts.ctrlEl ? st.opts.ctrlEl.querySelectorAll(".wl-tog") : [])];
    togs.forEach(el => el.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      prefs[el.dataset.k] = b.dataset.v;
      save("wl-" + el.dataset.k, b.dataset.v);
      draw(root);
    }));

    if (st.chart) { st.chart.destroy(); st.chart = null; }
    if (!g || !window.Chart) return;
    // past 2 days measured vs normal tide, then 48 h ahead: normal tide and
    // normal + today's offset. The gap between the lines is the extra water.
    const k = prefs.unit === "ft" ? M_FT : 1;
    const r2 = v => (v == null ? null : Math.round(v * k * 100) / 100);
    const past = g.pts.filter(p => p.t > g.last - 48 * H);
    const all = [...past, ...g.future];
    const nowIdx = past.length - 1;
    // grid marks: midnight (day name) and noon, at the first 10-min bin of that hour
    const hr = i => new Date(all[i].t).getHours();
    const mark = i => (i > 0 && hr(i) !== hr(i - 1) && (hr(i) === 0 || hr(i) === 12) ? hr(i) : null);
    const color = GAUGES[sel].color;
    const nowLine = {
      id: "wlNow",
      afterDatasetsDraw(c) {
        const x = c.scales.x.getPixelForValue(nowIdx), { top, bottom } = c.chartArea, ctx = c.ctx;
        ctx.save(); ctx.strokeStyle = "#c9d1dc"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.fillStyle = "#e6ebf2"; ctx.font = "bold 10px sans-serif"; ctx.fillText("now", x + 3, top + 9); ctx.restore();
      },
    };
    st.chart = new Chart(root.querySelector("canvas").getContext("2d"), {
      type: "line",
      data: {
        labels: all.map(p => when(p.t)),
        datasets: [
          { label: "normal", data: all.map(p => r2(p.pred)), borderColor: "#7b8698", backgroundColor: "transparent", pointRadius: 0, borderWidth: 1.5, tension: 0.3 },
          { label: "measured", data: all.map(p => r2(p.obs)), borderColor: color, backgroundColor: color + "33", fill: "-1", pointRadius: 0, borderWidth: 2, tension: 0.3 },
          { label: "if it stays", data: all.map((p, i) => (i < nowIdx ? null : r2(p.pred + g.now))), borderColor: color, borderDash: [3, 3], backgroundColor: "transparent", pointRadius: 0, borderWidth: 1.5, tension: 0.3 },
        ],
      },
      plugins: [nowLine],
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, position: "top", align: "start", labels: { boxWidth: 14, boxHeight: 3, padding: 8, color: "#d5dbe4", font: { size: 11, weight: "600" } } },
          tooltip: { backgroundColor: "#1a2230", borderColor: "#2c3646", borderWidth: 1, titleColor: "#e6ebf2", bodyColor: "#e6ebf2", padding: 8,
            callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y} ${prefs.unit}` } },
        },
        scales: {
          x: {
            ticks: { color: "#aab3c0", autoSkip: false, maxRotation: 0, font: { size: 10 },
              callback: (v, i) => { const m = mark(i); return m === 0 ? DOW[new Date(all[i].t).getDay()] : m === 12 ? "12h" : null; } },
            grid: { color: c => (mark(c.index) === 0 ? "#3e4a5c" : "#252e3b"), drawTicks: false },
          },
          y: { title: { display: true, text: prefs.unit, color: "#aab3c0", font: { size: 10 } },
            ticks: { color: "#aab3c0", stepSize: prefs.unit === "ft" ? 1 : 0.5, font: { size: 10 } },
            grid: { color: c => (c.tick.value === 0 ? "#4a5770" : "#252e3b") } },
        },
      },
    });
  }

  window.WaterLevel = { render };
})();
