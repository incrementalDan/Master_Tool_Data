import { describe, it, expect } from 'vitest';
import {
  INSERT_FAMILIES, INSERT_FAMILY_BY_ID, PROSHOP_FAMILY_MAP, splitCombinedProShopId, composeCombinedProShopId, ensureProShopPrefix, pairedAsmIdPart, pairingAsmNumber, newComponent, newPairing, componentById, defaultFamilyForType, ALWAYS_INSERT_TYPES, autoInsertFamily, defaultActivationFamily, isCombinedProShopId, pairingFromCombinedId, derivePairings, normProShopId, insertComponentIndex,
} from './insertFamilies.js';

describe('family list ↔ ProShop map', () => {
  it('every syncable family has a ProShop translation row (generic is exempt)', () => {
    for (const fam of INSERT_FAMILIES) {
      if (fam.id === 'generic_insert') {
        expect(PROSHOP_FAMILY_MAP[fam.id]).toBeUndefined(); // no ProShop convention
        continue;
      }
      expect(PROSHOP_FAMILY_MAP[fam.id], fam.id).toBeTruthy();
      expect(PROSHOP_FAMILY_MAP[fam.id].holder_prefix).toBeTruthy();
      expect(PROSHOP_FAMILY_MAP[fam.id].insert_prefix).toBeTruthy();
    }
  });

  it('tier-3 families are the milling/indexable ones plus the generic catch-all', () => {
    const tier3 = INSERT_FAMILIES.filter(f => f.hasTier3Assembly).map(f => f.id);
    expect(tier3.sort()).toEqual(['generic_insert', 'indexable_drill', 'milling_insert']);
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

describe('manual activation on any tool type', () => {
  it('the generic catch-all family is tier-3 with no ProShop mapping', () => {
    const generic = INSERT_FAMILY_BY_ID['generic_insert'];
    expect(generic).toBeTruthy();
    expect(generic.hasTier3Assembly).toBe(true);
    expect(PROSHOP_FAMILY_MAP['generic_insert']).toBeUndefined();
  });

  // CHANGED DELIBERATELY: this used to return '' for a family with no letter
  // convention. But the shop DOES put a combined id in Fusion for exactly that
  // case — an insert end mill filed in ProShop as a normal end mill ("A-123")
  // plus a body under an arbitrary letter — so refusing to compose it left the
  // one case that most needs generating to be typed by hand.
  it('composeCombinedProShopId composes a no-convention family, holder body FIRST', () => {
    expect(composeCombinedProShopId('generic_insert', { tool_id: 'I-124' }, { tool_id: 'A-123' }))
      .toBe('I-124/A-123');
  });

  it('still applies the letter prefixes for families that have a convention', () => {
    expect(composeCombinedProShopId('milling_insert', { tool_id: '167' }, { tool_id: '168' }))
      .toBe('I-167/G-168');
  });

  it('defaultActivationFamily picks the natural family, else the generic catch-all', () => {
    expect(defaultActivationFamily('face mill')).toBe('milling_insert');
    expect(defaultActivationFamily('boring head')).toBe('boring_bar');
    expect(defaultActivationFamily('turning general')).toBe('od_turning');
    expect(defaultActivationFamily('drill')).toBe('indexable_drill');
    expect(defaultActivationFamily('slot/key cutter')).toBe('generic_insert');
    expect(defaultActivationFamily('ball end mill')).toBe('generic_insert');
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

describe('Fusion-side auto-detection (combined product-id)', () => {
  it('the slash is the insert-tool indicator', () => {
    expect(isCombinedProShopId('TF-194/TO-195')).toBe(true);
    expect(isCombinedProShopId('A-103/ I-98')).toBe(true);
    expect(isCombinedProShopId('A-3')).toBe(false);
    expect(isCombinedProShopId('')).toBe(false);
  });

  // The exact strings from the Fusion InsertToolREF export (with their
  // inconsistent spacing), across the tool types that carry a slash id.
  it('derives family + both component numbers for every reference case', () => {
    expect(pairingFromCombinedId('TF-194/ TO-195', 'turning general'))
      .toEqual({ family: 'od_turning', holder_id: 'TF-194', insert_id: 'TO-195' });
    expect(pairingFromCombinedId('I-224/ G-223', 'face mill'))
      .toEqual({ family: 'milling_insert', holder_id: 'I-224', insert_id: 'G-223' });
    expect(pairingFromCombinedId('I-126 / G-125', 'face mill'))
      .toEqual({ family: 'milling_insert', holder_id: 'I-126', insert_id: 'G-125' });
    expect(pairingFromCombinedId('TT-79 / TC-82', 'drill'))
      .toEqual({ family: 'indexable_drill', holder_id: 'TC-82', insert_id: 'TT-79' });
    // A pair whose letters ARE a convention is classified by them, so the order
    // in the string is irrelevant — note TT/TC arrives insert-first above and
    // still comes back with the holder correctly identified.
  });

  it('marks an unknown-prefix pair as a GUESS rather than claiming the order', () => {
    // Order is not a convention in the wild, and these letters carry no meaning
    // (an insert end mill is filed under the end-mill letter so ProShop search
    // finds it; its body gets whatever letter). Positional is only a seed — and
    // it must say so, because insertComponentIndex turns these roles into real
    // component records on the next ProShop import.
    expect(pairingFromCombinedId('N-31 / Q-134', 'slot mill'))
      .toEqual({ family: 'generic_insert', holder_id: 'N-31', insert_id: 'Q-134', order_unconfirmed: true });
    expect(pairingFromCombinedId('A-103/ I-98', 'flat end mill'))
      .toEqual({ family: 'generic_insert', holder_id: 'A-103', insert_id: 'I-98', order_unconfirmed: true });
  });

  it('does NOT mark a prefix-classified pair as unconfirmed', () => {
    expect(pairingFromCombinedId('I-224/ G-223', 'face mill').order_unconfirmed).toBeUndefined();
  });

  it('returns null for a non-combined id', () => {
    expect(pairingFromCombinedId('A-3', 'flat end mill')).toBeNull();
  });

  it('derivePairings sets an in-memory pairing and links existing components by number', () => {
    const components = [
      { id: 'h', role: 'holder_body', tool_id: 'TF-194' },
      { id: 'i', role: 'insert', tool_id: 'TO 195' }, // space variant — still matches
    ];
    const tools = [
      { id: 't1', tool_id: 'TF-194/ TO-195', tool_type: 'turning general' },
      { id: 't2', tool_id: 'A-42', tool_type: 'flat end mill' }, // no slash — untouched
    ];
    const [paired, plain] = derivePairings(tools, components);
    expect(paired.pairing).toEqual({
      family: 'od_turning', holder_component_id: 'h', insert_component_id: 'i',
      // The resolved numbers are STORED, not left to be re-parsed later.
      holder_proshop_id: 'TF-194', insert_proshop_id: 'TO-195',
      order_unconfirmed: false,
      rta_number: '',
    });
    expect(plain.pairing).toBeUndefined();
  });

  it('derivePairings leaves component links null when no component exists yet', () => {
    const [t] = derivePairings([{ id: 't', tool_id: 'I-224/ G-223', tool_type: 'face mill' }], []);
    expect(t.pairing.family).toBe('milling_insert');
    expect(t.pairing.holder_component_id).toBeNull();
    expect(t.pairing.insert_component_id).toBeNull();
  });

  it('derivePairings never overrides a stored pairing', () => {
    const stored = { family: 'generic_insert', holder_component_id: 'x', insert_component_id: 'y', rta_number: 'RTA-9' };
    const [t] = derivePairings([{ id: 't', tool_id: 'TF-194/TO-195', tool_type: 'turning general', pairing: stored }], []);
    expect(t.pairing).toBe(stored);
  });

  // F1: an auto-detected pairing can be persisted with NULL links before the
  // component records exist (saved between first load and the ProShop import).
  // Once the components exist, derivePairings must FILL those null links.
  it('derivePairings fills null component links on a stored pairing once components exist', () => {
    const components = [
      { id: 'h', role: 'holder_body', tool_id: 'TF-194' },
      { id: 'i', role: 'insert', tool_id: 'TO-195' },
    ];
    const stored = { family: 'od_turning', holder_component_id: null, insert_component_id: null, rta_number: '' };
    const [t] = derivePairings([{ id: 't', tool_id: 'TF-194/TO-195', tool_type: 'turning general', pairing: stored }], components);
    expect(t.pairing.holder_component_id).toBe('h');
    expect(t.pairing.insert_component_id).toBe('i');
    expect(t.pairing.family).toBe('od_turning'); // stored family preserved
  });

  it('derivePairings preserves a manual link and only fills the null side', () => {
    const components = [
      { id: 'h', role: 'holder_body', tool_id: 'TF-194' },
      { id: 'i', role: 'insert', tool_id: 'TO-195' },
    ];
    const stored = { family: 'od_turning', holder_component_id: 'manual', insert_component_id: null, rta_number: '' };
    const [t] = derivePairings([{ id: 't', tool_id: 'TF-194/TO-195', tool_type: 'turning general', pairing: stored }], components);
    expect(t.pairing.holder_component_id).toBe('manual'); // user's link untouched
    expect(t.pairing.insert_component_id).toBe('i');       // null side filled
  });

  it('derivePairings leaves a fully-linked stored pairing as the same reference', () => {
    const components = [{ id: 'h', role: 'holder_body', tool_id: 'TF-194' }];
    const stored = { family: 'od_turning', holder_component_id: 'a', insert_component_id: 'b', rta_number: '' };
    const [t] = derivePairings([{ id: 't', tool_id: 'TF-194/TO-195', tool_type: 'turning general', pairing: stored }], components);
    expect(t.pairing).toBe(stored);
  });

  it('normProShopId is dash/space/case-insensitive', () => {
    expect(normProShopId('TF-194')).toBe('TF194');
    expect(normProShopId('tf 194')).toBe('TF194');
  });

  it('insertComponentIndex maps each component number to its role/family', () => {
    const tools = [
      { tool_id: 'TF-194/ TO-195', tool_type: 'turning general' },
      { tool_id: 'A-103/ I-98', tool_type: 'flat end mill' },
      { tool_id: 'A-42', tool_type: 'flat end mill' }, // normal tool — not indexed
    ];
    const idx = insertComponentIndex(tools);
    expect(idx.get('TF194')).toEqual({ role: 'holder_body', family: 'od_turning', tool_id: 'TF-194/ TO-195' });
    expect(idx.get('TO195')).toEqual({ role: 'insert', family: 'od_turning', tool_id: 'TF-194/ TO-195' });
    // generic-family insert endmill: holder = first token, insert = second
    expect(idx.get('A103')).toEqual({ role: 'holder_body', family: 'generic_insert', tool_id: 'A-103/ I-98' });
    expect(idx.get('I98')).toEqual({ role: 'insert', family: 'generic_insert', tool_id: 'A-103/ I-98' });
    expect(idx.has('A42')).toBe(false);
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
      // Which number is the body is STORED, not re-derived from the combined
      // id's order (which is not a convention in the wild).
      holder_proshop_id: null,
      insert_proshop_id: null,
      order_unconfirmed: false,
      rta_number: '',
    });
    expect(INSERT_FAMILY_BY_ID[p.family].hasTier3Assembly).toBe(false);
  });
});

describe('which half is the body is stored, never re-derived', () => {
  // Fusion has nowhere to keep our link, so "A-123/I-124" is a transport format
  // — and its ORDER is not a convention (both orders occur in the real library).
  // For families whose letters carry meaning the prefixes settle it; for
  // anything else the user is asked once and the answer is stored.
  it('an unknown-prefix pairing is flagged for confirmation', () => {
    const [t] = derivePairings([{ id: 't', tool_id: 'A-123/I-124', tool_type: 'flat end mill' }], []);
    expect(t.pairing.order_unconfirmed).toBe(true);
    expect(t.pairing.holder_proshop_id).toBe('A-123');   // provisional seed
    expect(t.pairing.insert_proshop_id).toBe('I-124');
  });

  it('insertComponentIndex trusts the STORED answer over the string order', () => {
    // The user confirmed that I-124 is the body — the opposite of the order in
    // the id. Without this, a ProShop import would create both components with
    // their roles swapped.
    const tool = {
      id: 't', tool_id: 'A-123/I-124', tool_type: 'flat end mill',
      pairing: {
        family: 'generic_insert', holder_component_id: null, insert_component_id: null,
        holder_proshop_id: 'I-124', insert_proshop_id: 'A-123', order_unconfirmed: false,
      },
    };
    const idx = insertComponentIndex([tool]);
    expect(idx.get(normProShopId('I-124')).role).toBe('holder_body');
    expect(idx.get(normProShopId('A-123')).role).toBe('insert');
  });

  it('falls back to parsing when nothing is stored yet', () => {
    const idx = insertComponentIndex([{ id: 't', tool_id: 'I-224/G-223', tool_type: 'face mill' }]);
    expect(idx.get(normProShopId('I-224')).role).toBe('holder_body');
    expect(idx.get(normProShopId('G-223')).role).toBe('insert');
  });
});
