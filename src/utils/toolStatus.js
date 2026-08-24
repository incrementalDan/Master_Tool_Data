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

// Every status — i.e. "filter nothing". Used where a count has been ADVERTISED
// and the list has to match it exactly (the library-wide flagged banner), so a
// hidden retired tool can't make the page show fewer than the number clicked.
export const ALL_TOOL_STATUSES = TOOL_STATUSES.map(s => s.id);

// Is the chip selection the default one? ⚠️ Compared as a SET, never by length —
// turning Beta off and Retired on leaves the length at 2 while being a very
// different filter, and a length check would call that "no filters set".
export function isDefaultStatusSelection(statuses) {
  const a = new Set(statuses || []);
  return a.size === DEFAULT_VISIBLE_STATUSES.length
    && DEFAULT_VISIBLE_STATUSES.every(id => a.has(id));
}

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

// ── Status markers in the description ────────────────────────────────────────
// Fusion has nowhere to put a status, and the description is the ONE field a
// programmer reads when picking tools for a new job. So the status rides in the
// description — deliberately at the END, so it never disturbs the name itself.
//
// ⚠️ The two markers follow DIFFERENT rules, on purpose:
//
//   BETA     — OFFERED. It rides along with the GENERATED name (every tool is
//              created in this app, so its first description is generated) and
//              with an explicit Beta toggle. Nothing ever strips it on the app's
//              say-so; switching off Beta raises a prompt.
//   RETIRED  — ENFORCED, and pushed to Fusion automatically. An explicit
//              exception to "descriptions are never silently renamed", granted
//              because the whole point is that a programmer in FUSION — who
//              cannot see this app — must know not to pick the tool. The shop
//              keeps running retired tools on already-programmed jobs, so the
//              marker is what stops one being chosen for a NEW job.
//
// Both are pure functions of `tool_status`, so both are re-derivable and
// therefore safe to add and remove — a stale marker is impossible by
// construction rather than by discipline.
export const BETA_SUFFIX = 'BETA';
export const RETIRED_SUFFIX = 'RETIRED';

const SUFFIX_BY_STATUS = { beta: BETA_SUFFIX, retired: RETIRED_SUFFIX };

// Matches ONLY at the end, so a tool genuinely named "BETA GRADE EM" or
// "RETIRED SERIES ROUGHER" is never mangled.
const endRe = (word) => new RegExp(`\\s*\\b${word}\\b\\s*$`, 'i');
const BETA_RE = endRe(BETA_SUFFIX);
const RETIRED_RE = endRe(RETIRED_SUFFIX);

export const hasBetaSuffix = (desc) => BETA_RE.test(String(desc || ''));
export const hasRetiredSuffix = (desc) => RETIRED_RE.test(String(desc || ''));

const addSuffix = (desc, word) => {
  const d = String(desc || '').trim();
  if (!d || endRe(word).test(d)) return d;
  return `${d} ${word}`;
};

export const withBetaSuffix = (desc) => addSuffix(desc, BETA_SUFFIX);
export const withRetiredSuffix = (desc) => addSuffix(desc, RETIRED_SUFFIX);

export const stripBetaSuffix = (desc) => String(desc || '').replace(BETA_RE, '').trim();
export const stripRetiredSuffix = (desc) => String(desc || '').replace(RETIRED_RE, '').trim();

// Every status marker off the end. Repeated so "1/2 EM BETA RETIRED" reduces
// cleanly — a tool can only be in one state, so at most one marker is right.
export function stripStatusSuffixes(desc) {
  let out = String(desc || '').trim();
  for (let i = 0; i < 3; i += 1) {
    const next = stripRetiredSuffix(stripBetaSuffix(out));
    if (next === out) break;
    out = next;
  }
  return out;
}

// The description a tool of this status should carry: exactly its own marker,
// and no other. Used by buildDesc (generated names) and by the status toggle.
export function applyStatusSuffix(desc, status) {
  const word = SUFFIX_BY_STATUS[status];
  const bare = stripStatusSuffixes(desc);
  return word ? addSuffix(bare, word) : bare;
}

// ⚠️ THE WRITE-TIME INVARIANT — retired only. A retired tool's description
// carries RETIRED, and a tool that is NOT retired does not. Enforced on every
// save (see splitToFusionInstances' callers) so the marker reaches Fusion by
// itself, and so un-retiring takes it away again without anyone remembering to.
// BETA is deliberately NOT enforced here: it is offered, and removing it is the
// user's call (see the prompt in ToolForm).
export function withRetiredMarker(tool) {
  if (!tool || typeof tool.description !== 'string') return tool;
  const want = isRetired(tool)
    ? withRetiredSuffix(tool.description)
    : stripRetiredSuffix(tool.description);
  // Same reference when nothing changes — callers use identity to decide
  // whether there is anything to persist (the syncPresetMaterialName rule).
  return want === tool.description ? tool : { ...tool, description: want };
}

// The BETA marker outlived the status. The opposite case (beta with no marker)
// is NOT flagged: a hand-typed name is the user's, and the marker is only ever
// offered. Retired needs no equivalent — it is enforced, not prompted.
export const betaSuffixStale = (tool) =>
  !isBeta(tool) && hasBetaSuffix(tool?.description);
