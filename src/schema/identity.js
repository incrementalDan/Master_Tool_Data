// Identity & numbering: internal UUIDs, tracking IDs (the logical-tool family
// key), family signatures, machine tool numbers, and the raw-Fusion readers/
// writers for those values. Dependency root of the schema modules — imports
// nothing from its siblings.

// ─── ID generation ─────────────────────────────────────────────────────────
export function generateId() {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${(Math.floor(Math.random() * 4) + 8).toString(16)}${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

export const generateAssemblyId = generateId;

// Strip the single/double quotes Fusion wraps around expression string values.
export function stripQuotes(s) {
  if (!s) return '';
  return s.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}

// ─── Tracking ID (logical-tool family key) ─────────────────────────────────
// One logical tool maps to N Fusion library instances (one per assembly). All
// instances of a logical tool carry the same tracking ID, written into Fusion's
// native `tool_comment` field so the grouping survives without this app or the
// metadata file. Format: "FTL-" + 6 uppercase hex.
const TRACKING_ID_RE = /^FTL-[0-9A-F]{4,}$/i;

export function generateTrackingId() {
  const hex = Math.floor(Math.random() * 0x1000000).toString(16).toUpperCase().padStart(6, '0');
  return `FTL-${hex}`;
}

// Read a tracking ID from a raw Fusion tool. Only accepts the FTL- pattern so a
// stray legacy value (e.g. an old ProShop RTA#) in tool_comment is ignored.
export function readTrackingId(fTool) {
  // Fusion stores the comment in post-process.comment (plain) and mirrors it in
  // expressions.tool_comment (quoted). Check both.
  const raw = stripQuotes(
    fTool?.['post-process']?.comment ||
    fTool?.expressions?.tool_comment ||
    fTool?.tool_comment ||
    ''
  );
  return TRACKING_ID_RE.test(raw) ? raw.toUpperCase() : null;
}

// Read the OOH (stick-out) from a raw Fusion tool. Source of truth is
// geometry.LB (Body Length / "Length below Holder"), stored in the tool's own
// unit — returned raw in that unit (like all other geometry).
export function readOohFromFusion(fTool) {
  const lb = fTool?.geometry?.LB;
  if (lb === null || lb === undefined || lb === '') return null;
  const v = Number(lb);
  if (isNaN(v)) return null;
  return v;
}

export function round4(n) {
  const v = Number(n);
  return isNaN(v) ? 0 : Math.round(v * 10000) / 10000;
}

// Family signature for validating a tracking-ID group and for matching incoming
// job tools: ProShop ID + tool type + cut diameter (4-decimal tolerance).
export function familySignature(tool) {
  const pid = String(tool.tool_id || tool['product-id'] || '').trim();
  const type = tool.tool_type || tool.type || '';
  const dia = round4(tool.diameter ?? tool.geometry?.DC);
  return `${pid}|${type}|${dia}`;
}

// Group a raw Fusion library array into logical-tool groups keyed by tracking
// ID. Entries without a valid tracking ID are returned separately (each is its
// own single-instance logical tool until normalized).
export function groupByTrackingId(fusionList) {
  const groups = new Map(); // tracking_id -> [rawInstance, ...]
  const untracked = [];     // raw instances with no tracking ID
  for (const f of (fusionList || [])) {
    const tid = readTrackingId(f);
    if (tid) {
      if (!groups.has(tid)) groups.set(tid, []);
      groups.get(tid).push(f);
    } else {
      untracked.push(f);
    }
  }
  return { groups, untracked };
}

// ─── Machine tool numbers ─────────────────────────────────────────────────
// The machine tool number is what the CNC machine reads to call a tool
// (`post-process.number` in the Fusion JSON). It is completely separate from
// the internal `id` and the ProShop `product-id`. Numbers start at 30 and skip
// the reserved set below, which is held back for machine-specific use.
// `start`/`skip` default to these but can be overridden from shop_settings.json.
export const RESERVED_MACHINE_NUMBERS = [98, 99, 100];
export const DEFAULT_MACHINE_START = 30;

// Generate a full sequence of machine tool numbers for a renumber/import.
// Starts at `start`, increments by 1, skips the `skip` numbers entirely.
// e.g. 250 tools → [30, 31, ..., 97, 101, 102, ...]
export function generateMachineNumbers(toolCount, start = DEFAULT_MACHINE_START, skip = RESERVED_MACHINE_NUMBERS) {
  const skipSet = new Set(skip);
  const numbers = [];
  let next = start;
  while (numbers.length < toolCount) {
    if (!skipSet.has(next)) numbers.push(next);
    next++;
  }
  return numbers;
}

// Find the next available machine tool number given the numbers already in use.
// Skips both used numbers and the `skip` set.
export function getNextMachineNumber(existingNumbers, start = DEFAULT_MACHINE_START, skip = RESERVED_MACHINE_NUMBERS) {
  const used = new Set((existingNumbers || []).map(Number).filter(n => !isNaN(n)));
  const skipSet = new Set(skip);
  let next = start;
  while (used.has(next) || skipSet.has(next)) next++;
  return next;
}

// Enforce unique machine tool numbers on import/normalize. Machine tool numbers
// must be unique library-wide, but a tool uploaded into Fusion can carry its own
// `post-process.number` that collides with a tool already in the app OR sits on a
// number the shop treats as unavailable. Given the tool's desired number and the
// set already in use, this returns the number to actually use plus the original if
// it had to be reassigned. A number is reassigned (to the next free one) when it
// is already used, is a **reserved/skip** number, or is **below the start** — the
// start and reserved numbers are treated as "already assigned" (the shop pretends
// they're taken), so e.g. a Fusion tool coming in as T2 when the start is T30, or
// on a reserved T99, is reassigned rather than accepted. A null/blank number is
// left null (a tool need not have one) and never treated as a collision. The
// chosen number is NOT added to `used` here — the caller threads the running set
// across every tool.
export function resolveMachineNumberCollision(desired, used, start = DEFAULT_MACHINE_START, skip = RESERVED_MACHINE_NUMBERS) {
  if (desired == null || desired === '' || isNaN(Number(desired))) {
    return { number: null, reassignedFrom: null };
  }
  const n = Number(desired);
  const usedSet = used instanceof Set ? used : new Set((used || []).map(Number));
  const skipSet = skip instanceof Set ? skip : new Set((skip || []).map(Number));
  const startNum = Number(start);
  const belowStart = Number.isFinite(startNum) && n < startNum;
  if (!usedSet.has(n) && !skipSet.has(n) && !belowStart) {
    return { number: n, reassignedFrom: null };
  }
  return { number: getNextMachineNumber([...usedSet], start, skip), reassignedFrom: n };
}

// Find machine tool numbers used by more than one logical tool. Read-only — the
// background detector behind the Settings "fix duplicates" action. Groups tools by
// their machine_tool_number (nulls/blanks ignored — a tool need not have one) and
// returns only the numbers shared by 2+ tools, sorted ascending:
//   [{ number, tools: [tool, ...] }]. Excluded-tool filtering is the caller's job.
export function findDuplicateMachineNumbers(tools) {
  const byNum = new Map();
  for (const t of (tools || [])) {
    const n = t?.machine_tool_number;
    if (n == null || n === '' || isNaN(Number(n))) continue;
    const key = Number(n);
    if (!byNum.has(key)) byNum.set(key, []);
    byNum.get(key).push(t);
  }
  const out = [];
  for (const [number, group] of byNum) if (group.length > 1) out.push({ number, tools: group });
  return out.sort((a, b) => a.number - b.number);
}

// Tools whose machine number a library SWEEP would reassign — the broader
// companion to findDuplicateMachineNumbers. A number is "to fix" when it is a
// DUPLICATE (2nd+ tool on it), a RESERVED/skip number, or BELOW the start:
// reserved + start numbers are treated as already assigned (the shop pretends
// they're taken), matching resolveMachineNumberCollision's import-time rule.
// Returns the flagged tools in library order:
//   [{ tool, number, reason: 'duplicate' | 'reserved' | 'belowStart' }]
// Nulls/blanks are ignored (a tool need not have a number). Excluded-tool
// filtering is the caller's job.
export function findMachineNumbersToFix(tools, start = DEFAULT_MACHINE_START, skip = RESERVED_MACHINE_NUMBERS) {
  const startNum = Number(start);
  const skipSet = new Set((skip || []).map(Number));
  const seen = new Set();
  const out = [];
  for (const t of (tools || [])) {
    const n = t?.machine_tool_number;
    if (n == null || n === '' || isNaN(Number(n))) continue;
    const num = Number(n);
    const reserved = skipSet.has(num);
    const belowStart = Number.isFinite(startNum) && num < startNum;
    const duplicate = seen.has(num);         // computed BEFORE claiming the slot
    if (!reserved && !belowStart) seen.add(num);  // only valid numbers claim a slot
    if (duplicate || reserved || belowStart) {
      out.push({ tool: t, number: num, reason: duplicate ? 'duplicate' : reserved ? 'reserved' : 'belowStart' });
    }
  }
  return out;
}

// Write a tool ID (ProShop number / generated shop ID) directly into a raw
// Fusion entry — the native `product-id` plus its paired expression. Mirrors
// the native+expression pairing internalToFusionTool uses for tool_productId.
// Used by the bulk "Assign IDs" action, which mutates raws in place.
export function applyToolIdToFusion(fTool, value) {
  const v = String(value ?? '');
  fTool['product-id'] = v;
  fTool.expressions = { ...(fTool.expressions || {}), tool_productId: `'${v}'` };
  return fTool;
}

// Write a machine tool number into a raw Fusion tool object. Always writes all
// three post-process fields (number / length-offset / diameter-offset) to the
// same value, and always writes the linked expression so Fusion's UI keeps the
// length offset tied to the tool number. Mutates and returns the object.
export function applyMachineNumberToFusion(fTool, number) {
  const n = parseInt(number);
  if (isNaN(n)) return fTool;
  fTool['post-process'] = {
    ...(fTool['post-process'] || {}),
    number: n,
    'length-offset': n,
    'diameter-offset': n,
  };
  fTool.expressions = {
    ...(fTool.expressions || {}),
    tool_number: String(n),
    tool_lengthOffset: 'tool_number',
  };
  return fTool;
}
