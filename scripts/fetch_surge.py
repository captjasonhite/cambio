#!/usr/bin/env python3
"""Tide fits for the Banderas Bay water-level tile.

Harmonic tide fit (8 diurnal/semidiurnal, 2 shallow-water, 2 seasonal
constituents) for the IOC tide gauges at Puerto Vallarta and Manzanillo, from
~365 days of their own 1-min data. The page fetches the latest gauge readings
itself (IOC allows CORS) and subtracts this fit: what's left is the non-tide
part of sea level (coastal/Kelvin waves, low pressure, surge).
Refit at most once a day; reused from the previous output otherwise.

Also: the nearest NHC storm's forecast track and when it passes closest to
Banderas Bay (marked on the graph).

Usage: fetch_surge.py <data_dir>   -> <data_dir>/surge.json and surge.js
"""
import datetime as dt
import json
import math
import os
import re
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


BAY = (20.68, -105.40)  # middle of Banderas Bay (approx.)
# where to measure the storm's closest pass for each gauge's graph
NEAR = {"puert": BAY, "mnza": (19.06, -104.30)}  # Manzanillo gauge


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    c = math.sin(la1) * math.sin(la2) + math.cos(la1) * math.cos(la2) * math.cos(lo1 - lo2)
    return 6371 * math.acos(max(-1, min(1, c)))


def storm():
    """Nearest active NHC east/central Pacific storm: forecast track and its
    closest approach to Banderas Bay (linear between the 12-h forecast points).
    NHC sends no CORS header, so the page can't fetch this itself."""
    cur = json.loads(get("https://www.nhc.noaa.gov/CurrentStorms.json", 30))
    best = None
    for s in cur.get("activeStorms", []):
        if not s["id"].startswith(("ep", "cp")):
            continue
        d = km(BAY, (s["latitudeNumeric"], s["longitudeNumeric"]))
        if d < 1500 and (best is None or d < best[0]):
            best = (d, s)
    if not best:
        return None
    s = best[1]
    url = (s.get("forecastAdvisory") or {}).get("url")
    t = re.sub(r"<[^>]+>", "", get(url, 30))
    adv = re.search(r"FORECAST/ADVISORY NUMBER\s+(\w+)", t)
    now = dt.datetime.now(dt.timezone.utc)

    def when(day, hhmm):
        d = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if int(day) > now.day + 7:  # previous month
            d = (d - dt.timedelta(days=1)).replace(day=1)
        elif int(day) < now.day - 7:  # next month
            d = (d + dt.timedelta(days=32)).replace(day=1)
        return d.replace(day=int(day), hour=int(hhmm[:2]), minute=int(hhmm[2:]))

    def ll(lat, lon):
        return float(lat[:-1]) * (1 if lat[-1] == "N" else -1), float(lon[:-1]) * (-1 if lon[-1] == "W" else 1)

    track = []
    m = re.search(r"CENTER LOCATED NEAR\s+([\d.]+[NS])\s+([\d.]+[EW])\s+AT\s+(\d\d)/(\d{4})Z", t)
    if m:
        track.append((when(m.group(3), m.group(4)), *ll(m.group(1), m.group(2))))
    for m in re.finditer(r"(?:FORECAST|OUTLOOK) VALID\s+(\d\d)/(\d{4})Z\s+([\d.]+[NS])\s+([\d.]+[EW])", t):
        track.append((when(m.group(1), m.group(2)), *ll(m.group(3), m.group(4))))
    if len(track) < 2:
        return None

    def closest(pt):
        best = None
        for (t0, la0, lo0), (t1, la1, lo1) in zip(track, track[1:]):
            for i in range(61):
                f = i / 60
                d = km(pt, (la0 + (la1 - la0) * f, lo0 + (lo1 - lo0) * f))
                if best is None or d < best[0]:
                    best = (d, t0 + (t1 - t0) * f)
        return {"t": best[1].isoformat(timespec="minutes"), "km": round(best[0])}
    return {
        "name": s["name"], "class": s["classification"], "advisory": adv.group(1) if adv else None,
        "updated": s["lastUpdate"],
        "track": [{"t": a.isoformat(), "lat": b, "lon": c} for a, b, c in track],
        "closest": closest(BAY),
        "closest_by": {code: closest(pt) for code, pt in NEAR.items()},
    }



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
    try:
        st = storm()
    except Exception as e:  # keep the last good track
        print(f"nhc: {e}", file=sys.stderr)
        st = prev.get("storm")
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fit_at": fit_at,
        "speeds": SPEEDS,
        "gauges": gauges,
        "storm": st,
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
    print(f"surge: {g}; storm: {st and (st['name'], st['closest'])}")


if __name__ == "__main__":
    main()
