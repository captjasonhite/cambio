#!/usr/bin/env python3
"""Fetch today's CRE gas prices for every station in Mexico.

Source: official CRE (Comision Reguladora de Energia) public feed, mirrored
on Azure:
  https://publicacionexterna.azurewebsites.net/publicaciones/places
  https://publicacionexterna.azurewebsites.net/publicaciones/prices

Writes data/gas.json, loaded by gas.html:
  {"t": <unix ms>, "date": "YYYY-MM-DD",
   "s": [[lat, lon, regular, premium, diesel], ...]}   (null = not sold)
gas.html averages the stations near the user (Puerto Vallarta by default).

Run daily by .github/workflows/gas.yml.
"""
import json
import os
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data", "gas.json")
FEED = "https://publicacionexterna.azurewebsites.net/publicaciones/"
UA = {"User-Agent": "Mozilla/5.0 (cambio.jasonhite.com gas prices)"}
TYPES = ("regular", "premium", "diesel")


def get(name: str) -> ET.Element:
    req = urllib.request.Request(FEED + name, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        return ET.fromstring(r.read())


def main() -> None:
    places, prices = get("places"), get("prices")

    loc = {}
    for p in places.findall("place"):
        try:
            lat = float(p.findtext("location/y"))
            lon = float(p.findtext("location/x"))
        except (TypeError, ValueError):
            continue
        # drop junk coordinates outside Mexico's bounding box
        if 14 <= lat <= 33 and -119 <= lon <= -86:
            loc[p.get("place_id")] = (round(lat, 3), round(lon, 3))

    stations = []
    for p in prices.findall("place"):
        ll = loc.get(p.get("place_id"))
        if not ll:
            continue
        got = {}
        for g in p.findall("gas_price"):
            try:
                v = float(g.text)
            except (TypeError, ValueError):
                continue
            if g.get("type") in TYPES and 5 < v < 60:  # skip obvious typos
                got[g.get("type")] = round(v, 2)
        if got:
            stations.append([*ll, *(got.get(t) for t in TYPES)])

    # an empty or tiny result means the feed broke - keep yesterday's file
    if len(stations) < 1000:
        raise SystemExit(f"only {len(stations)} priced stations - not writing")

    now = datetime.now(timezone.utc)
    out = {
        "t": int(now.timestamp() * 1000),
        "date": (now - timedelta(hours=6)).strftime("%Y-%m-%d"),  # CDMX, UTC-6
        "s": stations,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    os.replace(tmp, OUT)
    print(f"{out['date']}: {len(stations)} priced stations")


if __name__ == "__main__":
    main()
