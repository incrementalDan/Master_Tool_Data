// ─── The app-owned holder record ────────────────────────────────────────────
//
// ARCHITECTURE (locked): the app-owned holder table is the source of truth and
// the Fusion holder library becomes an EXPORT TARGET — the same relationship
// tool metadata already has with Fusion. Tools carry a stable FK to a holder
// record (`id`, an app UUID) rather than relying on Fusion's absorbed geometry
// snapshot and its unusable guid.
//
// Why it's needed: Fusion ABSORBS holder geometry into each cutting tool. The
// link is one-directional and one-time — it copies the geometry in, then
// forgets. The `holder_guid` left behind points at a snapshot, not a live
// record. So the shop refined its holder library and nothing was actually
// linked; corrections only ever reached new tools.
//
// Records live in `holder_library.json` on Drive (the 6th shared file). The
// Fusion-mirrored fields are kept in their Fusion-native shape so the export is
// close to a passthrough; everything structured is app-only and MUST NOT leak
// into the Fusion JSON (Fusion validates strictly) — see HOLDER_APP_ONLY_FIELDS
// and the strip guard in holderRecordToFusion, locked by holderRecord.test.js.

import { generateId } from './identity.js';
import { normalizeUnit } from '../utils/units.js';
import {
  SEG_HEIGHT, SEG_UPPER, SEG_LOWER,
  deriveGaugeLength, totalSegmentHeight, readAboveGaugeFlags,
  buildGaugeExpressionFromFlags,
} from '../utils/holderGeometry.js';

// holder_library.json — starts empty; populated by the one-time migration from
// the linked Fusion holder library (importHoldersFromFusion) or by hand.
// `parts` holds the body / extension records the holders are assembled from.
export const DEFAULT_HOLDER_LIBRARY = { version: 1, holders: [], parts: [] };

// The app's reference token, written into Fusion's `product-id` so a Fusion
// entry can be traced back to its record. Mirrors the tool tracking ID
// (FTL-XXXXXX) deliberately — same idea, different table.
export function generateHolderRef() {
  const hex = Math.floor(Math.random() * 0x1000000).toString(16).toUpperCase().padStart(6, '0');
  return `HLD-${hex}`;
}
export const HOLDER_REF_RE = /^HLD-[0-9A-F]{6}$/;

// ─── App-only fields — never written to Fusion ──────────────────────────────
// Fusion flags any unrecognized field on a holder entry, exactly as it does on
// a tool. Every structured field this project adds is listed here; the export
// strips them. Add new app-only fields HERE, not ad hoc at the call site.
export const HOLDER_APP_ONLY_FIELDS = [
  'id', 'holder_ref', 'fusion_guid', 'library_id', 'library_name',
  'type_id', 'taper_id', 'collet_family_id', 'collet_size_id',
  'is_tap_collet', 'length', 'has_extension', 'extension',
  'manufacturer', 'part_number', 'purchasing',
  'color', 'location', 'notes', 'tags',
  'primary_photo_id', 'primary_photo_name', 'attachments',
  'legacy_ids', 'legacy_fusion_guids', 'description_manual', 'nominal_check',
  'body_part_id', 'extension_part_id',
  'created_at', 'updated_at', 'updated_by',
];

// Per-segment app-only flags. `above_gauge` is Fusion's OWN concept but it is
// NOT a segment key there — it lives in the tool_holderGaugeLength expression,
// which the export regenerates from these flags. `ext` / `shank_seg` are new.
export const SEGMENT_APP_ONLY_FIELDS = ['above_gauge', 'ext', 'shank_seg'];

export function newHolderRecord(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    holder_ref: generateHolderRef(),
    fusion_guid: null,          // the Fusion holder entry this exports to (null until pushed)

    // ── mirrored from Fusion (so the export round-trips) ──
    description: '',
    unit: normalizeUnit(undefined),
    vendor: '',                 // Fusion-native free text — inconsistently a company or a collet spec
    product_id: '',             // Fusion `product-id` — the app overwrites this with holder_ref
    product_link: '',
    segments: [],

    // ── app-owned structured fields (UUID refs into shop_settings.holder_config) ──
    type_id: null,
    taper_id: null,
    collet_family_id: null,
    collet_size_id: null,
    is_tap_collet: false,
    length: null,               // the ENGRAVED NOMINAL, not the computed gauge length
    has_extension: false,
    extension: { collet_size_id: null, manufacturer: '', part_number: '', vendor: '' },

    // ── links to the physical PARTS this holder is assembled from ──
    // A taper holder and an extension are separate parts bought separately, so
    // their purchasing / location / part number belong on ONE record each
    // rather than copied onto every holder built from them (utils/holderParts.js).
    // The holder still stores its own segments; when they drift from the part's,
    // that is surfaced, never auto-applied. Dangling ids read as "not linked".
    body_part_id: null,
    extension_part_id: null,

    manufacturer: '',
    part_number: '',
    purchasing: { manufacturers: [], vendors: [] },  // same normalized shape as tools

    color: null,
    location: '',               // free text with type-ahead over existing values
    notes: '',
    tags: [],
    primary_photo_id: null,
    primary_photo_name: null,
    attachments: [],
    legacy_ids: [],             // retired product-id / reference values, searchable
    // Fusion guids of holders MERGED INTO this one. A tool references a holder
    // by the guid Fusion absorbed into it, so adopting the merged holder's guid
    // makes every tool that pointed at it resolve here — with no writes to the
    // tool library at all (utils/holderDuplicates.js).
    legacy_fusion_guids: [],

    // The user's one-time acceptance of the engraved-nominal vs modelled-gauge
    // check (see nominalLengthCheck). `signature` captures the inputs the
    // verdict depends on, so the confirmation expires by itself if any of them
    // change and the user is asked again. null = never confirmed.
    nominal_check: null,        // { signature, confirmed_at, confirmed_by }

    // A hand-typed description must survive later field changes — same
    // nameManual + "↺ Auto" protection the preset names use. Records imported
    // from Fusion are hand-named by definition, so migration sets this true.
    description_manual: false,

    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ─── product-id triage (migration) ──────────────────────────────────────────
// The app overwrites Fusion's `product-id` with its own reference token, but
// what's there must be MIGRATED first, not discarded. Across the real library:
// two holders carry a genuine vendor SKU ("BT30-APU13D", "BT30-FMA.750-2.5D")
// and two carry ad-hoc notes ("min OOH", a longhand restatement of the
// description). Classified by shape, and the raw value is retained in
// legacy_ids either way so nothing is lost even when the guess is wrong.
export function triageProductId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { kind: 'empty', value: '' };
  // A SKU is a single dash/dot-joined token with no spaces (vendors don't put
  // spaces in part numbers); anything with spaces reads as prose.
  const isSku = !/\s/.test(raw) && /[A-Za-z]/.test(raw) && /[-.\d]/.test(raw);
  return { kind: isSku ? 'sku' : 'note', value: raw };
}

// Fusion's holder `vendor` is inconsistently a company ("Maritool", "Nikken")
// or a collet spec ("SK13-ER8"). Only the company case is a manufacturer.
const COLLET_SPEC_RE = /^(SK|ER|TG)\s*\d/i;
export const vendorLooksLikeManufacturer = (v) =>
  !!String(v ?? '').trim() && !COLLET_SPEC_RE.test(String(v).trim());

// ─── Fusion → record (the one-time migration) ───────────────────────────────
// DELIBERATELY DUMB about classification: it imports geometry + identity and
// nothing else. Parsing type/taper/collet out of the free-text description is
// the healer's job, and the healer is a preview→commit action the user
// accepts — never a silent rewrite (holder descriptions are load-bearing; see
// holderDescription.js).
export function fusionHolderToRecord(fusionHolder, extra = {}) {
  const f = fusionHolder || {};
  const unit = normalizeUnit(f.unit);
  const aboveFlags = readAboveGaugeFlags(f);
  const segments = (Array.isArray(f.segments) ? f.segments : []).map((s, i) => ({
    [SEG_HEIGHT]: Number(s?.[SEG_HEIGHT]) || 0,
    [SEG_UPPER]: Number(s?.[SEG_UPPER]) || 0,
    [SEG_LOWER]: Number(s?.[SEG_LOWER]) || 0,
    above_gauge: !!aboveFlags[i],
  }));

  const pid = triageProductId(f['product-id']);
  const vendor = String(f.vendor ?? '').trim();

  return newHolderRecord({
    fusion_guid: f.guid || null,
    description: String(f.description ?? '').trim(),
    description_manual: true,   // an imported name is hand-written by definition
    unit,
    vendor,
    product_id: '',             // replaced by holder_ref; the old value is preserved below
    product_link: String(f['product-link'] ?? ''),
    segments,
    manufacturer: vendorLooksLikeManufacturer(vendor) ? vendor : '',
    // A genuine SKU becomes the part number; prose becomes a note. Either way
    // the raw string is retained in legacy_ids.
    part_number: pid.kind === 'sku' ? pid.value : '',
    notes: pid.kind === 'note' ? pid.value : '',
    legacy_ids: pid.kind === 'empty' ? [] : [pid.value],
    library_id: extra.library_id ?? null,
    library_name: extra.library_name ?? null,
    ...(extra.overrides || {}),
  });
}

// ─── record → Fusion (the export) ───────────────────────────────────────────
// Invariants from CLAUDE.md's Fusion round-trip section all apply:
//  · never write a native field without its paired expression — the expression
//    is what Fusion re-derives the value from on load;
//  · gauge length is the derived sum, clamped to the section total (a stored
//    value a hair larger makes Fusion throw "gauge length exceeds the total
//    height of sections");
//  · app-only fields never leak.
// `existing` is the current Fusion entry when there is one, so anything Fusion
// added that we don't model (BMC, future fields) survives.
export function holderRecordToFusion(record, existing = null) {
  if (!record) return null;
  const segments = (record.segments || []).map(s => ({
    [SEG_HEIGHT]: Number(s?.[SEG_HEIGHT]) || 0,
    [SEG_LOWER]: Number(s?.[SEG_LOWER]) || 0,
    [SEG_UPPER]: Number(s?.[SEG_UPPER]) || 0,
  }));

  let gaugeLength = deriveGaugeLength(record.segments);
  const total = totalSegmentHeight(record.segments);
  if (total > 0 && gaugeLength > total) gaugeLength = total;

  const out = {
    ...(existing || {}),
    ...(existing ? { expressions: { ...(existing.expressions || {}) } } : { expressions: {} }),
    description: record.description || '',
    gaugeLength,
    // DETERMINISTIC — never generateId() here. This runs on every tool write
    // (see holderResolve.js); a fresh guid each time would re-point the tool's
    // holder link on every save. A record that has never been pushed to Fusion
    // uses its own stable app id.
    guid: record.fusion_guid || existing?.guid || record.id,
    'product-id': record.holder_ref || '',
    'product-link': record.product_link || '',
    segments,
    type: 'holder',
    unit: normalizeUnit(record.unit),
    vendor: record.vendor || '',
  };

  // Native + expression written together, always — Fusion re-derives both the
  // displayed description and the gauge length from these strings on load, so a
  // stale expression silently reverts the write.
  out.expressions.tool_description = `'${record.description || ''}'`;
  const gaugeExpr = buildGaugeExpressionFromFlags(record.segments);
  if (gaugeExpr) out.expressions.tool_holderGaugeLength = gaugeExpr;
  else delete out.expressions.tool_holderGaugeLength;

  // Strip guard — belt and braces. Nothing app-only reaches Fusion even if a
  // caller hands us a record that was spread over an existing entry.
  for (const key of HOLDER_APP_ONLY_FIELDS) delete out[key];
  return out;
}

// Replace the holder entries of a raw Fusion library list with the records'
// exports, leaving every non-holder entry untouched. The holder library file is
// the same shape as the tool library ({ data: [...], version }) and may contain
// other entry types — a write must never drop them.
export function applyHolderRecordsToFusionList(list, records) {
  const byGuid = new Map();
  for (const r of records || []) if (r?.fusion_guid) byGuid.set(r.fusion_guid, r);
  const seen = new Set();
  const out = (list || []).map(entry => {
    if (entry?.type !== 'holder') return entry;
    const rec = byGuid.get(entry.guid);
    if (!rec) return entry;
    seen.add(rec.id);
    return holderRecordToFusion(rec, entry);
  });
  // Records with no Fusion entry yet are appended.
  for (const r of records || []) {
    if (!r || seen.has(r.id)) continue;
    if (r.fusion_guid && byGuid.has(r.fusion_guid)) continue;
    out.push(holderRecordToFusion(r, null));
  }
  return out;
}

// Find a record by any of the signals a tool might carry.
export function findHolderRecord(records, { id, fusion_guid, holder_ref } = {}) {
  const list = records || [];
  if (id) { const r = list.find(x => x.id === id); if (r) return r; }
  if (holder_ref) {
    const r = list.find(x => x.holder_ref === holder_ref
      || (x.legacy_ids || []).includes(holder_ref));
    if (r) return r;
  }
  if (fusion_guid) {
    // Follows merges: a record that ABSORBED this guid resolves for it.
    const r = list.find(x => x.fusion_guid === fusion_guid
      || (x.legacy_fusion_guids || []).includes(fusion_guid));
    if (r) return r;
  }
  return null;
}
