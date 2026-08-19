// Tool tag printing — the DK-11201 tag layout, ported from the shop's ProShop
// Chrome extension (docs/proshop_brother_label_extension_v9/content.js:
// tagCSS / tagMarkup / inchesAutoFit / renderToolTagsBatch).
//
// ⚠️ THE LAYOUT IS COPIED, NOT REDESIGNED. These labels are already printed,
// read and trusted on the shop floor; the geometry is tuned to a physical label
// on a physical printer (the 0.04/0.02in nudge exists because the tag clipped
// without it). The only change is the data source: ToolDex's stored Sequence
// Detail instead of scraping the ProShop DOM.
//
// Everything is sized in INCHES, including the auto-fit, because the output is
// a physical label — a px-based fit would drift with the browser's zoom.

export const LABEL = { widthIn: 3.5, heightIn: 1.1 };   // DK-11201
export const TAG = { widthIn: 2.2, footerIn: 0.25 };    // tag area + footer band
export const PRINT_OFFSET = { leftIn: 0.04, topIn: 0.02 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function tagMarkup(fields) {
  const part = esc(fields.PartNumber || '');
  const tcode = esc(fields.TCode || '');
  const tool = esc(fields.ToolNo || '');
  const desc = esc(fields.Description || '');
  const holder = esc(fields.Holder || '');
  const ooh = esc(fields.OOH || '');
  const loc = esc(fields.Location || '');
  const rta = esc(fields.RTA || '');

  return `
      <div class="label">
        <div class="wrap">
          <div class="tag">
            <div class="pocket-box"><span class="pocket-p">P</span></div>
            <div class="main">
              <div class="line tt-part clear-pocket">${part}</div>
              <div class="data-row clear-pocket">
                <span class="lbl">Tool</span><span class="val tt-tool-val"><span class="pill">${tool}</span></span>
                <span class="lbl">RTA</span><span class="val tt-rta-val">${rta ? `<span class="pill">${rta}</span>` : ''}</span>
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

export function tagCSS({
  wIn = LABEL.widthIn, hIn = LABEL.heightIn,
  tagW = TAG.widthIn, foot = TAG.footerIn,
  offL = PRINT_OFFSET.leftIn, offT = PRINT_OFFSET.topIn,
} = {}) {
  return `
      @page { size: ${wIn}in ${hIn}in; margin: 0; }
      html, body { margin:0; padding:0; font-family: Arial, sans-serif; background:#fff; color:#000; }
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

// Shrink each line until it fits its box, then ellipsize as a last resort.
// Ported unchanged — the thresholds are the ones tuned against real tags.
export function inchesAutoFit(winDoc, root) {
  const get = (sel) => root.querySelector(sel);
  const main = get('.main');

  const targets = [
    { sel: '.tt-part', hi: 0.18, lo: 0.10 },
    { sel: '.tt-tool-val', hi: 0.14, lo: 0.08 },
    { sel: '.tt-rta-val', hi: 0.13, lo: 0.08 },
    { sel: '.tt-hold-val', hi: 0.14, lo: 0.08 },
    { sel: '.tt-ooh-val', hi: 0.13, lo: 0.08 },
    { sel: '.tt-lc-val', hi: 0.13, lo: 0.08 },
    { sel: '.tt-tcode', hi: 0.14, lo: 0.10 },
  ];

  function fitLineIn(el, hi, lo) {
    if (!el) return;
    let size = hi;
    el.style.fontSize = size + 'in';
    for (let i = 0; i < 220 && el.scrollWidth > el.clientWidth && size > lo; i++) {
      size -= 0.01;
      el.style.fontSize = size + 'in';
    }
    if (el.scrollWidth > el.clientWidth) {
      let t = el.textContent || '';
      while (t.length && el.scrollWidth > el.clientWidth) {
        t = t.slice(0, -1);
        el.textContent = t + '…';
      }
    }
  }

  targets.forEach(t => fitLineIn(get(t.sel), t.hi, t.lo));

  if (main && main.scrollHeight > main.clientHeight) {
    const valEls = ['.tt-part', '.tt-tool-val', '.tt-rta-val', '.tt-hold-val', '.tt-ooh-val', '.tt-lc-val'].map(get).filter(Boolean);
    const lblEls = [...root.querySelectorAll('.lbl')];
    const allEls = [...valEls, ...lblEls];
    const scale = Math.max(0.7, main.clientHeight / main.scrollHeight);
    allEls.forEach(el => {
      const px = parseFloat(winDoc.defaultView.getComputedStyle(el).fontSize);
      el.style.fontSize = Math.max(8, Math.floor(px * scale)) + 'px';
    });
  }

  // Footer description: shrink single-line first, then wrap to 2 lines, then clamp.
  const descEl = get('.tt-desc');
  if (descEl) {
    const hiIn = 0.135, midIn = 0.09, loIn = 0.08;

    // Phase 1 — single line, shrink from hi down to mid.
    // overflow:hidden is required for scrollWidth to report content width.
    descEl.style.whiteSpace = 'nowrap';
    descEl.style.overflow = 'hidden';
    descEl.style.display = 'block';
    descEl.style.webkitLineClamp = 'unset';
    let dSize = hiIn;
    descEl.style.fontSize = dSize + 'in';
    for (let i = 0; i < 200 && descEl.scrollWidth > descEl.clientWidth && dSize > midIn; i++) {
      dSize -= 0.005;
      descEl.style.fontSize = dSize + 'in';
    }

    if (descEl.scrollWidth > descEl.clientWidth) {
      // Phase 2 — allow wrapping, shrink until it fits in 2 lines.
      descEl.style.whiteSpace = 'normal';
      for (let i = 0; i < 200 && dSize > loIn; i++) {
        descEl.style.fontSize = dSize + 'in';
        let lh = parseFloat(winDoc.defaultView.getComputedStyle(descEl).lineHeight);
        if (!isFinite(lh)) lh = parseFloat(winDoc.defaultView.getComputedStyle(descEl).fontSize) * 1.2;
        if (descEl.scrollHeight <= lh * 2.2) break;
        dSize -= 0.005;
      }
      descEl.style.display = '-webkit-box';
      descEl.style.webkitBoxOrient = 'vertical';
      descEl.style.webkitLineClamp = '2';
    }
  }
}

// Open a print window holding one page per label and fire the print dialog.
// Returns false when the browser blocked the popup, so the caller can say so
// rather than leaving the user staring at nothing.
// Open the print window NOW, to be filled in later.
//
// ⚠️ A popup only opens while the browser still considers itself inside the
// user's click. Anything awaited first — re-checking Drive, pulling a newer
// posted file — ends that, and window.open is then blocked. So a caller that
// has async work to do opens the window here, in the click handler, and hands
// it to printToolTags once the labels are ready. Without this, guarding against
// stale labels would just trade one broken print for another.
export function openTagWindow() {
  return window.open('', '_blank');
}

export function printToolTags(list, { autoPrint = true, win = null } = {}) {
  const empty = !list || list.length === 0;
  // A window we were handed has nothing to show — close it rather than leaving
  // a blank tab behind.
  if (empty) { if (win) win.close(); return false; }
  const w = win || window.open('', '_blank');
  if (!w) return false;

  const css = tagCSS();
  const body = list.map(tagMarkup).join('\n');
  const doc = w.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Tool Tags</title><style>${css}</style></head><body>${body}</body></html>`);
  doc.close();

  const onReady = () => {
    doc.querySelectorAll('.label').forEach(label => inchesAutoFit(doc, label));
    if (autoPrint) { w.focus(); setTimeout(() => w.print(), 200); }
  };
  // Two rAFs: the fit measures scrollWidth, which is only meaningful once the
  // written document has actually laid out.
  if (doc.readyState === 'complete') w.requestAnimationFrame(() => w.requestAnimationFrame(onReady));
  else w.addEventListener('load', () => w.requestAnimationFrame(() => w.requestAnimationFrame(onReady)), { once: true });
  return true;
}
