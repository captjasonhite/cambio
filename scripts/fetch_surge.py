#!/usr/bin/env python3
"""Tide fits for the Bucerías / Bahía de Banderas water-level tile.

Harmonic tide fit (8 diurnal/semidiurnal, 2 shallow-water, 2 seasonal
constituents) for the IOC tide gauges at Puerto Vallarta and Manzanillo, from
~365 days of their own 1-min data. The page fetches the latest gauge readings
itself (IOC allows CORS) and subtracts this fit: what's left is the non-tide
part of sea level (coastal/Kelvin waves, low pressure, surge).
Refit at most once a day; reused from the previous output otherwise.

Usage: fetch_surge.py <data_dir>   -> <data_dir>/surge.json and surge.js
"""
import datetime as dt
import json
import math
import os
import sys
import urllib.request

import numpy as np

UA = "Mozilla/5.0 (X11; Linux x86_64) cambio-surge/1.0"
IOC = "https://www.ioc-sealevelmonitoring.org/service.php"
GAUGES = [("puert", "Puerto Vallarta"), ("mnza", "Manzanillo")]
SENSOR = "rad"
FIT_DAYS, SKIP_DAYS, REFIT_H = 365, 4, 24
# degrees per hour
SPEEDS = {
    "M2": 28.9841042, "S2": 30.0, "N2": 28.4397295, "K2": 30.0821373,
    "K1": 15.0410686, "O1": 13.9430356, "P1": 14.9589314, "Q1": 13.3986609,
    "M4": 57.9682084, "MS4": 58.9841042,
    # annual + semiannual: "normal" means normal for the season (fall runs high),
    # and a full year separates S2/K2 and K1/P1 so no tide-shaped wobble is left
    "Sa": 0.0410686, "Ssa": 0.0821373,
}


def get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def ioc_hourly(code, start, stop):
    """Hourly means (UTC epoch hours -> m) from IOC 1-min data, fetched in 15-day chunks."""
    rows = []
    t = start
    while t < stop:
        t2 = min(t + dt.timedelta(days=15), stop)
        url = f"{IOC}?query=data&code={code}&timestart={t:%Y-%m-%dT%H:%M}&timestop={t2:%Y-%m-%dT%H:%M}&format=json"
        rows += json.loads(get(url))
        t = t2
    bins = {}
    for r in rows:
        if r.get("sensor") != SENSOR or r.get("slevel") is None:
            continue
        ts = dt.datetime.fromisoformat(r["stime"]).replace(tzinfo=dt.timezone.utc).timestamp()
        bins.setdefault(math.floor(ts / 3600), []).append(r["slevel"])
    h = np.array(sorted(bins), dtype=float)
    y = np.array([np.mean(bins[k]) for k in sorted(bins)])
    good = np.abs(y - np.median(y)) < 3  # drop sensor spikes
    return h[good], y[good]


def design(hours, t0):
    cols = [np.ones_like(hours)]
    for w in SPEEDS.values():
        a = np.radians(w) * (hours - t0)
        cols += [np.cos(a), np.sin(a)]
    return np.column_stack(cols)


def fit_gauge(code):
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    h, y = ioc_hourly(code, now - dt.timedelta(days=FIT_DAYS), now)
    m = h < (now.timestamp() / 3600 - SKIP_DAYS * 24)  # keep the current event out of the baseline
    t0 = float(h[0])
    coef, *_ = np.linalg.lstsq(design(h[m], t0), y[m], rcond=None)
    rms = float(np.std(y[m] - design(h[m], t0) @ coef))
    # MLLW-like datum: mean of the lower low water of each 24.84 h tidal day
    fine = np.arange(h[m][0], h[m][-1], 0.1)
    p = design(fine, t0) @ coef
    day = 24.84
    lows = [p[(fine >= a) & (fine < a + day)].min() for a in np.arange(fine[0], fine[-1] - day, day)]
    return {
        "t0_h": t0, "coef": [round(float(c), 5) for c in coef], "rms_m": round(rms, 3),
        "mllw": round(float(np.mean(lows)), 4), "hours": int(m.sum()),
    }


def tides(prev):
    fit_at = prev.get("fit_at")
    fresh = fit_at and (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(fit_at)).total_seconds() < REFIT_H * 3600
    if fresh and all(c in prev.get("gauges", {}) for c, _ in GAUGES):
        return prev["gauges"], fit_at
    out = {}
    for code, name in GAUGES:
        try:
            out[code] = {"name": name, **fit_gauge(code)}
        except Exception as e:  # keep the previous fit for this gauge
            print(f"fit {code} failed: {e}", file=sys.stderr)
            if code in prev.get("gauges", {}):
                out[code] = prev["gauges"][code]
    return out, dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def main():
    data_dir = sys.argv[1] if len(sys.argv) > 1 else "data"
    path = os.path.join(data_dir, "surge.json")
    prev = {}
    if os.path.exists(path):
        try:
            prev = json.load(open(path))
        except Exception:
            prev = {}
    gauges, fit_at = tides(prev)
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fit_at": fit_at,
        "speeds": SPEEDS,
        "gauges": gauges,
    }
    # unchanged content keeps its timestamp, so the Actions job only commits real updates
    if {k: v for k, v in prev.items() if k != "generated_at"} == {k: v for k, v in json.loads(json.dumps(payload)).items() if k != "generated_at"}:
        payload["generated_at"] = prev.get("generated_at", payload["generated_at"])
    os.makedirs(data_dir, exist_ok=True)
    with open(path, "w") as f:
        json.dump(payload, f, indent=1)
    with open(os.path.join(data_dir, "surge.js"), "w") as f:
        f.write("// Auto-generated by scripts/fetch_surge.py - do not edit.\n")
        f.write("window.SURGE_DATA = " + json.dumps(payload) + ";\n")
    g = ", ".join(f"{c} rms {v['rms_m']} m" for c, v in gauges.items())
    print(f"surge: {g}")


if __name__ == "__main__":
    main()
