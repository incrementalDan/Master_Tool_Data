// content.js
(function () {
  const cfg = window.PROSHOP_LABEL_CONFIG || {};
  if (!cfg.pageMatch?.test(location.href)) return;
  if (document.getElementById("apw-print-multipage-label-btn")) return;

  // ----------------- tiny helpers -----------------
  const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
  const txt  = (el) => norm(el?.innerText ?? el?.textContent ?? "");
  const equalsLabel = (a,b) => norm(a).replace(/:$/,"").toLowerCase() === norm(b).replace(/:$/,"").toLowerCase();
  const esc = (s) => (s || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  // page flags
  const isTool = /\/procnc\/tools\//i.test(location.pathname);
  const isCots = /\/procnc\/ots\//i.test(location.pathname);
  const isWork = /\/procnc\/workorders\//i.test(location.pathname);
  const isFix  = /\/procnc\/fixtures\//i.test(location.pathname);
  const isNCR  = /\/procnc\/nonconformancereports\//i.test(location.pathname);
  const isCal  = /\/procnc\/equipment\//i.test(location.pathname);


  // Big centered preview window (uses config override if present)
 // Big centered preview window (no extra blank tab)
function openPreviewWindow(title) {
  const pref = (window.PROSHOP_LABEL_CONFIG?.previewWindow) || {};
  const sw = (screen.availWidth  || 1600);
  const sh = (screen.availHeight || 1000);
  const W = Math.floor(pref.width  || Math.min(1400, Math.max(1100, sw - 120)));
  const H = Math.floor(pref.height || Math.min(1000, Math.max(800,  sh - 160)));
  const L = Math.max(0, Math.floor((sw - W) / 2));
  const T = Math.max(0, Math.floor((sh - H) / 2));

  // IMPORTANT: no "noopener" or "noreferrer" here — they make window.open return null
  const features = `scrollbars=yes,resizable=yes,width=${W},height=${H},left=${L},top=${T}`;
  const w = window.open("about:blank", "_blank", features);

  // still break the opener relationship defensively
  try { if (w) w.opener = null; } catch (_) {}

  try { if (w) { w.resizeTo(W, H); w.moveTo(L, T); } } catch (_) {}
  return w; // non-null => your callers won't open a second window
}


  // ----------------- generic DOM helpers -----------------
  function findPanelByTitle(title) {
    const all = document.querySelectorAll("section,div,article");
    for (const el of all) {
      const h = el.querySelector("h1,h2,h3,.MuiTypography-h6,.panel-title,.card-title");
      if (h && equalsLabel(txt(h), title)) return el;
    }
    return null;
  }
  function findRowValueIn(container, labelText) {
    if (!container) return "";
    // table style
    for (const r of container.querySelectorAll("tr")) {
      const cells = [...r.children]; if (!cells.length) continue;
      const labelCell = cells.find(c => equalsLabel(txt(c), labelText) || txt(c).startsWith(labelText + ":"));
      if (labelCell) {
        const v = txt(cells[cells.indexOf(labelCell)+1]);
        if (v) return v;
      }
    }
    // generic blocks
    for (const el of container.querySelectorAll("*")) {
      const t = txt(el);
      if (equalsLabel(t, labelText) || t.startsWith(labelText + ":")) {
        if (el.nextElementSibling) { const v = txt(el.nextElementSibling); if (v) return v; }
        const row = el.closest("tr, .row, .grid, .MuiGrid-container, .field-row, .flex");
        if (row) {
          for (const c of row.querySelectorAll("td, .value, input, textarea, span, div")) {
            if (c === el) continue;
            const v = norm(c.value ?? c.innerText ?? c.textContent ?? "");
            if (v && !equalsLabel(v, labelText)) return v;
          }
        }
      }
    }
    return "";
  }
  function getImageUrl(list) {
    if (!list) list = "";
    for (const s of list.split(",")) {
      const sel = s.trim(); if (!sel) continue;
      const el = document.querySelector(sel); if (!el) continue;
      const img = el.tagName?.toLowerCase() === "img" ? el : el.querySelector("img");
      if (img?.src) return img.src;
    }
    const imgs = [...document.querySelectorAll("img")];
    const good = imgs.find(i => (i.width||0) >= 64 && (i.height||0) >= 64 && !/logo|icon/i.test(i.alt||""));
    return good ? good.src : "";
  }

  // ----------------- INTERNAL PART (tenant-agnostic) -----------------
  // Parse internal PN from a Part link URL, stripping $formName=..., ?..., #...
  function extractInternalFromPartHref(href) {
    if (!href) return "";
    try {
      const u = new URL(href, location.origin);
      let last = u.pathname.split("/").filter(Boolean).pop() || "";
      last = decodeURIComponent(last);
      last = last.replace(/\$.*/, "").replace(/\?.*/, "").replace(/#.*/, "");
      return last.trim();
    } catch { return ""; }
  }

  // Try URL-first, then fall back to fetching the Part page and reading "Internal Part #"
  async function getInternalPartFromWO() {
    const partLink = document.querySelector("a[href*='/parts/']");
    if (!partLink?.href) return "";

    const fromUrl = extractInternalFromPartHref(partLink.href);
    if (fromUrl) return fromUrl;

    try {
      const res  = await fetch(partLink.href, { credentials: "include" });
      const html = await res.text();
      const doc  = new DOMParser().parseFromString(html, "text/html");
      const N = s => (s || "").trim().replace(/\s+/g, " ");

      // table-style
      for (const r of doc.querySelectorAll("tr")) {
        const cells = [...r.children];
        if (!cells.length) continue;
        const labelCell = cells.find(c => N(c.innerText).replace(/:$/,"").toLowerCase() === "internal part #");
        if (labelCell) {
          const v = N((cells[cells.indexOf(labelCell)+1] || {}).innerText);
          if (v) return v.replace(/\(.*?\)/g, "").trim();
        }
      }
      // label + next sibling
      for (const el of doc.querySelectorAll("*")) {
        const t = N(el.innerText || el.textContent);
        if (t.replace(/:$/,"").toLowerCase() === "internal part #") {
          const sib = el.nextElementSibling;
          if (sib) {
            const v = N(sib.innerText || sib.textContent);
            if (v) return v.replace(/\(.*?\)/g, "").trim();
          }
        }
      }
      // text fallback
      const whole = N(doc.body?.innerText || doc.body?.textContent || "");
      const m = whole.match(/Internal\s*Part\s*#\s*([A-Za-z0-9][A-Za-z0-9._-]*)/i);
      if (m) return m[1];
    } catch (e) {
      console.warn("getInternalPartFromWO() fallback parse failed:", e);
    }
    return "";
  }

  // ----------------- TOOL page -----------------
  function findEDPFromPurchasing() {
    const results = [];
    const tables = document.querySelectorAll("table");
    for (const t of tables) {
      const head = t.querySelector("thead"); if (!head) continue;
      const headers = [...head.querySelectorAll("th,td")].map(h => txt(h));
      const edpIdx = headers.findIndex(h => /^EDP#?$/i.test(h));
      if (edpIdx === -1) continue;
      const rows = t.querySelectorAll("tbody tr");
      for (const row of rows) {
        const cells = [...row.children];
        const edpCell = cells[edpIdx] || cells[cells.length-1];
        if (!edpCell) continue;
        const link = edpCell.querySelector("a,[role='link']");
        let val = txt(link || edpCell);
        val = val.replace(/^[a-z]\.\s*/i, "").trim();
        if (val && !results.includes(val)) results.push(val);
      }
      if (results.length) return results;
    }
    return results;
  }
  function extractToolFields() {
    const toolPanel = findPanelByTitle("Tool Details") || document.body;
    let ToolNumber = findRowValueIn(toolPanel, "Tool #");
    if (!ToolNumber) {
      const h = document.querySelector("h1,h2,.page-title,.MuiTypography-h4");
      const m = h ? txt(h).match(/\b([A-Za-z]+-?\d+)\b/) : null; // dash/no-dash
      if (m) ToolNumber = m[1];
    }
    const descPanel = findPanelByTitle("Description") || document.body;
    let Description = findRowValueIn(descPanel, "Description") || txt(descPanel.querySelector("input,textarea,.MuiTypography-body1"));
    if (Description) Description = Description.replace(/\s+/g," ").trim();
    const EDPs = findEDPFromPurchasing();
    const LC_Storage = findRowValueIn(toolPanel, "Location");
    const ImageURL = getImageUrl(cfg.selectors?.image || "");
    return { ToolNumber, Description, EDPs, LC_Storage, ImageURL };
  }
  function renderToolLabel(fields) {
    const { widthIn, heightIn } = (cfg.label || { widthIn: 3.5, heightIn: 1.1 });
    const w = openPreviewWindow("Tool Label") || window.open("", "_blank");
    const doc = w.document;
    const imgColIn = 1.25;
    const textColIn = widthIn - imgColIn - 0.08; // account for gap
    const edpList = Array.isArray(fields.EDPs) ? fields.EDPs : (fields.EDPs ? [fields.EDPs] : []);
    // Bullet-separated EDPs, leading bullet on first
    const edpLine = edpList.length
      ? "&#9679; " + edpList.map(e => esc(e)).join(' &#9679; ')
      : "";
    const css = `
      @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .label { width:${widthIn}in; height:${heightIn}in; box-sizing:border-box; padding:0.06in 0.1in;
        display:grid; grid-template-columns:${textColIn}in ${imgColIn}in; gap:0.08in;
        font-family: ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial; }
      .content { display:flex; flex-direction:column; justify-content:flex-start; gap:0.03in;
        min-width:0; overflow:hidden; }
      .imgbox { display:flex; align-items:center; justify-content:center; overflow:hidden; }
      .imgbox img { max-width:100%; max-height:100%; object-fit:contain; }

      /* Top row: LC anchored left, Tool pill truly centered in remaining space */
      .top-row { display:flex; align-items:center;
        min-width:0; overflow:hidden; }
      .lc-rect { display:inline-block; font-weight:900; font-size:0.2in; line-height:1.2;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        border:0.015in solid #000; border-radius:0.04in;
        padding:0.01in 0.07in; box-sizing:border-box; flex-shrink:0; }
      .tool-pill { display:inline-block; font-weight:900; font-size:0.2in; line-height:1.2;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        border:0.015in solid #000; border-radius:999in;
        padding:0.01in 0.09in; box-sizing:border-box; flex-shrink:0;
        margin-left:auto; margin-right:auto; transform:translateX(0.3in); }

      /* Description — flexible, fills available space, up to 4 lines */
      .desc { font-weight:500; font-size:0.13in; line-height:1.2; padding-left:0.04in;
        overflow-wrap:anywhere;
        display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;
        flex:1; }

      /* EDP — pinned to bottom, never wraps off label */
      .edp { font-size:0.13in; line-height:1.2; padding-left:0.04in;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        flex-shrink:0; }
    `;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
      <div class="label">
        <div class="content">
          <div class="top-row">
            <span class="lc-rect">${esc(fields.LC_Storage || "")}</span>
            <span class="tool-pill">${esc(fields.ToolNumber || "")}</span>
          </div>
          <div class="desc">${esc(fields.Description || "")}</div>
          ${edpLine ? `<div class="edp">${edpLine}</div>` : ""}
        </div>
        <div class="imgbox">${fields.ImageURL ? `<img src="${esc(fields.ImageURL)}">` : ""}</div>
      </div></body></html>`;
    doc.open(); doc.write(html); doc.close();
  }

  // ----------------- COTS page -----------------
  function findPOOptionsFromInventory() {
    const tables = document.querySelectorAll("table");
    for (const t of tables) {
      const head = t.querySelector("thead"); if (!head) continue;
      const headers = [...head.querySelectorAll("th,td")].map(h => (h.innerText || h.textContent || "").trim());
      const idx = headers.findIndex(h => /PO#\s*In\s*\/\s*Item#/i.test(h));
      if (idx === -1) continue;

      const rows = t.querySelectorAll("tbody tr");
      const opts = [];
      rows.forEach(r => {
        const cell = r.children[idx];
        if (!cell) return;

        let raw = (cell.innerText || cell.textContent || "").replace(/^[a-z]\.\s*/i, "").replace(/\s+/g, " ").trim();

        let po = "";
        const mPO = raw.match(/\b(\d{5,})\b/);
        if (mPO) po = mPO[1];

        // decimal item numbers supported
        let item = "";
        let mItem =
          raw.match(/(?:item\s*#?\s*|#\s*)(\d+(?:\.\d+)?)/i) ||
          raw.match(/\b(\d+(?:\.\d+)?)\b(?!.*\b\d)/);

        if (mItem) {
          item = mItem[1];
          if (item === po && /^\d{5,}$/.test(item)) item = "";
        }

        const display = po ? (item ? `${po} — Item #${item}` : po) : raw;
        if (po || raw) opts.push({ po, item, display, raw });
      });

      if (opts.length) return opts;
    }
    return [];
  }
  function chooseFromList(title, options) {
    if (!options.length) return null;
    if (options.length === 1) return options[0];
    const lines = options.map((o, i) => `${i + 1}) ${o.display || o.raw}`).join("\n");
    const ans = prompt(`${title}\n\n${lines}\n\nEnter 1–${options.length} (default 1):`, "1");
    if (ans === null) return null;
    const n = Math.max(1, Math.min(options.length, parseInt(ans, 10) || 1));
    return options[n - 1];
  }
  function extractCotsFields() {
    const cotsPanel = findPanelByTitle("COTS Details") || document.body;
    const COTSId = findRowValueIn(cotsPanel, "COTS Id");
    const AKA    = findRowValueIn(cotsPanel, "A.K.A.");

    const options = findPOOptionsFromInventory();
    let picked = null;
    if (options.length > 1) {
      picked = chooseFromList("Select PO / Item to print:", options);
      if (!picked) return null; // user cancelled
    } else {
      picked = options[0] || { po: "", item: "" };
    }

    const PO   = picked.po   || "";
    const Item = picked.item || "";
    const ImageURL = getImageUrl(cfg.selectors?.image || "");
    return { COTSId, AKA, PO, Item, ImageURL };
  }
  function renderCotsLabel(fields) {
    const { widthIn, heightIn } = (cfg.label || { widthIn: 3.5, heightIn: 1.1 });
    const w = openPreviewWindow("COTS Label") || window.open("", "_blank");
    const doc = w.document;
    const leftColIn = widthIn/2;
    const css = `
      @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .label { width:${widthIn}in;height:${heightIn}in;box-sizing:border-box;padding:0.08in 0.12in;
        display:grid;grid-template-columns:${leftColIn}in 1fr;gap:0.08in;
        font-family: ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial; }
      .imgbox{display:flex;align-items:center;justify-content:center;overflow:hidden}
      .imgbox img{max-width:100%;max-height:100%;object-fit:contain}
      .content{display:flex;flex-direction:column;justify-content:center;gap:0.05in;min-width:0}
      .id{font-weight:900;font-size:0.26in;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .aka{font-weight:600;font-size:0.15in;line-height:1.15;overflow-wrap:anywhere;
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .po{font-size:0.13in;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    `;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
      <div class="label">
        <div class="imgbox">${fields.ImageURL ? `<img src="${esc(fields.ImageURL)}">` : ""}</div>
        <div class="content">
          <div class="id">${esc(fields.COTSId || "")}</div>
          <div class="aka">${esc(fields.AKA || "")}</div>
          <div class="po">${fields.PO ? `PO: ${esc(fields.PO)}` : ""}${fields.Item ? `  |  Item: #${esc(fields.Item)}` : ""}</div>
        </div>
      </div></body></html>`;
    doc.open(); doc.write(html); doc.close();
  }

  // ----------------- WORK ORDER page -----------------
  async function extractWorkOrderFields() {
    let WorkOrder  = findRowValueIn(document.body, "Work Order #");
    let PartClient = (findRowValueIn(document.body, "Part #") || "").replace(/\(.*?\)/g, "").trim();

    if (!WorkOrder) {
      const m = location.pathname.match(/\/workorders\/\d+\/([^\/$]+)/i);
      if (m) WorkOrder = decodeURIComponent(m[1]).replace(/\$$/, "");
    }

    const PartInternal = await getInternalPartFromWO();
    const PartNumber   = PartInternal || PartClient || "";

    const ImageURL = getImageUrl(cfg.selectors?.workImage || cfg.selectors?.image || "");
    return { WorkOrder, PartNumber, PartInternal, PartClient, ImageURL };
  }
  function renderWorkOrderLabel(fields) {
    const { widthIn, heightIn } = (cfg.label || { widthIn: 3.5, heightIn: 1.1 });
    const PAD_LR = 0.12, GAP = 0.08;
    let imgW = Math.min(1.10, Math.max(0.90, widthIn * 0.32));
    const imgMin = 0.80;
    const fontFamily = "ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial";

    const textColWidthIn = (img) => Math.max(0.1, widthIn - PAD_LR - PAD_LR - GAP - img);
    function fits(text, weight, sizeIn, colW) {
      const probe = document.createElement("div");
      probe.style.cssText =
        `position:fixed;left:-9999px;top:-9999px;white-space:nowrap;`+
        `font-family:${fontFamily};font-weight:${weight};font-size:${sizeIn}in;`+
        `width:${colW}in;overflow:hidden;line-height:1.05`;
      probe.textContent = text; document.body.appendChild(probe);
      const ok = probe.scrollWidth <= probe.clientWidth + 0.5; probe.remove(); return ok;
    }
    function bestSize(text, weight, maxIn, minIn, img) {
      const col = textColWidthIn(img); let s = maxIn;
      while (s > minIn && !fits(text, weight, s, col)) s -= 0.01;
      return { fits: fits(text, weight, s, col), size: Math.max(minIn, s) };
    }

    const woLine  = `Work Order # ${fields.WorkOrder || ""}`;
    const partLine= `Part # ${fields.PartNumber || ""}`;

    let wo = bestSize(woLine, 600, 0.22, 0.12, imgW);
    while (!wo.fits && imgW > imgMin) { imgW = Math.max(imgMin, imgW - 0.05); wo = bestSize(woLine, 600, 0.22, 0.12, imgW); }
    const part = bestSize(partLine, 700, 0.20, 0.12, imgW);

    const woValueSize   = wo.size;
    const woPrefixSize  = Math.max(0.11, woValueSize * 0.75);
    const partValueSize = part.size;
    const partPrefixSize= Math.max(0.10, partValueSize * 0.80);

    const w = openPreviewWindow("Work Order Label") || window.open("", "_blank");
    const doc = w.document;

    const css = `
      @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
      :root { --imgw:${imgW}in; }
      html, body { margin: 0; padding: 0; }
      .label{
        width:${widthIn}in;height:${heightIn}in;box-sizing:border-box;
        padding:0.08in ${PAD_LR}in;
        display:grid;grid-template-columns:var(--imgw) 1fr;gap:${GAP}in;
        font-family:${fontFamily}
      }
      .imgbox{display:flex;align-items:center;justify-content:center;overflow:hidden;height:100%}
      .imgbox img{max-width:100%;max-height:100%;object-fit:contain}
      .content{display:flex;flex-direction:column;justify-content:center;gap:0.04in;min-width:0}
      .line{white-space:nowrap;overflow:hidden;text-overflow:clip;line-height:1.05;display:block}
      .line .prefix{font-weight:400;opacity:0.95}
      .line .value{font-weight:800}
      .wo .prefix{font-size:${woPrefixSize}in}
      .wo .value {font-size:${woValueSize}in}
      .partline .prefix{font-size:${partPrefixSize}in}
      .partline .value {font-size:${partValueSize}in}
    `;

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
      <div class="label">
        <div class="imgbox">${fields.ImageURL ? `<img src="${esc(fields.ImageURL)}">` : ""}</div>
        <div class="content">
          <div class="line wo">
            <span class="prefix">Work Order #&nbsp;</span>
            <span class="value">${esc(fields.WorkOrder || "")}</span>
          </div>
          <div class="line partline">
            <span class="prefix">Part #&nbsp;</span>
            <span class="value">${esc(fields.PartNumber || "")}</span>
          </div>
        </div>
      </div>
    </body></html>`;
    doc.open(); doc.write(html); doc.close();
  }

  // ----------------- FIXTURE page -----------------
  function readPanelLineValue(container, labelText) {
    const raw = (container?.innerText || "").replace(/\r/g, "");
    const lines = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const before = lines[i].replace(/\s*:.*/, "");
      if (equalsLabel(before, labelText)) {
        const after = lines[i].replace(/^[^:]*:\s*/, "");
        if (after && !equalsLabel(after, labelText)) return after;
        const next = lines[i + 1] || "";
        if (next && !/:/.test(next)) return next;
        return "";
      }
    }
    return "";
  }
  function extractFixtureFields() {
    const details = findPanelByTitle("Fixture Details") || document.body;
    let FixtureNum = readPanelLineValue(details, "Fixture #") || "";
    if (!FixtureNum) {
      const m = location.pathname.match(/\/fixtures\/(\d+)/i);
      if (m) FixtureNum = m[1];
    }
    const Desc  = readPanelLineValue(details, "Description / Info") || "";
    const Rack  = readPanelLineValue(details, "Rack #")  || "";
    const Shelf = readPanelLineValue(details, "Shelf #") || "";
    const Left  = readPanelLineValue(details, "# From Left") || "";
    const ImageURL = getImageUrl(".Resources img, .resources img, .MuiCardMedia-root img, img");
    return { FixtureNum, Desc, Rack, Shelf, Left, ImageURL };
  }
  function renderFixtureLabel(fields) {
    const { widthIn, heightIn } = (cfg.label || { widthIn: 3.5, heightIn: 1.1 });
    const PAD_LR = 0.12, GAP = 0.08;
    let imgW = Math.min(1.10, Math.max(0.90, widthIn * 0.32));
    const imgMin = 0.80;
    const fontFamily = "ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial";

    const textColWidthIn = (img) => Math.max(0.1, widthIn - PAD_LR - PAD_LR - GAP - img);
    function fits(text, weight, sizeIn, colW) {
      const probe = document.createElement("div");
      probe.style.cssText = `position:fixed;left:-9999px;top:-9999px;white-space:nowrap;`+
        `font-family:${fontFamily};font-weight:${weight};font-size:${sizeIn}in;`+
        `width:${colW}in;overflow:hidden;line-height:1.05`;
      probe.textContent = text; document.body.appendChild(probe);
      const ok = probe.scrollWidth <= probe.clientWidth + 0.5; probe.remove(); return ok;
    }
    function bestSize(text, weight, maxIn, minIn, img) {
      const col = textColWidthIn(img); let s = maxIn;
      while (s > minIn && !fits(text, weight, s, col)) s -= 0.01;
      return { fits: fits(text, weight, s, col), size: Math.max(minIn, s) };
    }

    const line1 = `F-${fields.FixtureNum || ""}`;
    const desc  = (fields.Desc || "").trim();
    const line3 = `Rack #: ${fields.Rack || ""}  •  Shelf #: ${fields.Shelf || ""}  •  # From Left: ${fields.Left || ""}`;

    let l1 = bestSize(line1, 900, 0.28, 0.16, imgW);
    while (!l1.fits && imgW > imgMin) { imgW = Math.max(imgMin, imgW - 0.05); l1 = bestSize(line1, 900, 0.28, 0.16, imgW); }
    const l2 = bestSize(desc || "", 600, 0.16, 0.11, imgW);
    const l3 = bestSize(line3, 600, 0.14, 0.10, imgW);

    const w = openPreviewWindow("Fixture Label") || window.open("", "_blank");
    const doc = w.document;
    const css = `
      @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
      :root { --imgw:${imgW}in; }
      html, body { margin: 0; padding: 0; }
      .label{width:${widthIn}in;height:${heightIn}in;box-sizing:border-box;padding:0.08in ${PAD_LR}in;
        display:grid;grid-template-columns:var(--imgw) 1fr;gap:${GAP}in;
        font-family:${fontFamily}}
      .imgbox{display:flex;align-items:center;justify-content:center;overflow:hidden;height:100%}
      .imgbox img{max-width:100%;max-height:100%;object-fit:contain}
      .content{display:flex;flex-direction:column;justify-content:center;gap:0.035in;min-width:0}
      .l1,.l2,.l3{white-space:nowrap;overflow:hidden;text-overflow:clip;line-height:1.05}
      .l1{font-weight:900;font-size:${l1.size}in}
      .l2{font-weight:600;font-size:${l2.size}in}
      .l3{font-weight:600;font-size:${l3.size}in}
    `;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
      <div class="label">
        <div class="imgbox">${fields.ImageURL ? `<img src="${esc(fields.ImageURL)}">` : ""}</div>
        <div class="content">
          <div class="l1">${esc(line1)}</div>
          <div class="l2">${esc(desc)}</div>
          <div class="l3">${esc(line3)}</div>
        </div>
      </div></body></html>`;
    doc.open(); doc.write(html); doc.close();
  }

  // ----------------- NCR page -----------------
  function extractNCRRefFromURL() {
    const segs = location.pathname.split("/").filter(Boolean);
    const last = decodeURIComponent(segs[segs.length - 1] || "").replace(/[$%].*/, "").trim();
    if (last) return last;
    const m = location.href.match(/\/([^\/]+?)(?:\$|%24|$)/);
    return m ? decodeURIComponent(m[1]).replace(/[$%].*/, "").trim() : "";
  }

  function extractNCRFields() {
    const body = document.body;
    // ProShop renders "NCR Ref #:\t25-0058.55.01" as tab-separated text in the same node
    const bodyText = document.body.innerText || "";
    const ncrRefMatch = bodyText.match(/NCR\s+Ref\s+#\s*:?\s*[\t ]+([^\n\t]+)/);
    const titleMatch  = (document.title || "").match(/^([^\s:]+)\s*:/);
    const NCRRef        = (ncrRefMatch ? ncrRefMatch[1].trim() : "")
                       || (titleMatch  ? titleMatch[1].trim()  : "")
                       || extractNCRRefFromURL();
    const PartsAffected = findRowValueIn(body, "# of Parts Affected")
                       || findRowValueIn(body, "Qty");
    const Cause         = findRowValueIn(body, "Cause Code");
    const FiledBy       = findRowValueIn(body, "User");
    const NCRDate       = findRowValueIn(body, "NCR Date");
    const Notes         = findRowValueIn(body, "Notes")
                       || findRowValueIn(body, "Description")
                       || findRowValueIn(body, "Nonconformance Description");
    return { NCRRef, PartsAffected, Cause, FiledBy, NCRDate, Notes };
  }

  function renderNCRLabel(fields) {
    const { widthIn, heightIn } = (cfg.label || { widthIn: 3.5, heightIn: 1.1 });
    const w = openPreviewWindow("NCR Label") || window.open("", "_blank");
    if (!w) { alert("Pop-up blocked — please allow pop-ups for this site and try again."); return; }
    const doc = w.document;

    const css = `
      @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .ncr-label {
        width: ${widthIn}in; height: ${heightIn}in;
        box-sizing: border-box;
        padding: 0.06in 0.10in;
        display: flex; flex-direction: column; justify-content: flex-start; gap: 0.02in;
        font-family: Arial, sans-serif;
      }
      .ncr-top-row {
        display: flex; align-items: baseline; gap: 0.02in;
        white-space: nowrap; overflow: hidden; flex-shrink: 0; flex-wrap: nowrap;
      }
      .ncr-ref {
        font-weight: 900; font-size: 0.17in; line-height: 1.1;
        white-space: nowrap; overflow: hidden; text-overflow: clip;
        flex-shrink: 1; min-width: 0;
      }
      .ncr-ref-prefix {
        font-weight: 400; font-size: 0.11in; color: #555; margin-right: 0.02in;
      }
      .ncr-qty {
        margin-left: auto; font-size: 0.11in; font-weight: 700;
        white-space: nowrap; flex-shrink: 0;
      }
      .ncr-meta-row {
        display: flex; align-items: center; gap: 0.08in; flex-shrink: 0;
        font-size: 0.105in; line-height: 1.1; white-space: nowrap; overflow: hidden;
      }
      .ncr-meta-prefix { font-weight: 400; color: #555; }
      .ncr-meta-val    { font-weight: 700; }
      .ncr-cause-pill {
        display: inline-block;
        border: 0.010in solid #555; border-radius: 999in;
        padding: 0.003in 0.03in;
        font-size: 0.09in; font-weight: 600; white-space: nowrap; flex-shrink: 0;
      }
      .ncr-cause-row { flex-shrink: 0; }
      .ncr-notes {
        flex: 1; min-height: 0;
        font-size: 0.115in; line-height: 1.2; overflow: hidden;
        display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4;
        overflow-wrap: anywhere; color: #111;
      }
    `;

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
      <div class="ncr-label">
        <div class="ncr-top-row">
          <span class="ncr-ref"><span class="ncr-ref-prefix">NCR&nbsp;</span>${esc(fields.NCRRef || "")}</span>
          ${fields.Cause         ? `<span class="ncr-cause-pill">${esc(fields.Cause)}</span>` : ""}
          ${fields.PartsAffected ? `<span class="ncr-qty">Qty: ${esc(fields.PartsAffected)}</span>` : ""}
        </div>
        <div class="ncr-meta-row">
          ${fields.FiledBy  ? `<span><span class="ncr-meta-prefix">Filed by: </span><span class="ncr-meta-val">${esc(fields.FiledBy)}</span></span>` : ""}
          ${fields.NCRDate  ? `<span><span class="ncr-meta-prefix">Date: </span><span class="ncr-meta-val">${esc(fields.NCRDate)}</span></span>` : ""}
        </div>
        ${fields.Notes ? `<div class="ncr-notes" id="apw-ncr-notes">${esc(fields.Notes)}</div>` : ""}
      </div>
    </body></html>`;

    doc.open(); doc.write(html); doc.close();

    // Run notes auto-fit from parent context (no inline script needed)
    const onReady = () => {
      const label = doc.querySelector('.ncr-label');
      const notes = doc.getElementById('apw-ncr-notes');
      const topRow = doc.querySelector('.ncr-top-row');
      const ref = doc.querySelector('.ncr-ref');
      const overflows = () => label.scrollHeight > label.clientHeight + 1;

      // Step 0: shrink NCR ref font until top row fits on one line
      if (ref && topRow) {
        let refSize = 0.17;
        const minRefSize = 0.11;
        const refStep = 0.005;
        while (topRow.scrollWidth > topRow.clientWidth + 1 && refSize > minRefSize) {
          refSize = Math.max(minRefSize, refSize - refStep);
          ref.style.fontSize = refSize + 'in';
        }
      }

      // Step 1: shrink notes font first
      if (notes) {
        let size = 0.115;
        const minSize = 0.075, step = 0.005;
        notes.style.webkitLineClamp = 'unset';
        notes.style.display = 'block';
        notes.style.overflow = 'hidden';
        while (overflows() && size > minSize) {
          size = Math.max(minSize, size - step);
          notes.style.fontSize = size + 'in';
        }
        notes.style.display = '-webkit-box';
        notes.style.webkitBoxOrient = 'vertical';
        notes.style.webkitLineClamp = '4';
      }

      // Step 2: if still overflowing, shrink all fixed rows too
      if (overflows()) {
        const allText = [...doc.querySelectorAll('.ncr-ref, .ncr-qty, .ncr-meta-row, .ncr-cause-pill, .ncr-notes')];
        let scale = 0.95;
        while (overflows() && scale > 0.7) {
          allText.forEach(el => {
            const current = parseFloat(doc.defaultView.getComputedStyle(el).fontSize);
            el.style.fontSize = (current * 0.97) + 'px';
          });
          scale -= 0.03;
        }
      }
    };
    if (doc.readyState === 'complete') setTimeout(onReady, 150);
    else w.addEventListener('load', () => setTimeout(onReady, 150), { once: true });
  }

  // ----------------- SEQUENCE → TOOLING TAG -----------------
  function findSequenceTable() {
    const l = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();
    const tables = document.querySelectorAll("table");
    for (const t of tables) {
      const head = t.querySelector("thead"); if (!head) continue;
      const headers = [...head.querySelectorAll("th,td")].map(h => l(h.innerText || h.textContent));
      const hasG   = headers.some(h => /g-?code.*tool|^t#?$/.test(h));
      const hasTN  = headers.some(h => /^tool\s*#/.test(h));
      const hasH   = headers.some(h => /holder/.test(h));
      const hasOOH = headers.some(h => /\boo[hH]\b|out.*holder|stick.?out/.test(h));
      if (hasG && hasTN && (hasH || hasOOH)) {
        const map = {}; headers.forEach((h,i)=>map[h]=i);
        return { table:t, headers, map };
      }
    }
    return null;
  }
  const seqInfo = findSequenceTable();
  const isSeq = !!seqInfo;

  function extractPartNumberFromPage() {
    const pick = (el) => (el ? (el.innerText || el.textContent || "").trim() : "");
    const cands = document.querySelectorAll("h1,h2,[class*='title'],[class*='page']");
    for (const el of cands) {
      const t = pick(el); const m = t.match(/part\s*[:/]\s*([A-Z0-9\-_.]+)/i);
      if (m) return m[1];
    }
    const all = document.querySelectorAll("th,td,span,div,label");
    for (const el of all) {
      const t = pick(el);
      if (/^part\s*#\s*:?\s*$/i.test(t)) {
        const row = el.closest("tr");
        if (row && row.children.length >= 2) {
          const v = pick(row.children[1]); if (v) return v;
        }
        if (el.nextElementSibling) {
          const v = pick(el.nextElementSibling); if (v) return v;
        }
      }
    }
    return "";
  }

  // CSP-safe tool-details fetch (fetch -> iframe fallback)
  async function fetchToolDetails(url) {
    const out = { description: "", holder: "", ooh: "", location: "" };
    if (!url) return out;

    const N = (s) => (s || "").trim().replace(/\s+/g, " ");
    function parseDoc(doc) {
      const grab = (label) => {
        for (const r of doc.querySelectorAll("tr")) {
          const cells = [...r.children];
          const lbl = cells.find(c => N(c.innerText).replace(/:$/,"").toLowerCase() === label.toLowerCase());
          if (lbl) {
            const vEl = cells[cells.indexOf(lbl)+1];
            const v = N(vEl?.innerText || vEl?.textContent || "");
            if (v) return v;
          }
        }
        for (const el of doc.querySelectorAll("*")) {
          const t = N(el.innerText || el.textContent);
          if (t.replace(/:$/,"").toLowerCase() === label.toLowerCase()) {
            if (el.nextElementSibling) {
              const v = N(el.nextElementSibling.innerText || el.nextElementSibling.textContent);
              if (v) return v;
            }
          }
        }
        return "";
      };
      return {
        description: grab("Description") || "",
        location:    grab("Location")    || "",
        holder:      grab("Holder")      || "",
        ooh:         grab("OOH")         || grab("Stickout") || ""
      };
    }

    try {
      const res = await fetch(url, { credentials: "include", mode: "same-origin" });
      if (res.ok) {
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        return parseDoc(doc);
      }
    } catch(e) { console.warn("fetchToolDetails fetch() failed, trying iframe:", e); }

    try {
      const iframe = document.createElement("iframe");
      iframe.src = url;
      iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:10px;height:10px;opacity:0;pointer-events:none;";
      document.body.appendChild(iframe);
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("iframe timeout")), 15000);
        iframe.addEventListener("load", () => { clearTimeout(to); resolve(); }, { once:true });
      });
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      const parsed = doc ? parseDoc(doc) : out;
      iframe.remove();
      return parsed;
    } catch(e2) {
      console.warn("fetchToolDetails iframe fallback failed:", e2);
      return out;
    }
  }

  async function extractSequenceTools() {
    const seq = findSequenceTable();
    if (!seq) return [];
    const N = (s) => (s || "").trim().replace(/\s+/g, " ");

    const headers = seq.headers;
    const idxOf = (rx) => {
      const i = headers.findIndex(h => rx.test(h));
      return i === -1 ? null : i;
    };
    const idxG   = idxOf(/g-?code.*tool|^t#?$/);
    const idxTN  = idxOf(/^tool\s*#/);
    const idxH   = idxOf(/holder/);
    const idxOOH = idxOf(/\boo[hH]\b|out.*holder|stick.?out/);
    const idxRTA = idxOf(/\brta\s*#?\b|^rta$/);

    const part = extractPartNumberFromPage();
    const rows = [...seq.table.querySelectorAll("tbody tr")].filter(r => r.children.length);

    // Phase 1: parse all rows from DOM — no network I/O
    const rawItems = [];
    for (const r of rows) {
      const cell = (i) => (i == null ? null : r.children[i]);
      const read = (i) => (i == null ? "" : N((cell(i)?.innerText || cell(i)?.textContent || "")));

      let tcode = read(idxG);
      const mT = tcode.match(/t?\s*(\d+)/i);
      tcode = mT ? `T${mT[1]}` : (tcode || "");

      let ToolNo = read(idxTN);
      const toolLink = cell(idxTN)?.querySelector("a");
      const toolUrl  = toolLink?.href || "";

      let Holder = read(idxH);
      let oohRaw = read(idxOOH); let OOH = "";
      if (oohRaw) {
        const m = oohRaw.match(/(\d+(?:\.\d+)?)\s*["in]?/i);
        OOH = m ? `${m[1]}"` : oohRaw;
      }

      const RTA = read(idxRTA);
      const Description = toolLink?.getAttribute("title") || toolLink?.getAttribute("aria-label") || "";

      rawItems.push({ PartNumber: part, TCode: tcode, ToolNo, Description, Holder, OOH, Location: "", RTA, _toolUrl: toolUrl });
    }

    // Phase 2: deduplicate to unique T-codes before fetching
    const uniqueTools = dedupeToolsByTCode(rawItems);

    // Phase 3: fetch details for unique tools in parallel
    await Promise.allSettled(
      uniqueTools.map(async (tool) => {
        if (!tool._toolUrl) return;
        const extra = await fetchToolDetails(tool._toolUrl);
        tool.Description = tool.Description || extra.description || "";
        tool.Location    = extra.location || "";
        tool.Holder      = tool.Holder    || extra.holder || "";
        tool.OOH         = tool.OOH       || extra.ooh    || "";
      })
    );

    uniqueTools.forEach(t => delete t._toolUrl);
    return uniqueTools;
  }

  // De-dupe to one item per T#, keep richest row
  function dedupeToolsByTCode(items) {
    const score = (x) => ['Description','Holder','OOH','Location','RTA','ToolNo']
      .reduce((s,k) => s + (x[k] && String(x[k]).trim() ? 1 : 0), 0);

    const map = new Map();
    for (const it of items) {
      const key = (it.TCode || "").replace(/\s+/g, "").toUpperCase() ||
                  ("TOOL:" + (it.ToolNo || "").toUpperCase());
      if (!map.has(key)) map.set(key, it);
      else if (score(it) > score(map.get(key))) map.set(key, it);
    }
    return [...map.values()].sort((a, b) => {
      const na = parseInt((a.TCode || "").match(/\d+/)?.[0] || 9999, 10);
      const nb = parseInt((b.TCode || "").match(/\d+/)?.[0] || 9999, 10);
      if (na !== nb) return na - nb;
      return (a.ToolNo || "").localeCompare(b.ToolNo || "");
    });
  }

  // ---------- Tool Tag rendering (inches-based auto-fit) ----------
  function inchesAutoFit(winDoc, root) {
    const get = (sel) => root.querySelector(sel);
    const main = get(".main");

    const targets = [
      { sel: ".tt-part",     hi: 0.18, lo: 0.10 },
      { sel: ".tt-tool-val", hi: 0.14, lo: 0.08 },
      { sel: ".tt-rta-val",  hi: 0.13, lo: 0.08 },
      { sel: ".tt-hold-val", hi: 0.14, lo: 0.08 },
      { sel: ".tt-ooh-val",  hi: 0.13, lo: 0.08 },
      { sel: ".tt-lc-val",   hi: 0.13, lo: 0.08 },
      { sel: ".tt-tcode",    hi: 0.14, lo: 0.10 }
    ];

    function fitLineIn(el, hi, lo) {
      if (!el) return;
      let size = hi;
      el.style.fontSize = size + "in";
      for (let i=0; i<220 && el.scrollWidth > el.clientWidth && size > lo; i++) {
        size -= 0.01;
        el.style.fontSize = size + "in";
      }
      if (el.scrollWidth > el.clientWidth) {
        let t = el.textContent || "";
        while (t.length && el.scrollWidth > el.clientWidth) {
          t = t.slice(0, -1);
          el.textContent = t + "…";
        }
      }
    }

    targets.forEach(t => fitLineIn(get(t.sel), t.hi, t.lo));

    if (main && main.scrollHeight > main.clientHeight) {
      const valEls  = [".tt-part",".tt-tool-val",".tt-rta-val",".tt-hold-val",".tt-ooh-val",".tt-lc-val"].map(get).filter(Boolean);
      const lblEls  = [...root.querySelectorAll(".lbl")];
      const allEls  = [...valEls, ...lblEls];
      const scale   = Math.max(0.7, main.clientHeight / main.scrollHeight);
      allEls.forEach(el => {
        const px = parseFloat(winDoc.defaultView.getComputedStyle(el).fontSize);
        el.style.fontSize = Math.max(8, Math.floor(px * scale)) + "px";
      });
    }

    // Footer description: shrink single-line first, then wrap to 2 lines, then clamp
    const descEl = get(".tt-desc");
    if (descEl) {
      const hiIn = 0.135, midIn = 0.09, loIn = 0.08;

      // Phase 1 — single line, shrink from hi down to mid
      // overflow:hidden is required for scrollWidth to correctly report content width
      descEl.style.whiteSpace      = "nowrap";
      descEl.style.overflow        = "hidden";
      descEl.style.display         = "block";
      descEl.style.webkitLineClamp = "unset";
      let dSize = hiIn;
      descEl.style.fontSize = dSize + "in";
      for (let i = 0; i < 200 && descEl.scrollWidth > descEl.clientWidth && dSize > midIn; i++) {
        dSize -= 0.005;
        descEl.style.fontSize = dSize + "in";
      }

      if (descEl.scrollWidth > descEl.clientWidth) {
        // Phase 2 — allow wrapping, shrink from current size down to lo until it fits in 2 lines
        descEl.style.whiteSpace = "normal";
        for (let i = 0; i < 200 && dSize > loIn; i++) {
          descEl.style.fontSize = dSize + "in";
          let lh = parseFloat(winDoc.defaultView.getComputedStyle(descEl).lineHeight);
          if (!isFinite(lh)) lh = parseFloat(winDoc.defaultView.getComputedStyle(descEl).fontSize) * 1.2;
          if (descEl.scrollHeight <= lh * 2.2) break;
          dSize -= 0.005;
        }
        // Hard clamp at 2 lines
        descEl.style.display         = "-webkit-box";
        descEl.style.webkitBoxOrient = "vertical";
        descEl.style.webkitLineClamp = "2";
      }
    }
  }

  function tagMarkup(fields, wIn, hIn, tagW, foot) {
    const part   = esc(fields.PartNumber || "");
    const tcode  = esc(fields.TCode || "");
    const tool   = esc(fields.ToolNo || "");
    const desc   = esc(fields.Description || "");
    const holder = esc(fields.Holder || "");
    const ooh    = esc(fields.OOH || "");
    const loc    = esc(fields.Location || "");
    const rta    = esc(fields.RTA || "");

    return `
      <div class="label">
        <div class="wrap">
          <div class="tag">
            <div class="pocket-box"><span class="pocket-p">P</span></div>
            <div class="main">
              <div class="line tt-part clear-pocket">${part}</div>
              <div class="data-row clear-pocket">
                <span class="lbl">Tool</span><span class="val tt-tool-val"><span class="pill">${tool}</span></span>
                <span class="lbl">RTA</span><span class="val tt-rta-val">${rta ? `<span class="pill">${rta}</span>` : ""}</span>
              </div>
              <div class="data-row hold-row">
                <span class="lbl">Holder</span><span class="val span-val tt-hold-val">${holder}</span>
              </div>
              <div class="data-row">
                <span class="lbl">OOH</span><span class="val tt-ooh-val">${ooh}</span>
                <span class="lbl">LC</span><span class="val tt-lc-val"><span class="pill lc-pill">${loc}</span></span>
              </div>
            </div>
            <div class="foot">
              <span class="tcode-box tt-tcode">${tcode}</span>
              <span class="line tt-desc">${desc}</span>
            </div>
          </div>
          <div></div>
        </div>
      </div>`;
  }

  function tagCSS(wIn, hIn, tagW, foot, offLIn, offTIn) {
    const offL = offLIn ?? (window.PROSHOP_LABEL_CONFIG?.printOffset?.leftIn ?? 0.04);
    const offT = offTIn ?? (window.PROSHOP_LABEL_CONFIG?.printOffset?.topIn  ?? 0.02);
    return `
      @page { size: ${wIn}in ${hIn}in; margin: 0; }
      html, body { margin:0; padding:0; font-family: Arial, sans-serif; }
      * { font-family: Arial, sans-serif; }
      :root { --tagw:${tagW}in; --footh:${foot}in; }
      .label {
        width:${wIn}in; height:${hIn}in; box-sizing:border-box;
        padding-left:${offL}in; padding-top:${offT}in;
        page-break-inside: avoid;
        page-break-after: always;
      }
      .label:last-child { page-break-after: auto; }
      @media print { .label:last-child { page-break-after: auto; } }

      .wrap  { width:100%; height:100%; display:grid; grid-template-columns: var(--tagw) 1fr; }
      .tag   { position:relative; border-right: 0.02in solid #B0B0B0; }
      .main  { position:absolute; left:0; top:0; right:0; height: calc(100% - var(--footh));
               padding: 0.05in 0.05in 0 0.06in; box-sizing:border-box;
               display:flex; flex-direction:column; justify-content:flex-start; gap:0.025in; }
      .foot  { position:absolute; left:0; right:0; bottom:0; height: var(--footh);
               border-top: 0.02in solid #B0B0B0; display:flex; align-items:center;
               padding:0 0.06in; gap:0.04in; box-sizing:border-box; overflow:hidden; }
      .line  { white-space:nowrap; overflow:hidden; line-height:1.05; }
      .tt-part { font-weight:800; }

      /* Rows that sit alongside the pocket box keep clear of it; rows below run full width */
      .clear-pocket { padding-right: 0.33in; }
      .data-row { display:grid; grid-template-columns: auto 1fr auto 1fr; column-gap:0.05in; align-items:baseline; min-height:0; }
      .lbl  { font-size:0.115in; color:#555; white-space:nowrap; line-height:1.1; font-weight:400; }
      .val  { font-weight:700; white-space:nowrap; overflow:hidden; line-height:1.05; min-width:0; }
      .span-val { grid-column: 2 / -1; }
      .hold-row { column-gap: 0.0425in; }  /* tighter label→value gap buys width for long holder names */
      .pill { display:inline-block; border:0.007in solid #555; border-radius:999in; padding:0.001in 0.035in; white-space:nowrap; line-height:1.15; }
      .lc-pill { border-radius: 0.04in; }
      .pocket-box { position:absolute; top:0.03in; right:0; width:0.35in; height:0.40in;
                    border:0.012in solid #000; border-radius:0 0.04in 0 0; box-sizing:border-box; }
      .pocket-p { position:absolute; top:0.01in; left:0.015in; font-size:0.115in; font-weight:700; line-height:1; }
      .tcode-box { display:inline-block; border:0.012in solid #555; border-radius:0.03in;
                   padding:0.01in 0.04in; font-weight:700; font-size:0.13in;
                   white-space:nowrap; flex-shrink:0; line-height:1.2; }
      .tt-desc { flex:1; overflow:hidden; white-space:nowrap; }
    `;
  }

  function renderToolTagLabel(fields) {
    const wIn  = (cfg.label?.widthIn  ?? 3.5);
    const hIn  = (cfg.label?.heightIn ?? 1.1);
    const tagW = (cfg.tag?.widthIn    ?? 2.2);
    const foot = (cfg.tag?.footerIn   ?? 0.25);

    const w = openPreviewWindow("Tool Tag") || window.open("", "_blank");
    const doc = w.document;
    const css = tagCSS(wIn, hIn, tagW, foot);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tool Tag</title><style>${css}</style></head>
      <body>${tagMarkup(fields, wIn, hIn, tagW, foot)}</body></html>`;
    doc.open(); doc.write(html); doc.close();

    const onReady = () => inchesAutoFit(doc, doc.querySelector(".label"));
    if (doc.readyState === "complete") w.requestAnimationFrame(()=>w.requestAnimationFrame(onReady));
    else w.addEventListener("load", () => w.requestAnimationFrame(()=>w.requestAnimationFrame(onReady)), { once:true });
  }

  function renderToolTagsBatch(list, autoPrint = true) {
    const wIn  = (cfg.label?.widthIn  ?? 3.5);
    const hIn  = (cfg.label?.heightIn ?? 1.1);
    const tagW = (cfg.tag?.widthIn    ?? 2.2);
    const foot = (cfg.tag?.footerIn   ?? 0.25);

    const w = openPreviewWindow("Tool Tags") || window.open("", "_blank");
    const doc = w.document;
    const css = tagCSS(wIn, hIn, tagW, foot);
    const body = list.map(f => tagMarkup(f, wIn, hIn, tagW, foot)).join("\n");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tool Tags</title><style>${css}</style></head><body>${body}</body></html>`;
    doc.open(); doc.write(html); doc.close();

    const onReady = () => {
      doc.querySelectorAll(".label").forEach(label => inchesAutoFit(doc, label));
      if (autoPrint) { w.focus(); setTimeout(() => w.print(), 200); }
    };
    if (doc.readyState === "complete") w.requestAnimationFrame(()=>w.requestAnimationFrame(onReady));
    else w.addEventListener("load", () => w.requestAnimationFrame(()=>w.requestAnimationFrame(onReady)), { once:true });
  }

// ----------------- CALIBRATION TAG -----------------
  function extractCalFields() {
    const bodyText = document.body.innerText || "";
    const toolMatch = bodyText.match(/Internal\s+Tool\s+#\s*:?\s*[\t ]+([^\n\t]+)/);
    const locMatch  = bodyText.match(/Location\s*:([^\n\t]+)/);
    const ToolNo    = toolMatch ? toolMatch[1].trim() : "";
    const Location  = locMatch  ? locMatch[1].trim()  : "";
    const pageURL   = location.href.replace(/\$$/, "");
    return { ToolNo, Location, pageURL };
  }

  function renderCalLabel(fields) {
    const widthIn = 3.5, heightIn = 1.1;
    const w = window.open("about:blank", "_blank", "width=800,height=400,scrollbars=yes,resizable=yes");
    if (!w) { alert("Pop-up blocked — please allow pop-ups for this site and try again."); return; }
    const doc = w.document;

    const css = `
      @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .cal-wrap {
        width: ${widthIn}in; height: ${heightIn}in;
        box-sizing: border-box;
        padding: 0.09in 0.12in;
        display: flex; flex-direction: column; justify-content: center; gap: 0.05in;
        font-family: Arial, sans-serif;
      }
      .cal-tool {
        font-size: 0.28in; font-weight: 900; line-height: 1.1;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cal-location {
        font-size: 0.14in; font-weight: 500; color: #333;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cal-url {
        font-size: 0.08in; color: #666;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cal-label-prefix {
        font-size: 0.09in; font-weight: 400; color: #777;
        text-transform: uppercase; letter-spacing: 0.01in;
      }
    `;

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
      <div class="cal-wrap">
        <div>
          <div class="cal-label-prefix">Internal Tool</div>
          <div class="cal-tool">${esc(fields.ToolNo || "\u2014")}</div>
        </div>
        ${fields.Location ? `<div>
          <div class="cal-label-prefix">Location</div>
          <div class="cal-location">${esc(fields.Location)}</div>
        </div>` : ""}
        <div class="cal-url">${esc(fields.pageURL)}</div>
      </div>
    </body></html>`;

    doc.open(); doc.write(html); doc.close();
  }
const btn = document.createElement("button");
btn.id = "apw-print-multipage-label-btn";
btn.textContent = (cfg.button?.text) ??
  (isSeq ? "Print Tool Tag(s)" :
   isFix ? "Print Fixture Label" :
   isCots ? "Print COTS Label" :
   isWork ? "Print Work Order Label" :
   isNCR  ? "Print NCR Label" :
   isCal  ? "Print Cal Tag" :
   "Print Storage Label");

Object.assign(btn.style, {
  position: "fixed",
  zIndex: 2147483647,
  padding: "10px 14px",
  fontSize: "14px",
  fontFamily: "Arial, sans-serif",
  background: "#111",
  color: "#fff",
  border: "1px solid #444",
  borderRadius: "10px",
  boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
  cursor: "pointer",
  right: cfg.button?.position?.right || "150px",
  bottom: cfg.button?.position?.bottom || "18px",
});
btn.addEventListener("mouseenter", () => (btn.style.background = "#222"));
btn.addEventListener("mouseleave", () => (btn.style.background = "#111"));

// Prevent initial flash on disallowed pages:
btn.style.display = 'none';

document.documentElement.appendChild(btn);

btn.addEventListener("click", async () => {
  try {
    if (isSeq) {
      const origText = btn.textContent;
      let dotCount = 1;
      btn.textContent = "Printing tags.";
      btn.disabled = true;
      btn.style.cursor = "default";
      const loadingInterval = setInterval(() => {
        dotCount = dotCount < 5 ? dotCount + 1 : 1;
        btn.textContent = "Printing tags" + ".".repeat(dotCount);
      }, 400);
      try {
        const toolsRaw = await extractSequenceTools();
        const tools = dedupeToolsByTCode(toolsRaw)
          .filter(t => (t.TCode && t.TCode.trim()) || (t.ToolNo && t.ToolNo.trim()));
        if (!tools.length) { alert("No tools found on this Sequence page."); return; }
        renderToolTagsBatch(tools, true);
      } finally {
        clearInterval(loadingInterval);
        btn.textContent = origText;
        btn.disabled = false;
        btn.style.cursor = "pointer";
      }
      return;
    }

    if (isNCR) {
      const f = extractNCRFields(); renderNCRLabel(f); return;
    }

    if (isCal) {
      const f = extractCalFields(); renderCalLabel(f); return;
    }

    if (isFix) {
      const f = extractFixtureFields(); renderFixtureLabel(f); return;
    }

    if (isCots) {
      const f = extractCotsFields();
      if (!f) return; // user cancelled
      renderCotsLabel(f);
      return;
    }

    if (isWork) {
      const f = await extractWorkOrderFields(); // must await
      renderWorkOrderLabel(f);
      return;
    }

    // default: Tool page
    const f = extractToolFields(); renderToolLabel(f);
  } catch (err) {
    console.error("Print action failed:", err);
    alert("Sorry — something went wrong building the label.");
  }
});

// --- Visibility control & print hiding ---

// Allow only these pages: Tools, COTS, Work Orders, Fixtures or a Sequence table
function isAllowedPage() {
  if (/\/procnc\/(tools|ots|workorders|fixtures|nonconformancereports|equipment)\//i.test(location.pathname)) return true;
  // sequence detail: rely on the table detector (function declaration is hoisted)
  return !!findSequenceTable();
}

// Hide the button in print preview/print output
const apwPrintStyle = document.createElement('style');
apwPrintStyle.textContent = `
  @media print { #apw-print-multipage-label-btn { display: none !important; } }
`;
(document.head || document.documentElement).appendChild(apwPrintStyle);

// Show/hide button based on current route
function updateBtnVisibility() {
  if (!btn) return;
  btn.style.display = isAllowedPage() ? 'inline-block' : 'none';
}

// Initial state
updateBtnVisibility();

// React to SPA route changes
let apwLastHref = location.href;

// Patch history API to notice pushState/replaceState
['pushState','replaceState'].forEach(fn => {
  const orig = history[fn];
  history[fn] = function() {
    const ret = orig.apply(this, arguments);
    setTimeout(() => {
      if (location.href !== apwLastHref) {
        apwLastHref = location.href;
        updateBtnVisibility();
      }
    }, 0);
    return ret;
  };
});

// Back/forward
window.addEventListener('popstate', () => {
  if (location.href !== apwLastHref) {
    apwLastHref = location.href;
    updateBtnVisibility();
  }
});

// Fallback: DOM churn that often accompanies route swaps
new MutationObserver(() => {
  if (location.href !== apwLastHref) {
    apwLastHref = location.href;
    updateBtnVisibility();
  }
}).observe(document, { childList: true, subtree: true });

// Also hide during print programmatically (extra belt-and-suspenders)
window.addEventListener('beforeprint', () => { if (btn) btn.style.display = 'none'; });
window.addEventListener('afterprint',  () => updateBtnVisibility());




})();
