import { describe, it, expect } from 'vitest';
import {
  INSERT_FAMILIES, INSERT_FAMILY_BY_ID, PROSHOP_FAMILY_MAP,
  splitCombinedProShopId, composeCombinedProShopId, ensureProShopPrefix,
  pairedAsmIdPart, pairingAsmNumber, newComponent, newPairing,
  componentById, defaultFamilyForType,
  ALWAYS_INSERT_TYPES, autoInsertFamily,
} from './insertFamilies.js';

describe('family list ↔ ProShop map', () => {
  it('every family has a ProShop translation row', () => {
    for (const fam of INSERT_FAMILIES) {
      expect(PROSHOP_FAMILY_MAP[fam.id], fam.id).toBeTruthy();
      expect(PROSHOP_FAMILY_MAP[fam.id].holder_prefix).toBeTruthy();
      expect(PROSHOP_FAMILY_MAP[fam.id].insert_prefix).toBeTruthy();
    }
  });

  it('only the milling families carry a tier-3 assembly', () => {
    const tier3 = INSERT_FAMILIES.filter(f => f.hasTier3Assembly).map(f => f.id);
    expect(tier3.sort()).toEqual(['indexable_drill', 'milling_insert']);
  });

  it('defaultFamilyForType suggests by tool type', () => {
    expect(defaultFamilyForType('face mill')).toBe('milling_insert');
    expect(defaultFamilyForType('drill')).toBe('indexable_drill');
    expect(defaultFamilyForType('turning general')).toBe('id_threader'); // first turning family
    expect(defaultFamilyForType('flat end mill')).toBe('od_turning');    // fallback
  });
});

describe('always-insert auto view', () => {
  it('flags the tool types that are always insert-style (not drill)', () => {
    expect([...ALWAYS_INSERT_TYPES].sort()).toEqual(['boring head', 'face mill', 'turning general']);
    expect(ALWAYS_INSERT_TYPES.has('drill')).toBe(false);
    expect(ALWAYS_INSERT_TYPES.has('flat end mill')).toBe(false);
  });

  it('autoInsertFamily is unambiguous for milling/boring, OD turning for turning', () => {
    expect(autoInsertFamily('face mill')).toBe('milling_insert');
    expect(autoInsertFamily('boring head')).toBe('boring_bar');
    expect(autoInsertFamily('turning general')).toBe('od_turning');
  });

  it('every auto family resolves and carries the expected tier-3 flag', () => {
    expect(INSERT_FAMILY_BY_ID['milling_insert'].hasTier3Assembly).toBe(true);
    expect(INSERT_FAMILY_BY_ID['boring_bar'].hasTier3Assembly).toBe(false);
    expect(INSERT_FAMILY_BY_ID['od_turning'].hasTier3Assembly).toBe(false);
  });
});

describe('splitCombinedProShopId', () => {
  it('splits and classifies a holder-first combined id', () => {
    expect(splitCombinedProShopId('TF-194/TO-195')).toEqual({
      family: 'od_turning', holder_id: 'TF-194', insert_id: 'TO-195',
    });
  });

  it('order is not guaranteed — insert-first still classifies', () => {
    expect(splitCombinedProShopId('TO-195/TF-194')).toEqual({
      family: 'od_turning', holder_id: 'TF-194', insert_id: 'TO-195',
    });
  });

  it('handles the single-letter milling prefixes (I/G)', () => {
    expect(splitCombinedProShopId('I-167/G-168')).toEqual({
      family: 'milling_insert', holder_id: 'I-167', insert_id: 'G-168',
    });
  });

  it('disambiguates the shared TL insert code by holder prefix', () => {
    expect(splitCombinedProShopId('TD-12/TL-9').family).toBe('boring_bar');
    expect(splitCombinedProShopId('TE-12/TL-9').family).toBe('back_boring_bar');
  });

  it('returns null for non-combined or unrecognized ids', () => {
    expect(splitCombinedProShopId('A-3')).toBeNull();
    expect(splitCombinedProShopId('')).toBeNull();
    expect(splitCombinedProShopId('XX-1/YY-2')).toBeNull();
    expect(splitCombinedProShopId('TF-1/TO-2/TL-3')).toBeNull();
  });
});

describe('ensureProShopPrefix / composeCombinedProShopId', () => {
  it('keeps an id that already carries its prefix', () => {
    expect(ensureProShopPrefix('TF-194', 'TF')).toBe('TF-194');
    expect(ensureProShopPrefix('tf-194', 'TF')).toBe('tf-194');
  });

  it('prepends the prefix to a bare number', () => {
    expect(ensureProShopPrefix('194', 'TF')).toBe('TF-194');
  });

  it('trusts a different existing letter prefix', () => {
    expect(ensureProShopPrefix('G-9', 'TO')).toBe('G-9');
  });

  it('composes holder-first and returns "" until both ids exist', () => {
    const holder = { tool_id: '194' };
    const insert = { tool_id: 'TO-195' };
    expect(composeCombinedProShopId('od_turning', holder, insert)).toBe('TF-194/TO-195');
    expect(composeCombinedProShopId('od_turning', holder, { tool_id: '' })).toBe('');
    expect(composeCombinedProShopId('od_turning', null, insert)).toBe('');
  });

  it('round-trips through splitCombinedProShopId', () => {
    const combined = composeCombinedProShopId('id_groover', { tool_id: '12' }, { tool_id: '34' });
    expect(splitCombinedProShopId(combined)).toEqual({
      family: 'id_groover', holder_id: 'TI-12', insert_id: 'TQ-34',
    });
  });
});

describe('pairing assembly numbers', () => {
  const components = [
    { id: 'h1', role: 'holder_body', tool_id: '1001' },
    { id: 'i1', role: 'insert', tool_id: '1042' },
    { id: 'i2', role: 'insert', tool_id: '' },
  ];
  const pairing = { family: 'od_turning', holder_component_id: 'h1', insert_component_id: 'i1' };

  it('pairedAsmIdPart joins both ids with + (tier-3 id token)', () => {
    expect(pairedAsmIdPart(pairing, components)).toBe('1001+1042');
  });

  it('pairingAsmNumber joins both ids with / (turning families)', () => {
    expect(pairingAsmNumber(pairing, components)).toBe('1001/1042');
  });

  it('always shows both slots — a missing id renders as ?', () => {
    const p = { ...pairing, insert_component_id: 'i2' };
    expect(pairedAsmIdPart(p, components)).toBe('1001+?');
    expect(pairingAsmNumber(p, components)).toBe('1001/?');
  });

  it('returns "" when neither component resolves', () => {
    expect(pairingAsmNumber({ family: 'od_turning' }, components)).toBe('');
    expect(pairedAsmIdPart({ family: 'od_turning' }, components)).toBe('');
  });

  it('componentById accepts the file shape or a plain array', () => {
    expect(componentById(components, 'h1')?.tool_id).toBe('1001');
    expect(componentById({ components }, 'i1')?.tool_id).toBe('1042');
    expect(componentById(components, 'nope')).toBeNull();
  });
});

describe('record factories', () => {
  it('newComponent builds a full component record with a stable UUID', () => {
    const c = newComponent('insert', 'od_turning');
    expect(c.id).toBeTruthy();
    expect(c.role).toBe('insert');
    expect(c.family).toBe('od_turning');
    expect(c.purchasing).toEqual({ manufacturers: [], vendors: [] });
    expect(c.tool_location).toBeNull();
  });

  it('newPairing starts unlinked with an empty RTA#', () => {
    const p = newPairing('boring_bar');
    expect(p).toEqual({
      family: 'boring_bar',
      holder_component_id: null,
      insert_component_id: null,
      rta_number: '',
    });
    expect(INSERT_FAMILY_BY_ID[p.family].hasTier3Assembly).toBe(false);
  });
});
