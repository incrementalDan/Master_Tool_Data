// Locks the three rules that make an extraction safe to run against an
// EXISTING tool (see extractionDiff.js header), plus the purchasing sub-diff.
//
// Every case here is a bug that would otherwise be silent: a field the spec
// sheet never mentioned proposing to blank real data, a millimetres tool
// showing every length as changed, a field reaching Fusion on a tool type that
// has no such field, or the "different manufacturer" warning firing on an
// alias.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  buildFieldProposals, buildPurchasingProposals, applyPurchasingRows,
  extractedToToolFields, sameValue, sameEntity,
} from './extractionDiff.js';
import { setActiveVendorRegistry, DEFAULT_VENDOR_REGISTRY } from './vendorRegistry.js';
import { sanitizeExtraction, applyExtractionToBlank } from '../services/extractionService.js';
import { BLANK } from '../../tool-extractor.tsx';
import { fieldControl, coatingOptions } from './toolFieldLayout.js';
import { FIELD_REGISTRY, FLUTE_DESIGN_OPTIONS } from './fieldRegistry.js';
import { readFileSync } from 'node:fs';

beforeAll(() => setActiveVendorRegistry(DEFAULT_VENDOR_REGISTRY));

const endMill = (over = {}) => ({
  id: 'FTL-000001',
  tool_type: 'flat end mill',
  unit: 'inches',
  description: '1/2 4FL EM',
  diameter: 0.5,
  flute_length: 1.0,
  overall_length: 3.0,
  number_of_flutes: 4,
  material: 'carbide',
  coating: '',
  helix_angle: null,
  purchasing: { manufacturers: [], vendors: [] },
  ...over,
});

describe('rule 1 — a sparse extraction only proposes what the sheet answered', () => {
  it('does not propose the fields the sheet never mentioned', () => {
    // The sheet gave a helix angle and nothing else.
    const { proposals } = buildFieldProposals(endMill(), { helixAngle: '38' });
    expect(proposals.map(p => p.field)).toEqual(['helix_angle']);
  });

  it('never proposes blanking a stored value', () => {
    const tool = endMill({ coating: 'AlTiN', flute_type: 'Finishing' });
    const { proposals } = buildFieldProposals(tool, { diameter: '0.5' });
    // diameter already matches, coating/flute_type were not on the sheet.
    expect(proposals).toHaveLength(0);
  });

  it('the sanitizer omits rather than defaults — the source of that sparseness', () => {
    const { fields } = sanitizeExtraction({ diameter: '0.375', material: 'nonsense', coating: '' });
    expect(fields).toEqual({ diameter: '0.375' });
    expect('material' in fields).toBe(false);
    expect('coating' in fields).toBe(false);
  });

  it('a model `false` boolean is not treated as an answer', () => {
    // Indistinguishable from "didn't look" — must never turn a real flag off.
    const { fields } = sanitizeExtraction({ centerCutting: false, fullProfile: true });
    expect('centerCutting' in fields).toBe(false);
    expect(fields.fullProfile).toBe(true);
  });
});

describe('rule 2 — fields are gated by the tool type', () => {
  it('drops a field that does not apply to this type', () => {
    // corner_radius applies to bull nose / radius / lollipop / slot-key — NOT
    // a flat end mill. Letting it through would push a field to Fusion on a
    // type that has no such field.
    const { proposals } = buildFieldProposals(endMill(), { cornerRadius: '0.03' });
    expect(proposals).toHaveLength(0);
  });

  it('keeps the same field on a type that does have it', () => {
    const tool = endMill({ tool_type: 'bull nose end mill' });
    const { proposals } = buildFieldProposals(tool, { cornerRadius: '0.03' });
    expect(proposals.map(p => p.field)).toEqual(['corner_radius']);
  });

  it('keeps tap-only fields on a tap', () => {
    const tap = endMill({ tool_type: 'tap', material: 'hss', diameter: 0.25 });
    const { proposals } = buildFieldProposals(tap, {
      pitch: '1/4-20 UNC', pointType: 'Spiral Point', tapSubType: 'form',
    });
    expect(proposals.map(p => p.field).sort())
      .toEqual(['pitch', 'point_type', 'tap_sub_type']);
  });
});

describe('rule 3 — the model always answers in inches', () => {
  it('converts into a millimetres tool rather than reporting a huge change', () => {
    const mm = endMill({ unit: 'millimeters', diameter: 12.7, flute_length: 25.4 });
    // 0.5 in / 1.0 in — the same tool, stated in the sheet's inches.
    const { proposals } = buildFieldProposals(mm, { diameter: '0.5', loc: '1.0' });
    expect(proposals).toHaveLength(0);
  });

  it('marks a converted proposal so the row can say so', () => {
    const mm = endMill({ unit: 'millimeters', diameter: 12.7 });
    const { proposals } = buildFieldProposals(mm, { diameter: '0.625' });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].converted).toBe(true);
    expect(proposals[0].proposed).toBeCloseTo(15.875, 6);
  });

  it('leaves an inch tool untouched', () => {
    const { converted } = extractedToToolFields({ diameter: '0.5' }, endMill());
    expect(converted.size).toBe(0);
  });
});

describe('change vs fill', () => {
  it('an empty field being filled is a fill', () => {
    const { proposals } = buildFieldProposals(endMill(), { coating: 'AlTiN' });
    expect(proposals[0].kind).toBe('fill');
  });

  it('overwriting a real value is a change', () => {
    const { proposals } = buildFieldProposals(endMill({ coating: 'TiAlN' }), { coating: 'AlTiN' });
    expect(proposals[0].kind).toBe('change');
  });

  it('a boolean over a stored false is a change, never an auto-accepted fill', () => {
    const { proposals } = buildFieldProposals(endMill({ center_cutting: false }), { centerCutting: true });
    expect(proposals[0].kind).toBe('change');
  });
});

describe('float noise is not a difference', () => {
  it('ignores a diff below display precision', () => {
    expect(sameValue(0.5, 0.500001, 'diameter', 'inches')).toBe(true);
    expect(sameValue(0.5, 0.5001, 'diameter', 'inches')).toBe(false);
  });

  it('compares flute counts exactly', () => {
    expect(sameValue(4, 4, 'number_of_flutes')).toBe(true);
    expect(sameValue(4, 3, 'number_of_flutes')).toBe(false);
  });

  it('is case and whitespace insensitive on strings', () => {
    expect(sameValue('AlTiN', ' altin ', 'coating')).toBe(true);
  });
});

describe('tool_type is a notice, never a proposal', () => {
  it('surfaces a disagreement without offering to apply it', () => {
    const { proposals, typeNotice } = buildFieldProposals(endMill(), { toolType: 'ball end mill' });
    expect(proposals.some(p => p.field === 'tool_type')).toBe(false);
    expect(typeNotice).toEqual({ extractedType: 'ball end mill', currentType: 'flat end mill' });
  });

  it('is silent when the types agree', () => {
    const { typeNotice } = buildFieldProposals(endMill(), { toolType: 'flat end mill' });
    expect(typeNotice).toBeNull();
  });
});

describe('purchasing — entity matching, not string matching', () => {
  const withGarr = () => endMill({
    purchasing: {
      manufacturers: [{ id: 'm1', name: 'GARR Tool', edp: '', edp_url: '', order: 0 }],
      vendors: [],
    },
  });

  it('an alias is the SAME manufacturer — no warning', () => {
    // "GARR" on the sheet vs "GARR Tool" stored. Firing the different-maker
    // warning here would make it fire on nearly every scan.
    expect(sameEntity('GARR', 'GARR Tool')).toBe(true);
    const { rows, newManufacturer } = buildPurchasingProposals(withGarr(), {
      approvedBrand: 'GARR', edpNumber: '12345',
    });
    expect(newManufacturer).toBeNull();
    expect(rows.some(r => r.key === 'mfg:new')).toBe(false);
    expect(rows.find(r => r.key === 'mfg:edp').proposed).toBe('12345');
  });

  it('a genuinely different manufacturer requires acknowledgement', () => {
    const { rows, newManufacturer } = buildPurchasingProposals(withGarr(), {
      approvedBrand: 'Helical Solutions', edpNumber: '99',
    });
    expect(newManufacturer).toBe('Helical Solutions');
    const row = rows.find(r => r.key === 'mfg:new');
    expect(row.requiresAck).toBe(true);
    expect(row.current).toBe('GARR Tool');
  });

  it('the first manufacturer on a bare tool needs no acknowledgement', () => {
    const { rows, newManufacturer } = buildPurchasingProposals(endMill(), {
      approvedBrand: 'Helical Solutions',
    });
    expect(newManufacturer).toBeNull();
    expect(rows.find(r => r.key === 'mfg:new').requiresAck).toBeFalsy();
  });

  it('adds rather than substitutes — the existing maker survives', () => {
    const tool = withGarr();
    const extracted = { approvedBrand: 'Helical Solutions', edpNumber: '99' };
    const { rows } = buildPurchasingProposals(tool, extracted);
    const next = applyPurchasingRows(tool.purchasing, extracted, rows.map(r => r.key));
    expect(next.manufacturers.map(m => m.name)).toEqual(['GARR Tool', 'Helical Solutions']);
    expect(next.manufacturers[1].edp).toBe('99');
    // The FK into the shared registry is stamped at creation, not left null.
    expect(next.manufacturers[1].registry_id).toBeTruthy();
  });

  it('a rejected row simply does not happen', () => {
    const tool = withGarr();
    const extracted = { approvedBrand: 'Helical Solutions', edpNumber: '99' };
    const next = applyPurchasingRows(tool.purchasing, extracted, []);
    expect(next).toEqual(tool.purchasing);
  });
});

describe('purchasing URLs — the registry pattern wins, the scan only fills a gap', () => {
  // ⚠️ A manufacturer the registry can compose a URL for has NOTHING to decide:
  // the link is derived from the pattern and the pattern always wins, so that one
  // edit in /vendors corrects every tool. Offering the scraped link here would be
  // offering to store a static URL that is then ignored.
  it('proposes NO link row when the registry has a pattern for the manufacturer', () => {
    const { rows } = buildPurchasingProposals(endMill(), {
      approvedBrand: 'GARR Tool', edpNumber: '12345',
      productLink: 'https://example.com/scanned',
    });
    expect(rows.some(r => r.key === 'mfg:edp_url')).toBe(false);
  });

  it('falls back to the scraped product link when there is no generator', () => {
    const { rows } = buildPurchasingProposals(endMill(), {
      approvedBrand: 'Some Unknown Toolworks',
      edpNumber: 'X-1',
      productLink: 'https://example.com/x1',
    });
    const url = rows.find(r => r.key === 'mfg:edp_url');
    expect(url.generated).toBe(false);
    expect(url.proposed).toBe('https://example.com/x1');
  });

  it('never overwrites a hand-corrected URL', () => {
    const tool = endMill({
      purchasing: {
        manufacturers: [{ id: 'm1', name: 'GARR Tool', edp: '12345', edp_url: 'https://hand.example/fixed', order: 0 }],
        vendors: [],
      },
    });
    const { rows } = buildPurchasingProposals(tool, { approvedBrand: 'GARR', edpNumber: '12345' });
    expect(rows.some(r => r.key === 'mfg:edp_url')).toBe(false);
  });

  it('links a new vendor row to the manufacturer it belongs to', () => {
    const extracted = {
      approvedBrand: 'GARR Tool', edpNumber: '12345',
      vendor: 'MSC Industrial', vendorStockNum: '99377473', cost: '34.76',
    };
    const { rows } = buildPurchasingProposals(endMill(), extracted);
    const next = applyPurchasingRows(endMill().purchasing, extracted, rows.map(r => r.key));
    expect(next.vendors).toHaveLength(1);
    expect(next.vendors[0].manufacturer_id).toBe(next.manufacturers[0].id);
    expect(next.vendors[0].price).toBe(34.76);
  });

  // ⚠️ Learning the SHAPE is what makes a link mass-updatable later. Offered,
  // never auto-accepted — it changes every tool of that manufacturer.
  it('offers to learn the link format for a manufacturer with no pattern', () => {
    const { rows } = buildPurchasingProposals(endMill(), {
      approvedBrand: 'Fraisa USA', edpNumber: 'X-1',
      productLink: 'https://fraisa.example/tools/X-1',
    });
    const row = rows.find(r => r.key === 'mfg:url_pattern');
    expect(row.kind).toBe('change');                       // never auto-accepted
    expect(row.proposed).toBe('https://fraisa.example/tools/{edp}');
    expect(row.patternField).toBe('edp_url_pattern');
    expect(row.registryId).toBeTruthy();                   // targets a real entity
  });

  it('offers no pattern row when the manufacturer already has one', () => {
    const { rows } = buildPurchasingProposals(endMill(), {
      approvedBrand: 'GARR Tool', edpNumber: '12345',
      productLink: 'https://www.garrtool.com/product-details/?EDP=12345',
    });
    expect(rows.some(r => r.key === 'mfg:url_pattern')).toBe(false);
  });

  it('offers no pattern row when the shape can’t be derived with certainty', () => {
    const { rows } = buildPurchasingProposals(endMill(), {
      approvedBrand: 'Fraisa USA', edpNumber: 'X-1',
      productLink: 'https://fraisa.example/p/X-1?sid=ABC123&node=99',
    });
    expect(rows.some(r => r.key === 'mfg:url_pattern')).toBe(false);
  });

  // A manufacturer that isn't in the registry has nothing to hang a pattern on.
  it('offers no pattern row for a manufacturer the registry doesn’t know', () => {
    const { rows } = buildPurchasingProposals(endMill(), {
      approvedBrand: 'Some Unknown Toolworks', edpNumber: 'X-1',
      productLink: 'https://unknown.example/tools/X-1',
    });
    expect(rows.some(r => r.key === 'mfg:url_pattern')).toBe(false);
    // …but the scraped link is still offered, since there's no pattern to derive.
    expect(rows.some(r => r.key === 'mfg:edp_url')).toBe(true);
  });

  // The vendor link is never a row — it is derived from the registry pattern on
  // read and on save (syncPurchasingFromRegistry / backfillUrls).
  it('proposes NO vendor link row', () => {
    const { rows } = buildPurchasingProposals(endMill(), {
      vendor: 'MSC Industrial', vendorStockNum: '99377473',
    });
    expect(rows.some(r => r.key === 'vendor:num_url')).toBe(false);
  });
});

describe('the ADD path keeps its original behaviour on the shared service', () => {
  // The extraction call was lifted out of tool-extractor.tsx so both entry
  // points share it. The add form's contract is the opposite of the update
  // form's: whatever the sheet did NOT answer must be CLEARED, not preserved.
  it('clears everything the sheet did not answer, back to the form defaults', () => {
    const prev = { ...BLANK, diameter: '9.99', coating: 'TiN', flutes: '2', centerCutting: true };
    const { fields } = sanitizeExtraction({ diameter: '0.375' });
    const next = applyExtractionToBlank(prev, fields);

    expect(next.diameter).toBe('0.375');
    expect(next.coating).toBe('');            // was TiN, not on the sheet
    expect(next.flutes).toBe('');
    expect(next.centerCutting).toBe(false);
    // The defaults the original inline code fell back to, unchanged.
    expect(next.material).toBe('carbide');
    expect(next.coolant).toBe('flood');
    expect(next.cornerRadius).toBe('0');
    expect(next.cuttingDirection).toBe('Right Hand');
  });

  it('leaves the current tool type alone when the sheet names none', () => {
    const prev = { ...BLANK, toolType: 'reamer' };
    const { fields } = sanitizeExtraction({ diameter: '0.25' });
    expect(applyExtractionToBlank(prev, fields).toolType).toBe('reamer');
  });

  it('applies an extracted tool type over it', () => {
    const prev = { ...BLANK, toolType: 'reamer' };
    const { fields } = sanitizeExtraction({ toolType: 'drill', diameter: '0.25' });
    expect(applyExtractionToBlank(prev, fields).toolType).toBe('drill');
  });

  it('does not touch the shop-owned identity fields', () => {
    // Tool #, location and machine number are never in the extraction's
    // vocabulary at all, so neither flow can reach them.
    const prev = { ...BLANK, psToolId: 'A-3', location: 'LC-140', toolNumber: '42' };
    const { fields } = sanitizeExtraction({ diameter: '0.5', psToolId: 'Z-9', location: 'XX-1', toolNumber: '7' });
    const next = applyExtractionToBlank(prev, fields);
    expect(next.psToolId).toBe('A-3');
    expect(next.location).toBe('LC-140');
    expect(next.toolNumber).toBe('42');
  });

  it('still lets the add form own OOH, exactly as before the refactor', () => {
    // OOH is an extractor form field (the prompt tells the model to leave it
    // empty, and an absent answer clears it) — unchanged behaviour. On the
    // UPDATE path it is not proposable at all: stick-out is per-assembly, so a
    // spec sheet has no business setting it. See the scalar-scope test below.
    const { fields } = sanitizeExtraction({ ooh: '9' });
    expect(applyExtractionToBlank({ ...BLANK, ooh: '2.125' }, fields).ooh).toBe('9');
    const { fields: none } = sanitizeExtraction({ diameter: '0.5' });
    expect(applyExtractionToBlank({ ...BLANK, ooh: '2.125' }, none).ooh).toBe('');
  });
});

describe('an update can never reach beyond scalar fields', () => {
  it('proposes nothing for presets, assemblies, Tool ID, location or machine number', () => {
    const tool = endMill({
      tool_id: 'A-3',
      location: 'LC-140',
      machine_tool_number: 42,
      presets: [{ guid: 'p1', name: 'AL 2.125 - Rough', n: 8000 }],
      assemblies: [{ assembly_id: 'a1', ooh: 2.125 }],
    });
    // A deliberately greedy payload, including keys the model is told not to answer.
    const { proposals } = buildFieldProposals(tool, {
      diameter: '0.625', ooh: '9', toolNumber: '7', psToolId: 'Z-9', location: 'XX-1',
    });
    const fields = proposals.map(p => p.field);
    expect(fields).toEqual(['diameter']);
    for (const forbidden of ['presets', 'assemblies', 'tool_id', 'location', 'machine_tool_number', 'ooh']) {
      expect(fields).not.toContain(forbidden);
    }
  });
});

describe('coating is an OPEN, growing list', () => {
  // Regression: coating rendered as a closed <select> of 6 generic names, so a
  // real manufacturer coating ("ZPLUS" on a Helical page) was extracted and
  // stored but displayed BLANK — and was lost the moment the dropdown was
  // touched. It reads as "the scan didn't pull the coating".
  it('is a datalist, never a closed select', () => {
    expect(fieldControl('coating')).toBe('datalist');
  });

  it('keeps a manufacturer coating verbatim', () => {
    const { fields } = sanitizeExtraction({ coating: 'ZPLUS' });
    expect(fields.coating).toBe('ZPLUS');
    const { proposals } = buildFieldProposals(endMill(), { coating: 'ZPLUS' });
    expect(proposals).toEqual([expect.objectContaining({ field: 'coating', proposed: 'ZPLUS', kind: 'fill' })]);
  });

  it('suggests the seed plus every coating already in the library', () => {
    const opts = coatingOptions([
      { coating: 'ZPLUS' }, { coating: 'Tuff-Coat' }, { coating: '' }, { coating: 'altin' },
    ]);
    expect(opts).toContain('ZPLUS');
    expect(opts).toContain('Tuff-Coat');
    expect(opts).toContain('AlTiN');           // seed spelling wins
    expect(opts.filter(o => o.toLowerCase() === 'altin')).toHaveLength(1);  // deduped
  });
});

describe('flute design is a CLOSED list the model maps onto', () => {
  // Regression: fluteDesign was never asked for at all, so "Variable Pitch" in
  // a product title was silently never extracted.
  it('is extracted and mapped to the app field', () => {
    const { fields } = sanitizeExtraction({ fluteDesign: 'Variable Pitch' });
    expect(fields.fluteDesign).toBe('Variable Pitch');
    const { proposals } = buildFieldProposals(endMill(), { fluteDesign: 'Variable Pitch' });
    expect(proposals).toEqual([expect.objectContaining({ field: 'flute_design', proposed: 'Variable Pitch' })]);
  });

  it('accepts a differently-cased or -spaced answer', () => {
    expect(sanitizeExtraction({ fluteDesign: 'variable  pitch' }).fields.fluteDesign).toBe('Variable Pitch');
    expect(sanitizeExtraction({ fluteDesign: 'VARIABLE HELIX' }).fields.fluteDesign).toBe('Variable Helix');
  });

  it('drops an answer outside the list rather than inventing an option', () => {
    const { fields } = sanitizeExtraction({ fluteDesign: 'Unequal Spacing' });
    expect('fluteDesign' in fields).toBe(false);
  });

  it('never reaches a tap, which has no flute design', () => {
    const tap = endMill({ tool_type: 'tap', material: 'hss' });
    const { proposals } = buildFieldProposals(tap, { fluteDesign: 'Variable Pitch' });
    expect(proposals).toHaveLength(0);
  });

  it('is cleared by the add path when the sheet does not mention it', () => {
    const { fields } = sanitizeExtraction({ diameter: '0.5' });
    expect(applyExtractionToBlank({ ...BLANK, fluteDesign: 'Variable Helix' }, fields).fluteDesign).toBe('');
  });
});

describe('the second run reports nothing to do', () => {
  it('is idempotent across fields and purchasing', () => {
    const extracted = {
      diameter: '0.5', loc: '1.0', coating: 'AlTiN', helixAngle: '38',
      approvedBrand: 'GARR Tool', edpNumber: '12345',
      vendor: 'MSC Industrial', vendorStockNum: '777', cost: '20.00',
    };
    const tool = endMill();

    const first = buildFieldProposals(tool, extracted);
    const firstPurch = buildPurchasingProposals(tool, extracted);
    expect(first.proposals.length).toBeGreaterThan(0);
    expect(firstPurch.rows.length).toBeGreaterThan(0);

    // Accept everything, exactly as the form would.
    const applied = { ...tool };
    for (const p of first.proposals) applied[p.field] = p.proposed;
    applied.purchasing = applyPurchasingRows(tool.purchasing, extracted, firstPurch.rows.map(r => r.key));

    expect(buildFieldProposals(applied, extracted).proposals).toEqual([]);
    expect(buildPurchasingProposals(applied, extracted).rows).toEqual([]);
  });
});

// ⚠️ TIP DIAMETER WAS NEVER ASKED FOR. The extraction schema had `tipAngle` but
// no `tipDiameter` key at all, it was absent from EXTRACTED_KEYS, and the UPDATE
// path's field map (extractionDiff) lacked it even though the ADD path's
// (extractorConvert) had it. So a chamfer mill's tip diameter could not be
// scanned no matter how the sheet labelled it — the observed miss was on a sheet
// that shortened the column to just "Tip".
//
// Real-library evidence for the types that matter: ALL 17 chamfer mills and 10
// of 11 spot drills carry a non-zero geometry.tip-diameter.
describe('tip diameter is extractable', () => {
  const chamfer = {
    id: 'FTL-1', tool_type: 'chamfer mill', unit: 'inches',
    description: '.25 CHAMFER 60DEG', diameter: 0.25, tip_diameter: null,
  };

  it('survives the sanitizer instead of being dropped', () => {
    const { fields } = sanitizeExtraction({ tipDiameter: '0.055' });
    expect(fields).toHaveProperty('tipDiameter', '0.055');
  });

  it('becomes a proposal on a chamfer mill', () => {
    const { proposals } = buildFieldProposals(chamfer, { tipDiameter: '0.055' });
    const row = proposals.find(x => x.field === 'tip_diameter');
    expect(row).toBeTruthy();
    expect(row.proposed).toBeCloseTo(0.055, 6);
    expect(row.kind).toBe('fill');          // the tool had none
  });

  it('reaches the other types that have a tip', () => {
    for (const t of ['spot drill', 'center drill', 'counter sink', 'dovetail', 'thread mill']) {
      const { proposals } = buildFieldProposals({ ...chamfer, tool_type: t }, { tipDiameter: '0.055' });
      expect(proposals.some(x => x.field === 'tip_diameter')).toBe(true);
    }
  });

  // Rule 2 — type-gated before the UI, so it can't be swept up by "Update all"
  // and pushed to Fusion on a type that has no such field.
  it('is still dropped on a type that has no tip diameter', () => {
    const { proposals } = buildFieldProposals({ ...chamfer, tool_type: 'flat end mill' }, { tipDiameter: '0.055' });
    expect(proposals.some(x => x.field === 'tip_diameter')).toBe(false);
  });

  // Rule 3 — the model always answers in inches; a mm tool must not read 0.055
  // as millimetres (it would show a change on a tool that is already correct).
  it('converts into a millimetres tool\u2019s own unit', () => {
    const mm = { ...chamfer, unit: 'millimeters', tip_diameter: 1.397 };
    const { proposals } = buildFieldProposals(mm, { tipDiameter: '0.055' });
    expect(proposals.some(x => x.field === 'tip_diameter')).toBe(false);   // 0.055in === 1.397mm
  });

  it('flows through the ADD path too', () => {
    const { fields } = sanitizeExtraction({ tipDiameter: '0.055' });
    expect(applyExtractionToBlank(BLANK, fields).tipDiameter).toBe('0.055');
  });
});

// ⚠️ TAPS HAVE NO TIP DIAMETER, and the old FIELD_VISIBILITY matrix says they
// do. This asserts the registry against the real Fusion exports so the claim in
// the registry comment can't rot: the tell is the paired expression, which
// Fusion writes only for a type that really owns the field.
describe('which types actually have a tip diameter (real Fusion exports)', () => {
  const REF = JSON.parse(
    readFileSync(new URL('../../FUSION TOOL Library REF/Full_Type_List Examples.json', import.meta.url), 'utf8')
  ).data;
  const withExpression = (type) => REF.filter(t => t.type === type && t.expressions?.tool_tipDiameter);

  it('no tap carries a tip diameter', () => {
    const taps = REF.filter(t => String(t.type || '').includes('tap'));
    expect(taps.length).toBeGreaterThan(0);
    expect(taps.filter(t => (t.geometry || {})['tip-diameter'])).toHaveLength(0);
    expect(withExpression('tap right hand')).toHaveLength(0);
  });

  it('chamfer mills and spot drills do', () => {
    expect(withExpression('chamfer mill').length).toBeGreaterThan(0);
    expect(withExpression('spot drill').length).toBeGreaterThan(0);
  });

  it('the registry does not claim taps have one', () => {
    expect(FIELD_REGISTRY.tip_diameter.appliesToTypes).not.toContain('tap');
    expect(FIELD_REGISTRY.tip_diameter.appliesToTypes).toContain('chamfer mill');
    expect(FIELD_REGISTRY.tip_diameter.appliesToTypes).toContain('spot drill');
  });
});

// ⚠️ "None" IS AN ANSWER; BLANK IS NOT.
//   blank — nobody has looked at this tool yet (the default)
//   None  — somebody DID look, and the flutes are plain
// The distinction is the point of the option: it turns "we don't know" into a
// shrinking worklist. Collapsing the two, in either direction, destroys it.
describe('flute design — None is a recorded answer, blank is not', () => {
  it('accepts None as a real value', () => {
    expect(sanitizeExtraction({ fluteDesign: 'None' }).fields.fluteDesign).toBe('None');
    expect(sanitizeExtraction({ fluteDesign: 'none' }).fields.fluteDesign).toBe('None');
  });

  it('offers None in the picker list, with the variable options still there', () => {
    expect(FLUTE_DESIGN_OPTIONS).toContain('None');
    for (const o of ['Variable Index', 'Variable Flute', 'Variable Helix', 'Variable Pitch']) {
      expect(FLUTE_DESIGN_OPTIONS).toContain(o);
    }
  });

  // Setting None on a tool nobody had checked is a real edit, and must show as
  // one — not be swallowed as "still empty".
  it('proposes None over a blank field', () => {
    const { proposals } = buildFieldProposals(endMill({ flute_design: '' }), { fluteDesign: 'None' });
    expect(proposals).toEqual([expect.objectContaining({ field: 'flute_design', proposed: 'None' })]);
  });

  // ⚠️ The one that protects the meaning: a silent sheet must stay blank. The
  // prompt says so explicitly; this locks that nothing downstream fills it in.
  it('an extraction that says nothing leaves the field alone', () => {
    const { fields } = sanitizeExtraction({ diameter: '0.5' });
    expect('fluteDesign' in fields).toBe(false);
    const { proposals } = buildFieldProposals(endMill({ flute_design: '' }), { diameter: '0.5' });
    expect(proposals.some(p => p.field === 'flute_design')).toBe(false);
  });

  // None must not be quietly downgraded to blank on the way through storage.
  it('survives the metadata round trip as None', () => {
    expect(sanitizeExtraction({ fluteDesign: 'None' }).fields.fluteDesign).not.toBe('');
  });
});
