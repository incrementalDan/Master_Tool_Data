// Tool lifecycle status — Active / Retired / Beta. Framework-free, like
// toolIdSystem.js and locationSystem.js.
//
// ⚠️ ACTIVE IS THE DEFAULT AND THE ABSENCE OF AN ANSWER. Every tool that
// predates this field, and every blank ProShop Status cell (40 of the shop's
// 310 real rows), is Active — so `statusOf` never returns null and nothing has
// to be migrated. That also means the app cannot tell "nobody has said" from
// "somebody said Active", which is why the ProShop import treats Status as
// authoritative rather than fill-gap-else-flag (same reasoning as
// center_cutting).

export const TOOL_STATUSES = [
  {
    id: 'active',
    label: 'Active',
    // What ProShop's `Status` column holds. Measured on the shop's real export:
    // Active (270) / blank (40) / Archived (1).
    proShopValue: 'Active',
    color: 'var(--green)',
    tip: 'In service — the normal state.',
  },
  {
    id: 'beta',
    label: 'Beta',
    // ⚠️ NULL, NOT A BLANK CELL. A beta tool is one the shop is trying in CAM
    // and may never buy, so it has no business in ProShop's inventory at all —
    // its row is omitted from the export entirely. A blank Status cell would
    // NOT do: blank reads back as Active (the rule above), so exporting one
    // would quietly promote every beta tool on the next import.
    proShopValue: null,
    color: 'var(--blue)',
    tip: 'Being trialled in CAM — not bought, and deliberately not exported to ProShop.',
  },
  {
    id: 'retired',
    label: 'Retired',
    proShopValue: 'Archived',
    color: 'var(--text-sub)',
    tip: 'Out of service. Its replacement, if there is one, is named beside it.',
  },
];

const BY_ID = new Map(TOOL_STATUSES.map(s => [s.id, s]));

export const DEFAULT_TOOL_STATUS = 'active';

// What the library shows before anyone touches the filter. Retired is left OUT:
// it is still in the library and still findable, it just isn't in the way of
// everyday work. Beta IS shown — a tool being trialled is a tool you are
// actively working with.
export const DEFAULT_VISIBLE_STATUSES = ['active', 'beta'];

// The status of a tool. Anything unrecognised — including absent — is Active.
export function statusOf(tool) {
  const s = tool?.tool_status;
  return BY_ID.has(s) ? s : DEFAULT_TOOL_STATUS;
}

export function statusMeta(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_TOOL_STATUS);
}

export const isBeta = (tool) => statusOf(tool) === 'beta';
export const isRetired = (tool) => statusOf(tool) === 'retired';

// ⚠️ A BETA TOOL IS NOT EXPORTED TO PROSHOP AT ALL — see the note above.
export const exportsToProShop = (tool) => statusOf(tool) !== 'beta';

// The value written to ProShop's `Status` column. Null for a tool that isn't
// exported at all (the caller should already have skipped it).
export function proShopStatusValue(tool) {
  return statusMeta(statusOf(tool)).proShopValue;
}

// Read ProShop's `Status` back. Blank is ACTIVE, not unknown — that is what 40
// of the shop's real rows hold. Anything else unrecognised is Active too: a
// status word nobody in the app understands is not evidence a tool is retired.
export function statusFromProShop(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return DEFAULT_TOOL_STATUS;
  if (v === 'archived' || v === 'retired' || v === 'inactive' || v === 'obsolete') return 'retired';
  return DEFAULT_TOOL_STATUS;
}

// ── The BETA description suffix ──────────────────────────────────────────────
// Every tool is created in the app, so its FIRST description is generated — and
// for a beta tool that generated name carries the marker. Nothing ever rewrites
// a stored description on its own (see "never silently renamed"): switching to
// Active surfaces a prompt to drop the suffix, it does not drop it.
export const BETA_SUFFIX = 'BETA';

const BETA_RE = /\s*\bBETA\b\s*$/i;

export const hasBetaSuffix = (desc) => BETA_RE.test(String(desc || ''));

export function withBetaSuffix(desc) {
  const d = String(desc || '').trim();
  if (!d || hasBetaSuffix(d)) return d;
  return `${d} ${BETA_SUFFIX}`;
}

export function stripBetaSuffix(desc) {
  return String(desc || '').replace(BETA_RE, '').trim();
}

// The description is stale w.r.t. the status when it says BETA and the tool
// isn't beta any more. The opposite case (beta with no marker) is NOT flagged:
// a hand-typed name is the user's, and the marker is only ever offered.
export const betaSuffixStale = (tool) =>
  !isBeta(tool) && hasBetaSuffix(tool?.description);
