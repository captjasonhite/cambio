#!/usr/bin/env python3
"""Make one QR code (SVG) per page in icons/qr/. Rerun after adding a page."""
from pathlib import Path
import qrcode
import qrcode.image.svg

BASE = "https://cambio.jasonhite.com/"
PAGES = ["index", "usd", "cad", "usdcad", "gas", "units", "surge"]
out = Path(__file__).resolve().parent.parent / "icons" / "qr"
out.mkdir(parents=True, exist_ok=True)

for page in PAGES:
    url = BASE if page == "index" else f"{BASE}{page}.html"
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2,
                       image_factory=qrcode.image.svg.SvgPathFillImage)
    qr.add_data(url)
    qr.make(fit=True)
    qr.make_image().save(out / f"{page}.svg")
    print(page, url)
