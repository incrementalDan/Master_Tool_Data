// Insert-style tools: holder body + insert pairings.
//
// An insert-style tool is TWO separate physical objects paired for use:
//   1. Holder body — its own tool_id, location, purchasing. One body pairs
//      with many inserts over time.
//   2. Insert — also its own tool_id, location, purchasing.
//   3. Pairing — NOT a physical object: the relationship connecting one holder
//      body + one insert into the single unit Fusion sees as one tool entity.
//
// In this app the PAIRING **is** the existing logical tool (the Fusion-backed
// entry that carries description, presets, machine links, history). Its
// metadata record gains a `pairing` object referencing the two component
// records by stable UUID. Component records are metadata-only — they live in
// `tool_components.json` on Drive and are NEVER written to the Fusion library
// (Fusion sees exactly one entity per pairing).
//
// ProShop's letter-prefix scheme (TF/TO, I/G, …) is a sync-boundary
// translation concern ONLY — see PROSHOP_FAMILY_MAP below. It must not leak
// into internal family ids, UI labels, or search.
import { generateId } from './identity.js';
import { getDefaultUnit } from '../utils/units.js';

// ─── Internal family vocabulary ─────────────────────────────────────────────
// The app's own family list — not derived from ProShop's letters. Adding a new
// family later = one row here (+ one row in PROSHOP_FAMILY_MAP if ProShop sync
// is needed for it).
//
// hasTier3Assembly: whether the existing Assembly system (holder body + insert
// unit → machine-taper holder at some OOH) layers on top. Only MILLING insert
// families have it; turning families are turret-ready as the pairing itself.
//
// suggestedTypes: which internal tool_type(s) a pairing of this family usually
// carries in Fusion — used to pre-select a family, never to enforce one.
export const INSERT_FAMILIES = [
  { id: 'milling_insert',  label: 'Milling Insert (face/shell mill)', hasTier3Assembly: true,  suggestedTypes: ['face mill'] },
  { id: 'indexable_drill', label: 'Indexable Drill',                  hasTier3Assembly: true,  suggestedTypes: ['drill'] },
  { id: 'id_threader',     label: 'ID Threader',                      hasTier3Assembly: false, suggestedTypes: ['turning general'] },
  { id: 'od_threader',     label: 'OD Threader',                      hasTier3Assembly: false, suggestedTypes: ['turning general'] },
  { id: 'boring_bar',      label: 'Boring Bar',                       hasTier3Assembly: false, suggestedTypes: ['boring head', 'turning general'] },
  { id: 'back_boring_bar', label: 'Back Boring Bar',                  hasTier3Assembly: false, suggestedTypes: ['boring head', 'turning general'] },
  { id: 'od_turning',      label: 'OD Turning',                       hasTier3Assembly: false, suggestedTypes: ['turning general'] },
  { id: 'knurling',        label: 'Knurling',                         hasTier3Assembly: false, suggestedTypes: ['turning general'] },
  { id: 'od_groover',      label: 'OD Groover',                       hasTier3Assembly: false, suggestedTypes: ['turning general'] },
  { id: 'id_groover',      label: 'ID Groover',                       hasTier3Assembly: false, suggestedTypes: ['turning general'] },
  { id: 'face_groover',    label: 'Face Groover',                     hasTier3Assembly: false, suggestedTypes: ['turning general'] },
  { id: 'part_off',        label: 'Part-Off',                         hasTier3Assembly: false, suggestedTypes: ['turning general'] },
  // Generic catch-all for the ~5% of otherwise-solid tools that happen to run
  // an insert tip (an insert-tipped key cutter / ball mill, etc.). Tier-3 so it
  // keeps the holder + OOH assembly like a milling insert; NO ProShop prefix
  // (arbitrary types have no combined-ID convention — each component still
  // carries its own ProShop number). It's the default when a pairing is
  // activated on a tool type with no more-specific family.
  { id: 'generic_insert',  label: 'Insert-Tipped / Indexable (other)', hasTier3Assembly: true, suggestedTypes: [] },
];

export const INSERT_FAMILY_BY_ID = Object.fromEntries(INSERT_FAMILIES.map(f => [f.id, f]));

export function insertFamilyById(id) {
  return INSERT_FAMILY_BY_ID[id] || null;
}

// Tool types that can host a pairing (shows the "set up as insert-style tool"
// affordance in ToolDetail). Suggestion-level only — the family choice is the
// user's.
export const INSERT_CAPABLE_TYPES = new Set(['face mill', 'drill', 'turning general', 'boring head']);

// Tool types that are ALWAYS insert-style (a holder body + an insert) — the
// paired view opens by DEFAULT for these instead of a manual "set up pairing"
// panel. `drill` is deliberately NOT here: only indexable drills are
// insert-style, most drills are solid carbide, so a drill stays opt-in.
export const ALWAYS_INSERT_TYPES = new Set(['face mill', 'turning general', 'boring head']);

// The family an always-insert tool's paired view defaults to when it opens
// with no stored pairing. Milling and boring are unambiguous; a plain turning
// tool (`turning general`) could be any of ~9 turning families, so it defaults
// to OD turning for the user to correct via the pairing-bar dropdown.
export function autoInsertFamily(toolType) {
  if (toolType === 'face mill') return 'milling_insert';
  if (toolType === 'boring head') return 'boring_bar';
  return 'od_turning';
}

export function defaultFamilyForType(toolType) {
  const hit = INSERT_FAMILIES.find(f => f.suggestedTypes.includes(toolType));
  return hit ? hit.id : 'od_turning';
}

// The family a pairing defaults to when it's activated (manually, via the
// ToolForm toggle) on ANY tool type. Known insert types get their natural
// family; everything else (an insert-tipped key cutter, ball mill, …) gets the
// generic catch-all, which the user can refine via the pairing-bar dropdown.
export function defaultActivationFamily(toolType) {
  if (toolType === 'face mill') return 'milling_insert';
  if (toolType === 'boring head') return 'boring_bar';
  if (toolType === 'turning general') return 'od_turning';
  if (toolType === 'drill') return 'indexable_drill';
  return 'generic_insert';
}

// ─── ProShop translation table (sync boundary ONLY) ─────────────────────────
// Referenced only during ProShop import/export and when composing the combined
// Fusion product-id string (e.g. "TF-194/TO-195"). Never shown as a label and
// never part of the internal data model.
//
// Not mapped (out of scope): Q (saw arbor), T (insert hardware).
export const PROSHOP_FAMILY_MAP = {
  milling_insert:   { holder_prefix: 'I',  insert_prefix: 'G'  },
  indexable_drill:  { holder_prefix: 'TC', insert_prefix: 'TT' },
  id_threader:      { holder_prefix: 'TA', insert_prefix: 'TM' },
  od_threader:      { holder_prefix: 'TB', insert_prefix: 'TN' },
  boring_bar:       { holder_prefix: 'TD', insert_prefix: 'TL' },
  // Assumed to share boring_bar's TL insert code — verify against a real
  // ProShop export before relying on it for import classification.
  back_boring_bar:  { holder_prefix: 'TE', insert_prefix: 'TL' },
  od_turning:       { holder_prefix: 'TF', insert_prefix: 'TO' },
  knurling:         { holder_prefix: 'TG', insert_prefix: 'TU' },
  od_groover:       { holder_prefix: 'TH', insert_prefix: 'TP' },
  id_groover:       { holder_prefix: 'TI', insert_prefix: 'TQ' },
  face_groover:     { holder_prefix: 'TJ', insert_prefix: 'TS' },
  part_off:         { holder_prefix: 'TK', insert_prefix: 'TR' },
};

// Leading letter prefix of a ProShop-style id ("TF-194" → "TF", "I-167" → "I").
// Requires a digit after the (optional dash/space) so a bare word never parses.
function parsePrefix(half) {
  const m = /^([A-Za-z]{1,2})[- ]?\d/.exec(String(half || '').trim());
  return m ? m[1].toUpperCase() : '';
}

// Split a combined ProShop / Fusion product-id ("TF-194/TO-195") into its two
// halves and classify them against PROSHOP_FAMILY_MAP. Order is NOT guaranteed
// in the wild — both orders are checked. Returns
// { family, holder_id, insert_id } or null when it isn't a recognizable
// combined insert-tool id.
export function splitCombinedProShopId(raw) {
  const s = String(raw || '').trim();
  if (!s.includes('/')) return null;
  const halves = s.split('/').map(h => h.trim()).filter(Boolean);
  if (halves.length !== 2) return null;
  const [p0, p1] = halves.map(parsePrefix);
  if (!p0 || !p1) return null;
  for (const fam of INSERT_FAMILIES) {
    const map = PROSHOP_FAMILY_MAP[fam.id];
    if (!map) continue;
    if (p0 === map.holder_prefix && p1 === map.insert_prefix) {
      return { family: fam.id, holder_id: halves[0], insert_id: halves[1] };
    }
    if (p1 === map.holder_prefix && p0 === map.insert_prefix) {
      return { family: fam.id, holder_id: halves[1], insert_id: halves[0] };
    }
  }
  return null;
}

// Make sure a component's tool_id carries its family prefix. In proshop mode
// the shop's tool_ids already include the prefix ("TF-194") — kept as-is. A
// bare number gets the prefix prepended; an id that already carries a
// DIFFERENT letter prefix is trusted (the user knows best).
export function ensureProShopPrefix(id, prefix) {
  const s = String(id || '').trim();
  if (!s || !prefix) return s;
  if (new RegExp(`^${prefix}[- ]?\\d`, 'i').test(s)) return s;
  if (/^[A-Za-z]{1,2}[- ]?\d/.test(s)) return s;
  return `${prefix}-${s}`;
}

// The combined product-id string for a pairing — holder first (Fusion doesn't
// care about order; consistency helps humans reading it). '' until both
// components are linked and have tool_ids.
export function composeCombinedProShopId(familyId, holderComp, insertComp) {
  // Families without a ProShop convention (e.g. the generic catch-all used for
  // arbitrary insert-tipped tools) don't compose a combined id — each component
  // still carries its own ProShop number.
  const map = PROSHOP_FAMILY_MAP[familyId];
  if (!map) return '';
  const h = ensureProShopPrefix(holderComp?.tool_id, map.holder_prefix);
  const i = ensureProShopPrefix(insertComp?.tool_id, map.insert_prefix);
  if (!h || !i) return '';
  return `${h}/${i}`;
}

// ─── Component records (tool_components.json) ───────────────────────────────
// Holder bodies and inserts are first-class records with the tool-record
// essentials (tool_id, location, purchasing, photo) — metadata-only, no Fusion
// entry, browsable only through the pairing picker.
export const COMPONENT_ROLES = ['holder_body', 'insert'];
export const COMPONENT_ROLE_LABELS = { holder_body: 'Holder Body', insert: 'Insert' };

export function newComponent(role, family = null, extra = {}) {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    role,
    family,
    tool_id: '',
    description: '',
    designation: '',
    size: '',
    corner_radius: null,
    overall_length: null,
    shank_size: '',
    grade: '',
    coating: '',
    unit: getDefaultUnit(),
    notes: '',
    // Free-text location (from ProShop's Location column, or manual) — the
    // fallback shown until a structured tool_location is assigned. Mirrors how a
    // tool carries both `location` (string) and `tool_location` (structured).
    location: '',
    // Structured physical location — same shape as a tool's tool_location
    // ({ system_id, zone_id, station_id, drawer_id, bin }); composed to a
    // display string at render via resolveLocationString.
    tool_location: null,
    bin_size_id: null,
    legacy_locations: [],
    purchasing: { manufacturers: [], vendors: [] },
    primary_photo_id: null,
    primary_photo_name: null,
    created_at: now,
    updated_at: now,
    ...extra,
  };
}

// The per-role "Geometry & setup" field lists rendered in the component group
// cards. Deliberately small — component specs are reference data, not CAM
// geometry (that lives on the pairing's Fusion entry).
export const COMPONENT_SPEC_FIELDS = {
  holder_body: [
    { key: 'designation',    label: 'Designation / Style', type: 'text', placeholder: 'e.g. MCLNR 16-4D' },
    { key: 'shank_size',     label: 'Shank Size',          type: 'text', placeholder: 'e.g. 1" sq / Ø3/4 bar' },
    { key: 'overall_length', label: 'Overall Length',      type: 'num',  unit: 'length' },
  ],
  insert: [
    { key: 'designation',   label: 'Insert Designation', type: 'text', placeholder: 'e.g. CNMG 432' },
    { key: 'size',          label: 'Size / IC',          type: 'text', placeholder: 'e.g. 1/2 IC' },
    { key: 'corner_radius', label: 'Corner Radius',      type: 'num',  unit: 'length' },
    { key: 'grade',         label: 'Grade',              type: 'text', placeholder: 'e.g. KC5010' },
    { key: 'coating',       label: 'Coating',            type: 'text', placeholder: 'e.g. TiAlN' },
  ],
};

// Look a component up by id in either the components FILE ({ components: [] })
// or a plain array.
export function componentById(components, id) {
  if (!id) return null;
  const list = Array.isArray(components) ? components : (components?.components || []);
  return list.find(c => c.id === id) || null;
}

const compIdToken = (c) => String(c?.tool_id || '').trim();

// ─── Pairing assembly numbers ────────────────────────────────────────────────
// Both tool_ids are ALWAYS included — a holder body pairs with multiple
// inserts, so the operator needs both IDs to know which two drawers to visit.
//
// Tier-3 (milling) families: the per-assembly asm_number keeps the standard
// Auto shape ({holderShort}{sep}{idPart}{sep}{ooh}) with the id part replaced
// by "{holder_body_tool_id}+{insert_tool_id}" — composed by feeding
// pairedAsmIdPart into the existing composeAsmNumber (assemblyIdSystem.js).
// e.g. SK13-1001+1042-2.125
export function pairedAsmIdPart(pairing, components) {
  const h = compIdToken(componentById(components, pairing?.holder_component_id));
  const i = compIdToken(componentById(components, pairing?.insert_component_id));
  if (!h && !i) return '';
  return `${h || '?'}+${i || '?'}`;
}

// Non-tier-3 (turning) families: the pairing itself is the finished,
// turret-ready tool — no OOH, no tier-3 holder. Its number is simply
// "{holder_body_tool_id}/{insert_tool_id}" (e.g. 1001/1042), derived at
// render, never stored (re-derivable, like every Auto asm number).
export function pairingAsmNumber(pairing, components) {
  const h = compIdToken(componentById(components, pairing?.holder_component_id));
  const i = compIdToken(componentById(components, pairing?.insert_component_id));
  if (!h && !i) return '';
  return `${h || '?'}/${i || '?'}`;
}

// ─── Fusion-side auto-detection ─────────────────────────────────────────────
// Fusion carries an insert tool as ONE entry whose product-id is the two
// ProShop numbers joined with a slash (e.g. "TF-194/TO-195", "A-103/ I-98").
// The slash IS the insert-tool indicator — true for any tool type; ProShop
// itself never uses the slash (each component is its own row / Tool #).
export function isCombinedProShopId(id) {
  return String(id || '').includes('/');
}

// Match ProShop ids interchangeably regardless of dashes/spaces/case
// ("TF-194", "TF 194", "tf194" all compare equal) — same rule as the photo
// importer's id matching.
export function normProShopId(id) {
  return String(id || '').replace(/[\s-]/g, '').toUpperCase();
}

// Derive a pairing's family + the two component ProShop numbers from a combined
// product-id. Known prefix pairs classify to their family (holder/insert
// assigned by prefix, order-insensitive); anything else falls back to the tool
// type's natural family (→ generic_insert for arbitrary types), with holder =
// first token, insert = second (Fusion's holder-first convention). Returns null
// when the id isn't a two-part combined id.
export function pairingFromCombinedId(toolId, toolType) {
  if (!isCombinedProShopId(toolId)) return null;
  const classified = splitCombinedProShopId(toolId);
  if (classified) return classified;
  const halves = String(toolId).split('/').map(h => h.trim()).filter(Boolean);
  if (halves.length !== 2) return null;
  return { family: defaultActivationFamily(toolType), holder_id: halves[0], insert_id: halves[1] };
}

// Load-time derive (read-only, no writes — like backfillAsmNumbers): for each
// tool whose product-id is a combined id and that has NO stored pairing yet,
// set an in-memory `pairing` with the family + component links resolved by
// ProShop number against the existing component records. Unlinked sides stay
// null (they're created/filled on ProShop upload). A tool that already carries
// a stored pairing (from metadata) is left untouched. Returns a new array only
// when something changed.
export function derivePairings(tools, components = []) {
  const list = Array.isArray(components) ? components : (components?.components || []);
  const holderByNum = new Map();
  const insertByNum = new Map();
  for (const c of list) {
    const key = normProShopId(c.tool_id);
    if (!key) continue;
    if (c.role === 'holder_body') holderByNum.set(key, c);
    else if (c.role === 'insert') insertByNum.set(key, c);
  }
  let changed = false;
  const next = (tools || []).map(t => {
    if (t.pairing) return t; // stored pairing wins
    const p = pairingFromCombinedId(t.tool_id, t.tool_type);
    if (!p) return t;
    changed = true;
    const holder = holderByNum.get(normProShopId(p.holder_id)) || null;
    const insert = insertByNum.get(normProShopId(p.insert_id)) || null;
    return {
      ...t,
      pairing: {
        family: p.family,
        holder_component_id: holder?.id || null,
        insert_component_id: insert?.id || null,
        rta_number: '',
      },
    };
  });
  return changed ? next : tools;
}

// Build a lookup from ProShop component number → { role, family, tool_id } for
// every insert tool in the library (a tool whose tool_id is a combined
// holder/insert id). Keyed by normProShopId. The ProShop import uses this to
// route a component's row to its component record instead of matching a tool or
// minting a Fusion-only placeholder.
export function insertComponentIndex(tools) {
  const index = new Map();
  for (const t of (tools || [])) {
    if (!isCombinedProShopId(t?.tool_id)) continue;
    const p = pairingFromCombinedId(t.tool_id, t.tool_type);
    if (!p) continue;
    index.set(normProShopId(p.holder_id), { role: 'holder_body', family: p.family, tool_id: t.tool_id });
    index.set(normProShopId(p.insert_id), { role: 'insert', family: p.family, tool_id: t.tool_id });
  }
  return index;
}

// A blank pairing object as stored on the tool's metadata record.
export function newPairing(family) {
  return {
    family,
    holder_component_id: null,
    insert_component_id: null,
    // ProShop RTA# — the manual pairing-level number when the Assembly ID
    // system is in proshop_rta mode. RTA is structurally the 2-tier pairing
    // ("these two IDs used together as one thing") and lives here, not on
    // either component and not on a tier-3 assembly record.
    rta_number: '',
  };
}
