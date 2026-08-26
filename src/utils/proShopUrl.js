// The shop's ProShop tool page URL — a pure function of the ProShop Tool #
// ("A-25" → …/procnc/tools/A/A-25$). It is DERIVED, never stored as the link:
// the id is the record, the URL is composed from it (see "Relational integrity").
//
// Fusion has a native home for it (`product-link` / `expressions.tool_productLink`),
// and 90 of the shop's pre-TMS tools carry one — so a tool the app creates must
// carry it too, or the app is quietly the only place it isn't.
export const PROSHOP_TOOL_URL_BASE = 'https://americanprecisionworks.adionsystems.com/procnc/tools';

export function proShopToolUrl(toolId) {
  const id = (toolId || '').trim();
  // ⚠️ An INSERT tool's link is not a tool page at all — its combined id
  // ("I-167/ G-168") points at a ProShop RTA page (/procnc/rtas/2026/22$),
  // whose year+number we cannot compose. Composing a /tools/ URL from the
  // combined id would produce a confident dead link, so don't.
  if (!id || id.includes('/')) return null;
  const prefix = id.split('-')[0];
  return `${PROSHOP_TOOL_URL_BASE}/${prefix}/${id}$`;
}

// Does this URL already point at THIS tool's ProShop page? Measured against the
// shop's real library: 76 links are exactly our composed form and 11 are the same
// page carrying a pasted browser session tail ($hour=…&page=…&token=…) or no
// trailing "$" at all. Those are not wrong, so they must not be rewritten — the
// question is which TOOL the link points at, not how it is spelled.
export function proShopUrlPointsAt(url, toolId) {
  const id = (toolId || '').trim();
  if (!id || typeof url !== 'string') return false;
  const stem = `${PROSHOP_TOOL_URL_BASE}/${id.split('-')[0]}/${id}`;
  const u = url.trim();
  return u === stem || u.startsWith(`${stem}$`);
}

// What `product-link` should hold for this tool, or null for "leave it alone".
// ⚠️ In `proshop` ID mode the ProShop page WINS — it is the shop's own record of
// the tool, so it overwrites whatever else is in the field (most often a
// manufacturer product page pulled off a scanned spec sheet). The only no-op is a
// link that already points at this tool, however it is spelled: 11 real ones carry
// a pasted browser session tail and one has no trailing "$" — same page, not
// wrong, and rewriting them would be churn nobody asked for.
//
// Nothing is written at all when the URL can't be composed (a blank id, or a
// combined insert id whose page is an RTA), so an insert tool's real RTA link
// survives untouched. The caller gates this on the ID mode.
export function proShopLinkForWrite(toolId, currentLink) {
  const next = proShopToolUrl(toolId);
  if (!next) return null;
  if (proShopUrlPointsAt(currentLink, toolId)) return null;
  return next;
}
