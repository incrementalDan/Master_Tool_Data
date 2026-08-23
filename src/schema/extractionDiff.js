// extractionDiff.js
//
// Turns a SPARSE extraction (see src/services/extractionService.js) into a list
// of per-field PROPOSALS against an EXISTING tool.
//
// ── Why this is not the Sync-Job diff ────────────────────────────────────────
// `DiffStep` compares two whole Fusion tools and carries preset matching,
// assembly detection and a commit queue. An extraction produces NO presets and
// NO assemblies, and its field coverage is different (taps, purchasing, product
// link — none of which are in DIFF_SECTIONS). So this is the small half:
// scalar field proposals, nothing else.
//
// ── The three rules this module exists to enforce ────────────────────────────
// 1. SPARSE IN. Only keys the sheet actually answered can become a proposal.
//    Anything else is "not mentioned" and must never reach the draft.
// 2. TYPE-GATED. A field that does not apply to this tool's type (registry
//    `appliesToTypes`) is dropped HERE, before the UI — so it cannot be swept
//    up by an "accept all" and pushed to Fusion on a type that has no such field.
// 3. UNIT-CORRECTED. The model always answers in INCHES (it is told to convert).
//    A millimeters tool would otherwise show every length as a huge change, so
//    lengths are converted into the record's own unit before comparison.
//
// ⚠️ `tool_type` is deliberately NOT proposable. Accepting it would change the
// applicable field set out from under every other proposal in the list. A
// disagreement is surfaced as a NOTICE instead; changing the type stays the
// form's own type dropdown.

import { FIELD_REGISTRY, fieldsForType, fieldLabel } from './fieldRegistry.js';
import { convertLength } from '../utils/units.js';
import { THROUGH_COOLANT_VALUES } from '../../tool-extractor.tsx';
import { generateId } from './identity.js';
import { registryIdForName, entityByName } from './vendorRegistry.js';
import {
  generateManufacturerUrl, generateVendorUrl,
  manufacturerHasUrlGenerator, vendorHasUrlGenerator,
} from '../utils/urlGenerators.js';

// ── Extracted key → app field ────────────────────────────────────────────────
// Only scalar tool fields. Purchasing keys (approvedBrand / edpNumber / vendor /
// vendorStockNum / cost / productLink) are handled separately below, and
// `toolType` / `ooh` are deliberately absent (see the header note; OOH is
// per-assembly, and the prompt tells the model to leave it empty).
export const EXTRACTED_TO_FIELD = {
  diameter: 'diameter',
  loc: 'flute_length',
  oal: 'overall_length',
  flutes: 'number_of_flutes',
  shankDia: 'shank_diameter',
  cornerRadius: 'corner_radius',
  material: 'material',
  coating: 'coating',
  workpieceMats: 'material_suitability',
  tipAngle: 'tip_angle',
  tipDiameter: 'tip_diameter',
  helixAngle: 'helix_angle',
  taperAngle: 'taper_angle',
  shoulderLen: 'shoulder_length',
  pitch: 'pitch',
  tapClass: 'tap_class',
  tapSubType: 'tap_sub_type',
  isSTI: 'is_sti',
  threadUnit: 'tap_thread_unit',
  pointType: 'point_type',
  minThreadPitch: 'min_thread_pitch',
  maxThreadPitch: 'max_thread_pitch',
  tpiMin: 'tpi_min',
  tpiMax: 'tpi_max',
  threadProfileAngle: 'thread_profile_angle',
  fluteType: 'flute_type',
  fluteDesign: 'flute_design',
  centerCutting: 'center_cutting',
  cuttingDirection: 'cutting_direction',
  fullProfile: 'full_profile',
  stubJobber: 'stub_jobber',
  backsideCapable: 'backside_capable',
  doubleEnded: 'double_ended',
  productLink: 'product_link',
  // NOTE: `approvedBrand` is absent on purpose — see extractedToToolFields.
};

// Integer-valued fields — compared exactly, never with a float tolerance.
const INT_FIELDS = new Set(['number_of_flutes', 'tpi_min', 'tpi_max']);

// Float-noise floor, in INCHES. Matches the app's existing 5e-5 rule: anything
// closer renders identically at the 4-decimal display precision, so it is not a
// difference a human could act on. Scaled for a millimeters record.
const NUM_EPS_IN = 5e-5;
const ANGLE_EPS = 0.01;

const isLengthField = (field) => FIELD_REGISTRY[field]?.unit === 'length';
const isAngleField = (field) => FIELD_REGISTRY[field]?.unit === 'angle';

/** Empty for proposal purposes: no value the user would see in the box. */
export function isBlankValue(v) {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Are these two stored values the same, allowing for display-level noise? */
export function sameValue(a, b, field, unit = 'inches') {
  if (isBlankValue(a) && isBlankValue(b)) return true;
  if (isBlankValue(a) !== isBlankValue(b)) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    const sa = new Set(Array.isArray(a) ? a : [a]);
    const sb = new Set(Array.isArray(b) ? b : [b]);
    return sa.size === sb.size && [...sa].every(x => sb.has(x));
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;

  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb) && a !== '' && b !== '') {
    if (INT_FIELDS.has(field)) return Math.round(na) === Math.round(nb);
    if (isAngleField(field)) return Math.abs(na - nb) <= ANGLE_EPS;
    const eps = isLengthField(field) && unit === 'millimeters' ? NUM_EPS_IN * 25.4 : NUM_EPS_IN;
    return Math.abs(na - nb) <= eps;
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Convert a sparse extraction into app-field space for a target tool.
 *
 * Lengths arrive in inches (the model is told to convert) and are moved into
 * the tool's own unit here — the one place that conversion belongs.
 *
 * @returns {{ fields: object, converted: Set<string>, extractedType: string|null }}
 */
export function extractedToToolFields(extracted, tool) {
  const unit = tool?.unit || 'inches';
  const fields = {};
  const converted = new Set();

  for (const [exKey, field] of Object.entries(EXTRACTED_TO_FIELD)) {
    if (!(exKey in extracted)) continue;
    let value = extracted[exKey];

    if (isLengthField(field)) {
      const n = parseFloat(value);
      if (isNaN(n)) continue;
      value = unit === 'inches' ? n : convertLength(n, 'inches', unit);
      if (unit !== 'inches') converted.add(field);
    } else if (FIELD_REGISTRY[field]?.type === 'number') {
      const n = INT_FIELDS.has(field) ? parseInt(value, 10) : parseFloat(value);
      if (isNaN(n)) continue;
      value = n;
    }
    fields[field] = value;
  }

  // Coolant is a capability flag on our side, not a preset value.
  if ('coolant' in extracted) {
    fields.tsc_capable = THROUGH_COOLANT_VALUES.has(extracted.coolant);
  }
  // ⚠️ `approvedBrand` deliberately does NOT become a `vendor` field proposal.
  // It is the same fact as the purchasing manufacturer row, and offering both
  // would be two independent decisions for one answer — accept one, reject the
  // other, and `tool.vendor` disagrees with `purchasing.manufacturers` forever.
  // Purchasing owns the manufacturer; `vendor` follows it (see ToolForm), and
  // only when it is blank — adding a SECOND maker must not restamp a tool that
  // is still primarily the first one's.

  return {
    fields,
    converted,
    extractedType: extracted.toolType || null,
  };
}

/**
 * Build the per-field proposal list.
 *
 * @returns {{proposals: Array, typeNotice: object|null}}
 *   proposal: { field, label, current, proposed, kind: 'change'|'fill',
 *               converted: boolean, section: 'geometry'|'setup'|'identity' }
 */
export function buildFieldProposals(tool, extracted) {
  const { fields, converted, extractedType } = extractedToToolFields(extracted, tool);
  const unit = tool?.unit || 'inches';

  // RULE 2 — the per-type gate. `vendor` and `product_link` are registry
  // fields too, so this single check covers them as well.
  const applicable = new Set(fieldsForType(tool.tool_type));

  const proposals = [];
  for (const [field, proposed] of Object.entries(fields)) {
    if (!applicable.has(field)) continue;
    const current = tool[field];
    if (sameValue(current, proposed, field, unit)) continue;

    // A boolean arriving `true` over a stored `false` is a CHANGE, not a fill —
    // `false` is a real answer, so flipping it needs an explicit decision.
    const kind = (isBlankValue(current) && typeof proposed !== 'boolean') ? 'fill' : 'change';

    proposals.push({
      field,
      label: fieldLabel(field, unit) || field,
      current,
      proposed,
      kind,
      converted: converted.has(field),
    });
  }

  const typeNotice = (extractedType && extractedType !== tool.tool_type)
    ? { extractedType, currentType: tool.tool_type }
    : null;

  return { proposals, typeNotice };
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchasing
//
// Purchasing is `{manufacturers[], vendors[]}` with FK links — not a scalar, so
// it cannot be a field proposal row. It gets its own sub-diff with ENTITY-level
// row matching, then one write back to `tool.purchasing`.
// ─────────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Do two purchasing names refer to the same company?
 *
 * ⚠️ Resolved through the vendor registry, NOT by string equality. The alias
 * system exists because catalogs spell things inconsistently — "GARR" and
 * "GARR Tool", "Helical" and "Helical Solutions" are ONE entity. Comparing raw
 * strings would fire the "different manufacturer" warning on every scan, which
 * is exactly the nag loop that makes a warning worthless.
 */
export function sameEntity(nameA, nameB) {
  if (!nameA || !nameB) return false;
  if (norm(nameA) === norm(nameB)) return true;
  const a = entityByName(nameA);
  const b = entityByName(nameB);
  if (a && b) return a.id === b.id;
  return false;
}

/**
 * Build the purchasing sub-diff.
 *
 * Row keys are stable strings so the UI can track accept/reject per difference,
 * and `applyPurchasingRows` replays only the accepted ones.
 *
 * @returns {{rows: Array, newManufacturer: string|null}}
 *   row: { key, label, current, proposed, kind, requiresAck?, target }
 */
export function buildPurchasingProposals(tool, extracted) {
  const rows = [];
  const purchasing = tool.purchasing || { manufacturers: [], vendors: [] };
  const mfgs = purchasing.manufacturers || [];
  const vendors = purchasing.vendors || [];

  const brand = extracted.approvedBrand || '';
  const edp = extracted.edpNumber || '';
  const vendorName = extracted.vendor || '';
  const vendorNum = extracted.vendorStockNum || '';
  const cost = extracted.cost || '';
  const productLink = extracted.productLink || '';

  if (!brand && !edp && !vendorName && !vendorNum && !cost) {
    return { rows: [], newManufacturer: null };
  }

  // ── Manufacturer ──
  const existingMfg = brand ? mfgs.find(m => sameEntity(m.name, brand)) : mfgs[0];
  // A brand we don't already carry, on a tool that already has one, is the
  // "scanned a different maker's sheet" case — unlikely, but destructive if it
  // slid in unnoticed. It is added, never substituted, and only after the user
  // acknowledges that they know the manufacturer differs.
  const isNewMfg = !!brand && !existingMfg && mfgs.length > 0;
  const mfgName = existingMfg?.name || brand;

  if (brand && !existingMfg) {
    rows.push({
      key: 'mfg:new',
      label: 'Manufacturer',
      current: mfgs.length ? mfgs.map(m => m.name).filter(Boolean).join(', ') : null,
      proposed: brand,
      kind: mfgs.length ? 'change' : 'fill',
      requiresAck: isNewMfg,
      target: 'manufacturer',
    });
  }

  if (edp) {
    const cur = existingMfg?.edp || '';
    if (norm(cur) !== norm(edp)) {
      rows.push({
        key: 'mfg:edp',
        label: `EDP# ${mfgName ? `(${mfgName})` : ''}`.trim(),
        current: cur || null,
        proposed: edp,
        kind: cur ? 'change' : 'fill',
        target: 'manufacturer',
      });
    }
  }

  // URL: the generator wins where a pattern exists (it is canonical and
  // survives a catalog redesign); otherwise fall back to the scraped product
  // link. Filled ONLY when blank, so a hand-corrected URL is never overwritten.
  const effectiveEdp = edp || existingMfg?.edp || '';
  if (mfgName && effectiveEdp && !existingMfg?.edp_url) {
    const url = manufacturerHasUrlGenerator(mfgName)
      ? generateManufacturerUrl(mfgName, effectiveEdp)
      : (productLink || null);
    if (url) {
      rows.push({
        key: 'mfg:edp_url',
        label: 'Manufacturer link',
        current: null,
        proposed: url,
        kind: 'fill',
        target: 'manufacturer',
        generated: manufacturerHasUrlGenerator(mfgName),
      });
    }
  }

  // ── Vendor ──
  if (vendorName || vendorNum || cost) {
    const existingVendor = vendorName
      ? vendors.find(v => sameEntity(v.name, vendorName))
      : vendors[0];
    const vName = existingVendor?.name || vendorName;

    if (vendorName && !existingVendor) {
      rows.push({
        key: 'vendor:new',
        label: 'Vendor',
        current: vendors.length ? vendors.map(v => v.name).filter(Boolean).join(', ') : null,
        proposed: vendorName,
        kind: vendors.length ? 'change' : 'fill',
        target: 'vendor',
      });
    }

    if (vendorNum) {
      const cur = existingVendor?.vendor_num || '';
      if (norm(cur) !== norm(vendorNum)) {
        rows.push({
          key: 'vendor:num',
          label: `Vendor# ${vName ? `(${vName})` : ''}`.trim(),
          current: cur || null,
          proposed: vendorNum,
          kind: cur ? 'change' : 'fill',
          target: 'vendor',
        });
      }
    }

    if (cost) {
      const price = parseFloat(cost);
      const cur = existingVendor?.price;
      if (!isNaN(price) && (cur == null || Math.abs(Number(cur) - price) > 0.005)) {
        rows.push({
          key: 'vendor:price',
          label: `Price ${vName ? `(${vName})` : ''}`.trim(),
          current: cur ?? null,
          proposed: price,
          kind: cur == null ? 'fill' : 'change',
          target: 'vendor',
        });
      }
    }

    const effectiveNum = vendorNum || existingVendor?.vendor_num || '';
    if (vName && effectiveNum && !existingVendor?.vendor_num_url && vendorHasUrlGenerator(vName)) {
      const url = generateVendorUrl(vName, effectiveNum);
      if (url) {
        rows.push({
          key: 'vendor:num_url',
          label: 'Vendor link',
          current: null,
          proposed: url,
          kind: 'fill',
          target: 'vendor',
          generated: true,
        });
      }
    }
  }

  return { rows, newManufacturer: isNewMfg ? brand : null };
}

/**
 * Replay the ACCEPTED purchasing rows onto a purchasing object.
 *
 * Never mutates the input. Rows that were rejected simply don't happen — a
 * rejected manufacturer row means the EDP/link rows still land on whichever
 * manufacturer row the tool already had (or nowhere, if it had none).
 */
export function applyPurchasingRows(purchasing, extracted, acceptedKeys) {
  const accepted = new Set(acceptedKeys);
  if (accepted.size === 0) return purchasing;

  const mfgs = (purchasing?.manufacturers || []).map(m => ({ ...m }));
  const vendors = (purchasing?.vendors || []).map(v => ({ ...v }));

  const brand = extracted.approvedBrand || '';
  let mfg = brand ? mfgs.find(m => sameEntity(m.name, brand)) : mfgs[0];

  if (!mfg && accepted.has('mfg:new') && brand) {
    mfg = {
      id: generateId(),
      registry_id: registryIdForName(brand),
      name: brand,
      edp: '',
      edp_url: '',
      mfg_num: '',
      mfg_num_url: '',
      order: mfgs.length,
    };
    mfgs.push(mfg);
  }

  if (mfg) {
    if (accepted.has('mfg:edp') && extracted.edpNumber) mfg.edp = extracted.edpNumber;
    if (accepted.has('mfg:edp_url')) {
      const url = manufacturerHasUrlGenerator(mfg.name)
        ? generateManufacturerUrl(mfg.name, mfg.edp)
        : (extracted.productLink || '');
      if (url) mfg.edp_url = url;
    }
  }

  const vendorName = extracted.vendor || '';
  let vendor = vendorName ? vendors.find(v => sameEntity(v.name, vendorName)) : vendors[0];

  const wantsVendorRow = ['vendor:new', 'vendor:num', 'vendor:price', 'vendor:num_url']
    .some(k => accepted.has(k));
  if (!vendor && wantsVendorRow && vendorName) {
    vendor = {
      id: generateId(),
      manufacturer_id: mfg?.id || null,
      registry_id: registryIdForName(vendorName),
      name: vendorName,
      vendor_num: '',
      vendor_num_url: '',
      price: null,
      order: vendors.length,
    };
    vendors.push(vendor);
  }

  if (vendor) {
    if (accepted.has('vendor:num') && extracted.vendorStockNum) vendor.vendor_num = extracted.vendorStockNum;
    if (accepted.has('vendor:price') && extracted.cost) {
      const p = parseFloat(extracted.cost);
      if (!isNaN(p)) vendor.price = p;
    }
    if (accepted.has('vendor:num_url')) {
      const url = generateVendorUrl(vendor.name, vendor.vendor_num);
      if (url) vendor.vendor_num_url = url;
    }
  }

  return { manufacturers: mfgs, vendors };
}
