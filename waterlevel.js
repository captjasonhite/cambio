// Water level tile for Bahía de Banderas: tide gauges vs their normal tide
// and an outlook for the next high tides.
// Shared by the PV dashboard and cambio. Needs Chart.js and window.SURGE_DATA
// (tide fits written by scripts/fetch_surge.py).
//   WaterLevel.render(rootEl, { ctrlEl })  -> fetches live gauge data and draws the tile
//   (with ctrlEl the caller supplies the header and the PV/Manz/LPZ + ft/m toggles go there)
(() => {
  const IOC = "https://www.ioc-sealevelmonitoring.org/service.php";
  const BAY = { lat: 20.68, lon: -105.40 }; // middle of Banderas Bay (approx.)
  const PLACE = { puert: { name: "Banderas Bay", lat: BAY.lat, lon: BAY.lon }, mnza: { name: "Manzanillo", lat: 19.06, lon: -104.30 }, lpaz2: { name: "La Paz", lat: 24.27, lon: -110.33 } };
  const GAUGES = { puert: { short: "PV", color: "#22d3ee" }, mnza: { short: "Manz", color: "#fbbf24" }, lpaz2: { short: "LPZ", color: "#a78bfa" } };
  const H = 3600e3, M_FT = 3.28084, CM_IN = 0.393701;

  const css = document.createElement("style");
  css.textContent = `
  .wl { display: flex; flex-direction: column; gap: 10px; min-width: 0; width: 100%; }
  .wl-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .wl-head h2 { font-size: 0.85rem; font-weight: 600; }
  .wl-exp { display: inline-block; vertical-align: middle; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.06em; color: var(--amber); border: 1px solid var(--amber); border-radius: 6px; padding: 1px 5px; margin-left: 4px; }
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
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const when = t => { const d = new Date(t); return DOW[d.getDay()] + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const pref = (k, ok, d) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const prefs = { gauge: pref("wl-gauge", ["puert", "mnza", "lpaz2"], "puert"), unit: pref("wl-unit", ["m", "ft"], "m") };

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
    const now = pts[pts.length - 1].avg ?? pts[pts.length - 1].res;
    // trend: smoothed extra water now vs 3 h ago (null if the gauge has a gap there)
    const then = pts.filter(p => p.avg != null && Math.abs(p.t - (last - 3 * H)) <= 20 * 60e3).pop();
    const trend = then ? now - then.avg : null;
    // next 48 h of normal tide, same 10-min grid
    const future = [];
    for (let t = last + 600e3; t < Date.now() + 48 * H; t += 600e3) future.push({ t, pred: tideAt(g, speeds, t) - g.mllw });
    // trending extra water: continue the last 24 h change (steadier than 3 h:
    // whole tide cycles), fading over ~a day, capped at ±30 cm beyond now.
    // An extrapolation, not a model; flat if the gauge has a gap 24 h back.
    const day = pts.filter(p => p.avg != null && Math.abs(p.t - (last - 24 * H)) <= 30 * 60e3).pop();
    const trend24 = day ? now - day.avg : 0;
    const extra = t => now + Math.max(-0.3, Math.min(0.3, trend24 * (1 - Math.exp(-Math.max(0, t - last) / (24 * H)))));
    return { pts, future, last, now, trend, trend24, extra, predAt: t => tideAt(g, speeds, t) - g.mllw };
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

  // forecast pressure change at a place (model), hPa below now at a given time
  async function pressureDrop(pl) {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${pl.lat}&longitude=${pl.lon}&hourly=pressure_msl&forecast_days=3&timeformat=unixtime`);
    const t = j.hourly.time.map(s => s * 1000), p = j.hourly.pressure_msl;
    const near = ms => t.reduce((best, x, i) => (Math.abs(x - ms) < Math.abs(t[best] - ms) ? i : best), 0);
    const i0 = near(Date.now());
    return ms => p[i0] - p[near(ms)];
  }

  // NHC storm's closest pass to a gauge's area: follows the forecast while the
  // storm approaches, then fetch_surge.py freezes it so it scrolls off the graph.
  // Dropped once it's older than the graph's 48 h of history.
  const approach = code => {
    const s = window.SURGE_DATA?.storm, c = s?.closest_by?.[code];
    return c && Date.parse(c.t) > Date.now() - 48 * H ? c : null;
  };

  const state = new WeakMap(); // root -> { data, opts, chart }

  async function render(root, opts = {}) {
    const S = window.SURGE_DATA;
    if (!S?.gauges?.puert) { root.innerHTML = '<div class="wl"><span class="error">no tide fit — run scripts/fetch_surge.py</span></div>'; return; }
    const speeds = Object.values(S.speeds);
    const [puert, mnza, lpaz2, dropBay, dropMz, dropLp] = await Promise.all([
      gauge("puert", S.gauges.puert, speeds).catch(() => null),
      S.gauges.mnza ? gauge("mnza", S.gauges.mnza, speeds).catch(() => null) : null,
      S.gauges.lpaz2 ? gauge("lpaz2", S.gauges.lpaz2, speeds).catch(() => null) : null,
      pressureDrop(PLACE.puert).catch(() => () => 0),
      pressureDrop(PLACE.mnza).catch(() => () => 0),
      pressureDrop(PLACE.lpaz2).catch(() => () => 0),
    ]);
    // next highs + the storm's closest pass, per gauge, in that gauge's own datum.
    // PV's upper estimate uses Manzanillo's offset too (it led PV by ~1 day last time).
    const table = (code, g, drop, lo, hi) => {
      const fit = S.gauges[code];
      if (!fit || !g) return [];
      const marks = highs(fit, speeds).slice(0, 4);
      const c = approach(code);
      const sT = c ? Date.parse(c.t) : NaN;
      if (sT > Date.now() && sT < Date.now() + 48 * H) marks.push({ t: sT, tide: tideAt(fit, speeds, sT) - fit.mllw, storm: S.storm.name, km: c.km });
      marks.sort((a, b) => a.t - b.t);
      return marks.map(h => {
        const ib = Math.max(-0.15, drop(h.t) / 100); // ~1 cm per hPa
        const a = lo(h.t), b = hi(h.t);
        return { ...h, ib, lo: h.tide + a + ib, hi: h.tide + b + ib };
      });
    };
    // each gauge's trending extra water at time t (0 if the gauge is down)
    const ex = g => t => (g ? g.extra(t) : 0);
    const rows = {
      puert: table("puert", puert, dropBay, ex(puert), t => Math.max(ex(puert)(t), mnza ? mnza.extra(t) : ex(puert)(t))),
      mnza: table("mnza", mnza, dropMz, ex(mnza), ex(mnza)),
      lpaz2: table("lpaz2", lpaz2, dropLp, ex(lpaz2), ex(lpaz2)),
    };
    const st = state.get(root) || {};
    st.data = { gauges: { puert, mnza, lpaz2 }, rows };
    st.opts = opts;
    state.set(root, st);
    draw(root);
  }

  function draw(root) {
    const st = state.get(root);
    const { gauges } = st.data;
    const pv = gauges.puert;
    const sel = gauges[prefs.gauge] ? prefs.gauge : (pv ? "puert" : gauges.mnza ? "mnza" : "lpaz2");
    const rows = st.data.rows[sel];
    const g = gauges[sel];

    let badge = '<span class="wl-badge flat">on forecast</span>';
    if (g && g.now >= 0.3) badge = '<span class="wl-badge red">HIGH WATER</span>';
    else if (g && g.now >= 0.15) badge = '<span class="wl-badge amber">ABOVE FORECAST</span>';
    // rising/falling over the last 3 h; under ~1 cm is noise
    const tr = g?.trend == null ? "" : Math.abs(g.trend) < 0.01 ? ` · <span>steady over 3 h</span>`
      : ` · <span style="color:${g.trend > 0 ? (g.trend >= 0.05 ? "var(--red)" : "var(--amber)") : "var(--green, #4ade80)"}; font-weight:700">${g.trend > 0 ? "▲ rising" : "▼ falling"} ${off(g.trend)} ${offU()} in 3 h</span>`;
    const stale = g && Date.now() - g.last > 2 * H ? ` · <span class="error">gauge ${Math.round((Date.now() - g.last) / H)} h old</span>` : "";
    const top = Math.max(...rows.filter(r => !r.storm).map(r => r.tide));
    const tog = (name, items, cur) => `<div class="wl-tog" data-k="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === cur ? "on" : ""}">${l}</button>`).join("")}</div>`;

    const bar = `<div class="wl-bar">${tog("gauge", [["puert", "PV"], ["mnza", "Manz"], ["lpaz2", "LPZ"]], sel)}${tog("unit", [["ft", "ft"], ["m", "m"]], prefs.unit)}</div>`;
    if (st.opts.ctrlEl) st.opts.ctrlEl.innerHTML = bar;
    root.innerHTML = `<div class="wl">
      ${st.opts.ctrlEl ? "" : `<div class="wl-head"><h2>Tide Actual vs Forecast <span class="wl-exp">EXPERIMENTAL</span></h2>${bar}</div>`}
      <div class="wl-now"><span class="wl-val">${g ? off(g.now) : "—"}</span><span class="wl-unit">${offU()} above forecast at ${GAUGES[sel].short}${tr}${stale}</span>${badge}</div>
      <div class="wl-chart"><canvas></canvas></div>
      <table>
        <tr><th>next highs (${GAUGES[sel].short})</th><th>forecast</th><th>estimated</th></tr>
        ${rows.map(r => `<tr${r.storm ? ' style="color:var(--red); font-weight:700"' : ""}><td>${when(r.t)}${r.storm ? ` 🌀 ${esc(r.storm)} ${r.km < 5 ? "arrival" : `closest ~${Math.round(r.km / 1.852)} nm`}` : ""}</td><td>${ht(r.tide)}</td><td class="est" style="color:${r.storm || r.hi - top >= 0.3 ? "var(--red)" : r.hi - top >= 0.15 ? "var(--amber)" : "var(--text)"}">${ht(r.lo) === ht(r.hi) ? ht(r.hi) : ht(r.lo) + "–" + ht(r.hi)} ${prefs.unit}</td></tr>`).join("")}
      </table>
      ${(() => { const s = window.SURGE_DATA.storm, c = approach(sel), pl = PLACE[sel].name; return c ? `<p class="wl-note" style="color:var(--text)">🌀 NHC forecast (adv ${s.advisory}): ${Date.parse(c.t) <= Date.now() ? `${s.name} passed closest to ${pl}${c.km < 5 ? "" : ` (~${Math.round(c.km / 1.852)} nm)`} ~<b>${when(Date.parse(c.t))}</b> per the last forecast before it turned away — red line on the graph.` : `${s.name} ${c.km < 5 ? `is over ${pl}` : `passes closest to ${pl}`} ~<b>${when(Date.parse(c.t))}</b>${c.km < 5 ? "" : `, ~${Math.round(c.km / 1.852)} nm away`}${Date.parse(c.t) < Date.now() + 48 * H ? " — red line on the graph" : " (on the graph once within 48 h)"}. Track error at 1–2 days is tens of nm.`}</p>` : ""; })()}
      <p class="wl-note">Heights above low-water datum (from the ${{ puert: "PV", mnza: "Manzanillo", lpaz2: "La Paz (Pichilingue)" }[sel]} gauge). Estimate = forecast tide + ${sel === "puert" ? "PV's extra water, trending (low) or Manzanillo's (high, it led PV by ~1 day last time)" : `${{ mnza: "Manzanillo", lpaz2: "La Paz" }[sel]}'s extra water, trending`} + forecast pressure drop. Trending = the last 24 h change carried on and fading over ~a day (max ±30 cm more): an extrapolation, not a forecast. No waves, wind setup or surge. A rough guide, not a forecast — follow SMN / Protección Civil.</p>
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
    // even 10-min grid (gauge gaps stay empty) so spacing on the axis is real time
    const obs = new Map(g.pts.map(p => [p.t, p.obs]));
    const all = [];
    for (let t = g.last - 48 * H; t <= g.future[g.future.length - 1].t; t += 600e3) all.push({ t, obs: obs.get(t) ?? null, pred: g.predAt(t) });
    const nowIdx = all.findIndex(p => p.t >= g.last);
    // gauge gaps (PV sends nothing ~18:00–23:30 local most days): normal tide +
    // the extra water interpolated between the readings either side, up to 8 h
    const avg = new Map(g.pts.map(p => [p.t, p.avg ?? p.res]));
    const est = all.map(() => null);
    let a = -1;
    all.forEach((p, i) => {
      if (p.obs == null || i > nowIdx) return;
      if (a >= 0 && i - a > 1 && i - a <= 48) {
        const r0 = avg.get(all[a].t), r1 = avg.get(p.t);
        for (let j = a; j <= i; j++) est[j] = all[j].pred + r0 + (r1 - r0) * (j - a) / (i - a);
      }
      a = i;
    });
    // grid marks: midnight (day name) and noon, at the first 10-min bin of that hour
    const hr = i => new Date(all[i].t).getHours();
    const mark = i => (i > 0 && hr(i) !== hr(i - 1) && (hr(i) === 0 || hr(i) === 12) ? hr(i) : null);
    const color = GAUGES[sel].color;
    // NHC forecast: when the storm passes closest to the selected gauge's area
    const sc = approach(sel);
    const sT = sc ? Date.parse(sc.t) : NaN;
    const stormIdx = sT > all[0].t && sT < all[all.length - 1].t ? all.findIndex(p => p.t >= sT) : -1;
    const vline = (c, i, color, text, row) => {
      const x = c.scales.x.getPixelForValue(i), { top, bottom, right } = c.chartArea, ctx = c.ctx;
      ctx.save(); ctx.strokeStyle = color; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillStyle = color; ctx.font = "bold 10px sans-serif";
      const w = ctx.measureText(text).width;
      ctx.fillText(text, x + 3 + w > right ? x - 3 - w : x + 3, top + 10 + row * 12); ctx.restore();
    };
    const nowLine = {
      id: "wlNow",
      afterDatasetsDraw(c) {
        vline(c, nowIdx, "#e6ebf2", "now", 0);
        if (stormIdx >= 0) vline(c, stormIdx, "#f87171", sc.km < 5 ? window.SURGE_DATA.storm.name : `${window.SURGE_DATA.storm.name} ~${Math.round(sc.km / 1.852)} nm`, 1);
      },
    };
    st.chart = new Chart(root.querySelector("canvas").getContext("2d"), {
      type: "line",
      data: {
        labels: all.map(p => when(p.t)),
        datasets: [
          { label: "forecast", data: all.map(p => r2(p.pred)), borderColor: "#7b8698", backgroundColor: "transparent", pointRadius: 0, borderWidth: 1.5, tension: 0.3 },
          { label: "measured", data: all.map(p => r2(p.obs)), borderColor: color, backgroundColor: color + "33", fill: "-1", pointRadius: 0, borderWidth: 2, tension: 0.3 },
          { label: "gauge gap (est.)", data: est.map(r2), borderColor: color + "99", borderDash: [1, 3], backgroundColor: "transparent", pointRadius: 0, borderWidth: 2, tension: 0.3, spanGaps: false },
          { label: "trending", data: all.map((p, i) => (i < nowIdx ? null : r2(p.pred + g.extra(p.t)))), borderColor: color, borderDash: [3, 3], backgroundColor: "transparent", pointRadius: 0, borderWidth: 1.5, tension: 0.3 },
        ],
      },
      plugins: [nowLine],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, position: "top", align: "start", labels: { filter: (it, d) => d.datasets[it.datasetIndex].data.some(v => v != null), boxWidth: 14, boxHeight: 3, padding: 8, color: "#d5dbe4", font: { size: 11, weight: "600" } } },
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
