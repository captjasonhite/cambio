// Hamburger menu, "add to home screen" help and Share popup, shared by all pages.
// Each page supplies its own <button id="menu-btn"> where it wants it; any
// element with id="share-btn" also opens the Share popup.
// QR images live in icons/qr/ (make them with scripts/make_qr.py).
(() => {
  const PAGES = [
    ["index.html",  "🏠 Home"],
    ["usd.html",    "🇺🇸 USA <> MXN 🇲🇽"],
    ["cad.html",    "🇨🇦 CAD <> MXN 🇲🇽"],
    ["usdcad.html", "🇺🇸 USA <> CAD 🇨🇦"],
    ["gas.html",    "⛽ Fuel Prices/Calc"],
    ["units.html",  "📏 Convert Units 🌡️"],
    ["surge.html",  "🌊 Tide Actual vs Forecast"],
  ];
  const here = location.pathname.split("/").pop() || "index.html";

  const css = document.createElement("style");
  css.textContent = `
  #menu-btn {
    flex: none; width: 44px; height: 38px; font-size: 1.2rem; line-height: 1; font-family: inherit;
    background: #1a2230; color: var(--text); border: 1px solid #33415a; border-radius: 12px;
    cursor: pointer; touch-action: manipulation;
  }
  .ranges #menu-btn { height: auto; border-radius: 10px; }
  .nav-veil {
    position: fixed; inset: 0; z-index: 200; background: rgba(5, 8, 12, 0.6);
    display: flex; justify-content: flex-end; align-items: flex-start;
    padding: calc(12px + env(safe-area-inset-top, 0px)) 14px 14px;
  }
  .nav-veil[hidden] { display: none; }
  .nav-veil.center { justify-content: center; align-items: center; }
  .nav-box {
    background: #12161e; border: 1px solid #33415a; border-radius: 16px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); color: var(--text);
  }
  .nav-menu { width: 250px; max-width: 100%; padding: 6px; display: flex; flex-direction: column; }
  .nav-menu a, .nav-menu button {
    display: block; width: 100%; text-align: left; padding: 13px 12px; border-radius: 10px;
    color: var(--text); text-decoration: none; font: inherit; font-size: 0.95rem; font-weight: 600;
    background: none; border: none; cursor: pointer; touch-action: manipulation;
  }
  .nav-menu a:active, .nav-menu button:active { background: #1a2230; }
  .nav-menu a.here { background: #1a2230; color: var(--cyan); }
  .nav-menu hr { border: none; border-top: 1px solid #1e2530; margin: 4px 6px; }
  .nav-help {
    width: calc(100% - 12px); max-width: 420px; max-height: 100%; overflow-y: auto;
    padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 0.92rem; line-height: 1.45;
  }
  .nav-help-head { display: flex; justify-content: space-between; align-items: center; }
  .nav-help-head span { font-weight: 700; font-size: 1rem; }
  .nav-help-head button { background: none; border: none; color: var(--muted); font-size: 1.5rem; cursor: pointer; padding: 0 6px; line-height: 1; }
  .nav-help h3 { font-size: 0.95rem; }
  .nav-help ol { padding-left: 22px; display: flex; flex-direction: column; gap: 4px; }
  .nav-help p { color: var(--muted); }
  .nav-share { align-items: center; text-align: center; }
  .nav-share .nav-help-head { width: 100%; }
  .nav-share img { width: 220px; height: 220px; max-width: 100%; border-radius: 10px; background: #fff; image-rendering: pixelated; }
  .nav-share-url { color: var(--cyan); font-size: 0.85rem; word-break: break-all; }
  .nav-share-btns { display: flex; gap: 8px; width: 100%; }
  .nav-share-btns button {
    flex: 1; padding: 12px; border-radius: 12px; font: inherit; font-weight: 700; font-size: 0.95rem;
    background: #1a2230; color: var(--text); border: 1px solid #33415a; cursor: pointer; touch-action: manipulation;
  }
  .nav-share-btns button:active { border-color: var(--cyan); }
  .nav-share-btns button[hidden] { display: none; }
  `;
  document.head.appendChild(css);

  const menu = document.createElement("div");
  menu.className = "nav-veil";
  menu.hidden = true;
  menu.innerHTML = `<nav class="nav-box nav-menu">
    ${PAGES.map(([href, label]) =>
      `<a href="${href}" data-track="menu_${href.replace(".html", "")}"${href === here ? ' class="here"' : ""}></a>`).join("")}
    <hr>
    <button type="button" id="nav-share-open" data-track="menu_share">📤 Share this page</button>
    <button type="button" id="nav-help-open" data-track="menu_help">❓ Add to home screen</button>
  </nav>`;
  menu.querySelectorAll("a").forEach((a, i) => { a.textContent = PAGES[i][1]; });

  const help = document.createElement("div");
  help.className = "nav-veil center";
  help.hidden = true;
  help.innerHTML = `<div class="nav-box nav-help" role="dialog" aria-label="Add to home screen">
    <div class="nav-help-head"><span>📲 Add to home screen</span><button type="button" title="Close">×</button></div>
    <p>Open this screen in your phone's browser, then add it to your home screen. It gets its own icon and opens full-screen like an app.</p>
    <h3>iPhone / iPad (Safari)</h3>
    <ol>
      <li>Tap the <b>Share</b> button (square with an up arrow). If you don't see it, tap <b>⋯</b> first.</li>
      <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
      <li>Tap <b>Add</b>.</li>
    </ol>
    <h3>Android (Chrome)</h3>
    <ol>
      <li>Tap the <b>⋮</b> menu (top right).</li>
      <li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>
      <li>Tap <b>Install</b> / <b>Add</b>.</li>
    </ol>
    <p>Each screen installs on its own, so add the ones you use most — the icon opens straight to that screen.</p>
  </div>`;

  // Share the public address of this page, even when testing locally.
  const page = here.replace(".html", "");
  const canon = document.querySelector('link[rel="canonical"]');
  const shareUrl = canon ? canon.href : location.href;
  const share = document.createElement("div");
  share.className = "nav-veil center";
  share.hidden = true;
  share.innerHTML = `<div class="nav-box nav-help nav-share" role="dialog" aria-label="Share">
    <div class="nav-help-head"><span>📤 Share</span><button type="button" title="Close">×</button></div>
    <p>Have a friend scan this with their phone camera, or send them the link.</p>
    <img src="icons/qr/${page}.svg" alt="QR code for this page" width="220" height="220">
    <div class="nav-share-url"></div>
    <div class="nav-share-btns">
      <button type="button" id="nav-share-send" data-track="share_send" hidden>📨 Send link</button>
      <button type="button" id="nav-share-copy" data-track="share_copy">📋 Copy link</button>
    </div>
  </div>`;
  share.querySelector(".nav-share-url").textContent = shareUrl;

  document.body.append(menu, help, share);

  const sendBtn = document.getElementById("nav-share-send");
  const copyBtn = document.getElementById("nav-share-copy");
  if (navigator.share) sendBtn.hidden = false;
  sendBtn.addEventListener("click", () => {
    navigator.share({ title: document.title, url: shareUrl }).catch(() => {}); // cancel is fine
  });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const t = document.createElement("textarea");
      t.value = shareUrl; document.body.appendChild(t); t.select();
      document.execCommand("copy"); t.remove();
    }
    copyBtn.textContent = "✅ Link copied";
    setTimeout(() => { copyBtn.textContent = "📋 Copy link"; }, 2000);
  });
  const openShare = () => { menu.hidden = true; share.hidden = false; };
  document.getElementById("nav-share-open").addEventListener("click", openShare);
  const shareBtn = document.getElementById("share-btn");
  if (shareBtn) shareBtn.addEventListener("click", openShare);
  share.addEventListener("click", e => { if (e.target === share || e.target.closest(".nav-help-head button")) share.hidden = true; });

  const btn = document.getElementById("menu-btn");
  if (btn) btn.addEventListener("click", () => { menu.hidden = false; });
  menu.addEventListener("click", e => { if (e.target === menu) menu.hidden = true; });
  help.addEventListener("click", e => { if (e.target === help || e.target.closest(".nav-help-head button")) help.hidden = true; });
  document.getElementById("nav-help-open").addEventListener("click", () => { menu.hidden = true; help.hidden = false; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") menu.hidden = help.hidden = share.hidden = true; });
})();
