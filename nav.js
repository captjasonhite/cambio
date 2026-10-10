// Hamburger menu + "add to home screen" help, shared by the sub-pages.
// Each page supplies its own <button id="menu-btn"> where it wants it.
(() => {
  const PAGES = [
    ["index.html",  "🏠 Home"],
    ["usd.html",    "🇺🇸 USA <> MXN 🇲🇽"],
    ["cad.html",    "🇨🇦 CAD <> MXN 🇲🇽"],
    ["usdcad.html", "🇺🇸 USA <> CAD 🇨🇦"],
    ["gas.html",    "⛽ Fuel Prices/Calc"],
    ["surge.html",  "🌊 Water Level"],
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
  `;
  document.head.appendChild(css);

  const menu = document.createElement("div");
  menu.className = "nav-veil";
  menu.hidden = true;
  menu.innerHTML = `<nav class="nav-box nav-menu">
    ${PAGES.map(([href, label]) =>
      `<a href="${href}" data-track="menu_${href.replace(".html", "")}"${href === here ? ' class="here"' : ""}></a>`).join("")}
    <hr>
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

  document.body.append(menu, help);

  const btn = document.getElementById("menu-btn");
  if (btn) btn.addEventListener("click", () => { menu.hidden = false; });
  menu.addEventListener("click", e => { if (e.target === menu) menu.hidden = true; });
  help.addEventListener("click", e => { if (e.target === help || e.target.closest(".nav-help-head button")) help.hidden = true; });
  document.getElementById("nav-help-open").addEventListener("click", () => { menu.hidden = true; help.hidden = false; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") menu.hidden = help.hidden = true; });
})();
