// Location System — pure helpers for the configurable physical-location model
// stored in shop_settings.json under `location_config`.
//
// A shop can define multiple independent location *systems*. Each system is a
// Zone → Station → Drawer → Bin pattern where each upper level is optional and
// the Bin is always present (auto-incrementing or a fixed value). Levels carry
// `options[]` (stable-UUID entries) for number/letter identifiers; a `custom`
// identifier is a fixed prefix (e.g. "LC") with no per-tool choice.
//
// A tool stores only IDs (system + level option ids + bin number) in metadata —
// never the display string. The composed string is derived here on read, and is
// what gets written to Fusion's vendor field + ProShop's Location column.
//
// This module is framework-free (no React) so it can be called from AppContext,
// the ProShop import/export, and the Settings UI alike.

export const LEVEL_KEYS = ['zone', 'station', 'drawer'];

// ─── IDs ─────────────────────────────────────────────────────────────────────
export function genLocId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Factories ───────────────────────────────────────────────────────────────
function blankLevel(levelType, identFormat = 'number') {
  return { on: false, levelType, customTypeName: '', identFormat, customIdent: '', options: [] };
}

// A fresh, empty location system (matches the prototype's addSystem shape).
export function newLocationSystem(name = 'New System') {
  return {
    id: genLocId(),
    name,
    normalized: false,
    allowDuplicates: false,
    proShopExport: 'number_only',  // number_only | full | fixed
    fixedExport: '',
    delimiters: { zs: '-', sd: '-', db: '-' },
    levels: {
      zone:    blankLevel('Building', 'number'),
      station: blankLevel('Cabinet', 'number'),
      drawer:  blankLevel('Drawer', 'letter'),
      bin:     { fixed: false, start: 1000, fixedVal: '', skip: [] },
    },
  };
}

// A level option entry { id, label, order }.
export function newLevelOption(label, order) {
  return { id: genLocId(), label, order };
}

// ─── Lookups ─────────────────────────────────────────────────────────────────
export function findSystem(systems, id) {
  return (systems || []).find(s => s.id === id) || null;
}
export function levelOptions(system, levelKey) {
  return system?.levels?.[levelKey]?.options || [];
}
export function findOption(system, levelKey, optionId) {
  return levelOptions(system, levelKey).find(o => o.id === optionId) || null;
}
// The display name for a level (its custom type name or the chosen levelType).
export function levelTypeName(level) {
  if (!level) return '';
  return level.levelType === 'custom' ? (level.customTypeName || 'Custom') : level.levelType;
}

// ─── Composition ─────────────────────────────────────────────────────────────
// Delimiter between two adjacent active levels, keyed by their first letters
// (zs/sd/db). Non-adjacent junctions (a middle level is off) fall back to '-'.
function junctionDelim(delimiters, aKey, bKey) {
  const key = aKey[0] + bKey[0];
  const d = delimiters?.[key];
  return d == null ? '-' : d;
}

// The value of one configured level for a tool's stored location.
function segmentValue(system, levelKey, loc) {
  const level = system.levels[levelKey];
  if (!level || !level.on) return null;
  if (level.identFormat === 'custom') return level.customIdent || '';
  const opt = findOption(system, levelKey, loc?.[`${levelKey}_id`]);
  return opt ? opt.label : '';
}

// Build the composed location string from a tool's structured location + system.
// Order zone → station → drawer → bin, joined by the per-junction delimiters.
// Returns '' when there's nothing to show.
export function composeLocationString(loc, system) {
  if (!loc || !system) return '';
  const L = system.levels;
  const binVal = L.bin?.fixed
    ? (L.bin.fixedVal || '')
    : (loc.bin != null && loc.bin !== '' ? String(loc.bin) : '');
  const segs = [
    L.zone.on    ? { key: 'zone',    val: segmentValue(system, 'zone', loc) }    : null,
    L.station.on ? { key: 'station', val: segmentValue(system, 'station', loc) } : null,
    L.drawer.on  ? { key: 'drawer',  val: segmentValue(system, 'drawer', loc) }  : null,
    { key: 'bin', val: binVal },
  ].filter(Boolean);
  return segs
    .map((s, i) => (s.val ?? '') + (i < segs.length - 1 ? junctionDelim(system.delimiters, s.key, segs[i + 1].key) : ''))
    .join('');
}

// Config-editor preview using placeholder values (1/A for number/letter levels).
export function buildPreview(system) {
  const L = system.levels;
  const seg = (level, num, let_) => {
    if (!level.on) return null;
    if (level.identFormat === 'custom') return level.customIdent || '…';
    if (level.identFormat === 'letter') return let_;
    return num;
  };
  const binNum = L.bin.fixed ? (L.bin.fixedVal || '1000') : String(L.bin.start);
  const segs = [
    L.zone.on    ? { key: 'zone',    val: seg(L.zone, '1', 'A') }    : null,
    L.station.on ? { key: 'station', val: seg(L.station, '1', 'A') } : null,
    L.drawer.on  ? { key: 'drawer',  val: seg(L.drawer, '1', 'A') }  : null,
    { key: 'bin', val: binNum },
  ].filter(Boolean);
  const out = segs
    .map((s, i) => s.val + (i < segs.length - 1 ? junctionDelim(system.delimiters, s.key, segs[i + 1].key) : ''))
    .join('');
  return out || '—';
}

// ─── Duplicate-output detection ──────────────────────────────────────────────
// Two location systems "clash" when they could produce the same user-visible ID.
// This is checked on the composed OUTPUT recipe, not the settings labels: a
// level's *type name* (Drawer / Cabinet / custom type name) never appears in the
// string, so two systems that label their steps differently but emit the same
// segments still clash. Each segment is reduced to what actually shows:
//   • custom level   → its fixed prefix string
//   • number/letter  → the sorted SET of its option labels (the values that appear)
//   • bin            → the fixed value, or "auto#" (any auto numeric bin can overlap)
// Compared two ways: with the junction delimiters (exact-output identity) and
// without them (structural identity — catches "same except the delimiter").
const normTok = (s) => String(s ?? '').trim().toLowerCase();

function activeSegmentKeys(system) {
  const L = system.levels || {};
  const keys = LEVEL_KEYS.filter(k => L[k]?.on);
  keys.push('bin');
  return keys;
}

function segmentToken(system, key) {
  const L = system.levels;
  if (key === 'bin') return L.bin?.fixed ? `fixed:${normTok(L.bin.fixedVal)}` : 'auto#';
  const lvl = L[key];
  if (lvl.identFormat === 'custom') return `const:${normTok(lvl.customIdent)}`;
  const labels = (lvl.options || []).map(o => normTok(o.label)).filter(Boolean).sort();
  return `${lvl.identFormat}:[${labels.join(',')}]`;
}

// Output recipe including the junction delimiters — exact-output identity.
export function systemOutputSignature(system) {
  const keys = activeSegmentKeys(system);
  return keys
    .map((k, i) => `${k}=${segmentToken(system, k)}` + (i < keys.length - 1 ? `<${junctionDelim(system.delimiters, k, keys[i + 1])}>` : ''))
    .join('');
}

// Output recipe ignoring delimiters — structural identity (near-duplicate).
export function systemStructureSignature(system) {
  return activeSegmentKeys(system).map(k => `${k}=${segmentToken(system, k)}`).join('|');
}

// Find systems that clash. Returns Map(systemId -> conflict[]), each conflict
// { type, otherId, otherName }:
//   'output'    — could produce identical visible IDs (same recipe + delimiters)
//   'delimiter' — same recipe, only the delimiter differs (near-duplicate)
//   'name'      — same (case-insensitive) system name
// A non-blocking warning surfaces these in the UI.
export function findSystemConflicts(systems) {
  const list = systems || [];
  const out = new Map();
  const push = (id, c) => { if (!out.has(id)) out.set(id, []); out.get(id).push(c); };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const aName = normTok(a.name), bName = normTok(b.name);
      if (aName && aName === bName) {
        push(a.id, { type: 'name', otherId: b.id, otherName: b.name });
        push(b.id, { type: 'name', otherId: a.id, otherName: a.name });
      }
      if (systemOutputSignature(a) === systemOutputSignature(b)) {
        push(a.id, { type: 'output', otherId: b.id, otherName: b.name });
        push(b.id, { type: 'output', otherId: a.id, otherName: a.name });
      } else if (systemStructureSignature(a) === systemStructureSignature(b)) {
        push(a.id, { type: 'delimiter', otherId: b.id, otherName: b.name });
        push(b.id, { type: 'delimiter', otherId: a.id, otherName: a.name });
      }
    }
  }
  return out;
}

// Resolve the composed string for a tool given the whole systems list (looks up
// the tool's system by id). Falls back to '' when unresolvable.
export function resolveLocationString(loc, systems) {
  if (!loc?.system_id) return '';
  const system = findSystem(systems, loc.system_id);
  return system ? composeLocationString(loc, system) : '';
}

// ─── ProShop export mapping ──────────────────────────────────────────────────
// The composed string → the value written to ProShop's Location column.
export function proShopLocationValue(system, composed) {
  if (!system) return composed || '';
  switch (system.proShopExport) {
    case 'number_only': return (composed || '').replace(/[^0-9]/g, '');
    case 'fixed':       return system.fixedExport || '';
    case 'full':
    default:            return composed || '';
  }
}

// ─── Bin numbering ───────────────────────────────────────────────────────────
// Next available bin for an auto-increment system: ≥ start, not skipped, not used.
export function nextBin(system, usedBins = new Set()) {
  const bin = system?.levels?.bin;
  if (!bin || bin.fixed) return bin?.fixedVal || '';
  const skip = new Set((bin.skip || []).map(Number));
  const used = usedBins instanceof Set ? usedBins : new Set(usedBins);
  let n = Number(bin.start) || 1;
  while (skip.has(n) || used.has(n)) n++;
  return n;
}

// Bins already taken within a system across the library (numbers only).
export function usedBinsForSystem(tools, systemId) {
  const used = new Set();
  for (const t of tools || []) {
    const loc = t.tool_location;
    if (loc?.system_id === systemId && loc.bin != null && loc.bin !== '') {
      const n = Number(loc.bin);
      if (!Number.isNaN(n)) used.add(n);
    }
  }
  return used;
}

// ─── Normalization parsing ───────────────────────────────────────────────────
// Build a lenient regex that matches a free-text location against a system's
// pattern. Inter-segment separators are matched loosely (any run of space / dash
// / dot / slash / pipe / underscore) because legacy strings are inconsistent
// ("LC 84", "LC14", "LC -158"). Returns { regex, levelKeys } or null when the
// system can't be parsed (a number/letter level with no options to match).
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildParseRegex(system) {
  const L = system.levels;
  const parts = [];
  const capturedLevels = [];
  const SEP = '[\\s\\-._/|]*';
  for (const key of LEVEL_KEYS) {
    const level = L[key];
    if (!level.on) continue;
    if (parts.length) parts.push(SEP);
    if (level.identFormat === 'custom') {
      if (!level.customIdent) return null;
      // A custom prefix (e.g. "LC") carries no per-tool data — it's the same for
      // every tool at this level — so accept it as OPTIONAL when parsing. A bare
      // bin number like "140" (how ProShop stores a location) then parses to the
      // same bin as "LC-140". Without this, tools whose location is stored as just
      // the number are missed by normalization (they land in "unmatched", so their
      // bins aren't counted and the next-available bin is wildly wrong).
      parts.push('(?:' + escapeRe(level.customIdent) + ')?');
    } else {
      const opts = level.options || [];
      if (opts.length === 0) return null; // nothing to match this level against
      parts.push('(' + opts.map(o => escapeRe(o.label)).join('|') + ')');
      capturedLevels.push(key);
    }
  }
  // Bin: a fixed value is a literal; auto-increment captures a number.
  if (parts.length) parts.push(SEP);
  if (L.bin.fixed) {
    if (!L.bin.fixedVal) return null;
    parts.push(escapeRe(L.bin.fixedVal));
  } else {
    parts.push('(\\d+)');
    capturedLevels.push('bin');
  }
  return { regex: new RegExp('^\\s*' + parts.join('') + '\\s*$', 'i'), capturedLevels };
}

// Try to parse a single free-text location string against a system.
// On success returns a structured tool_location { system_id, …ids, bin }.
export function parseLocationString(str, system) {
  const text = (str || '').trim();
  if (!text) return null;
  const built = buildParseRegex(system);
  if (!built) return null;
  const m = text.match(built.regex);
  if (!m) return null;
  const loc = { system_id: system.id, zone_id: null, station_id: null, drawer_id: null, bin: null };
  built.capturedLevels.forEach((key, i) => {
    const captured = m[i + 1];
    if (key === 'bin') {
      loc.bin = Number(captured);
    } else {
      const opt = levelOptions(system, key).find(o => o.label.toLowerCase() === captured.toLowerCase());
      loc[`${key}_id`] = opt ? opt.id : null;
    }
  });
  return loc;
}

// ─── Analysis (read-only) ────────────────────────────────────────────────────
// Scan the library for tools that could be assigned to `system`. A tool is a
// candidate when it is not already assigned to this system. Returns matched
// (with the parsed structured location), unmatched (had location text but no
// parse), a noLocation count, and the next available bin after the matches.
export function analyzeSystem(tools, system) {
  const matched = [];
  const unmatched = [];
  let noLocation = 0;
  const used = usedBinsForSystem(tools, system.id);

  for (const tool of tools || []) {
    if (tool.tool_location?.system_id === system.id) continue; // already in this system
    const text = (tool.location || '').trim();
    if (!text) { noLocation++; continue; }
    const parsed = parseLocationString(text, system);
    if (parsed) {
      if (parsed.bin != null) used.add(Number(parsed.bin));
      matched.push({ tool, location: parsed, previous: text });
    } else {
      unmatched.push({ tool, location: text });
    }
  }
  const binCfg = system.levels.bin;
  const next = binCfg.fixed ? null : nextBin(system, used);
  return { matched, unmatched, noLocation, nextBin: next };
}

// ─── Library-wide status (across all normalized systems) ─────────────────────
// Derives the union of tools not assigned to any system, split into "has
// unmatched location text" vs "no location at all". Only meaningful once at
// least one system is normalized.
export function libraryLocationStatus(tools, systems) {
  const normalized = (systems || []).filter(s => s.normalized);
  if (normalized.length === 0) return null;
  const list = tools || [];
  const assignedTools = [];
  const unassigned = [];
  for (const tool of list) {
    const sysId = tool.tool_location?.system_id;
    if (sysId && findSystem(systems, sysId)) assignedTools.push(tool);
    else unassigned.push(tool);
  }
  const withLocation = unassigned.filter(t => (t.location || '').trim());
  const withoutLocation = unassigned.filter(t => !(t.location || '').trim());
  return {
    total: list.length,
    assigned: assignedTools.length,
    unassigned: unassigned.length,
    withLocation: withLocation.length,
    withoutLocation: withoutLocation.length,
    unassignedTools: unassigned,
  };
}

// An empty structured location for a given system (nothing picked yet).
export function emptyLocation(systemId) {
  return { system_id: systemId, zone_id: null, station_id: null, drawer_id: null, bin: null };
}

// Extract the numeric bin from a location value. ProShop stores a location as a
// bare number (no "LC-" prefix); the app's composed string carries the prefix
// (e.g. "LC-1405"). Comparing on the number lets "LC-1405" and "1405" match as
// the same bin. Returns null when there are no digits.
export function locationNumber(value) {
  if (value == null || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
}
