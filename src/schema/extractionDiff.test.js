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

describe('purchasing URLs — generated where a pattern exists, filled only when blank', () => {
  it('generates a manufacturer link from the EDP', () => {
    const { rows } = buildPurchasingProposals(endMill(), {
      approvedBrand: 'GARR Tool', edpNumber: '12345',
    });
    const url = rows.find(r => r.key === 'mfg:edp_url');
    expect(url.generated).toBe(true);
    expect(url.proposed).toContain('12345');
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
    expect(next.vendors[0].vendor_num_url).toContain('99377473');
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
