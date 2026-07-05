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
  const map = PROSHOP_FAMILY_MAP[familyId] || {};
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
