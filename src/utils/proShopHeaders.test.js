import { describe, it, expect } from 'vitest';
import {
  canonicalProShopHeader, proShopRowsToObjects, detectProShopFormat,
} from './proShopHeaders.js';

describe('proShopHeaders — canonicalization', () => {
  it('maps API-id (tooldex export) headers to canonical display keys', () => {
    expect(canonicalProShopHeader('toolNumber')).toBe('Tool #');
    expect(canonicalProShopHeader('numberOfFlutes')).toBe('No.ofFlutes');
    expect(canonicalProShopHeader('lengthBelowShankDiameter')).toBe('Length Below Holder - MIN OOH');
    expect(canonicalProShopHeader('tipTo1stFullThread')).toBe('Tip to 1st Full Thread');
    expect(canonicalProShopHeader('vendorToolId')).toBe('EDP#');
    expect(canonicalProShopHeader('cutDiameter')).toBe('Cut Dia');
    expect(canonicalProShopHeader('customgrindtool')).toBe('Custom Grind');
    expect(canonicalProShopHeader('toolGroupLetter')).toBe('Tool Group');
    // Location + Point Type round-trip (added to the app's own export)
    expect(canonicalProShopHeader('location')).toBe('Location');
    expect(canonicalProShopHeader('pointType')).toBe('Point Type');
  });

  it('leaves real ProShop display-name headers unchanged (identity)', () => {
    for (const h of ['Tool #', 'No.ofFlutes', 'Length Below Holder - MIN OOH', 'Approved Brand', 'EDP#', 'Cost']) {
      expect(canonicalProShopHeader(h)).toBe(h);
    }
  });

  it('is case- and punctuation-insensitive', () => {
    expect(canonicalProShopHeader('  toolnumber ')).toBe('Tool #');
    expect(canonicalProShopHeader('No. of Flutes')).toBe('No.ofFlutes');
  });

  it('passes unknown headers through trimmed', () => {
    expect(canonicalProShopHeader('  Spindle Speed ')).toBe('Spindle Speed');
    expect(canonicalProShopHeader('someUnmappedColumn')).toBe('someUnmappedColumn');
  });
});

describe('proShopHeaders — both formats produce identical row objects', () => {
  const proshopRows = [
    ['Tool #', 'Description', 'Cut Dia', 'No.ofFlutes', 'Length Below Holder - MIN OOH', 'Approved Brand', 'EDP#', 'Cost'],
    ['A-3', '1/2 EM', '0.5', '4', '1.25', 'Helical', '12334', '34.76'],
  ];
  const tooldexRows = [
    ['toolNumber', 'description', 'cutDiameter', 'numberOfFlutes', 'lengthBelowShankDiameter', 'approvedBrand', 'vendorToolId', 'cost'],
    ['A-3', '1/2 EM', '0.5', '4', '1.25', 'Helical', '12334', '34.76'],
  ];

  it('yields the same canonical keys and values for both header conventions', () => {
    const a = proShopRowsToObjects(proshopRows)[0];
    const b = proShopRowsToObjects(tooldexRows)[0];
    expect(b).toEqual(a);
    expect(a['Tool #']).toBe('A-3');
    expect(a['No.ofFlutes']).toBe('4');
    expect(a['Length Below Holder - MIN OOH']).toBe('1.25');
    expect(a['EDP#']).toBe('12334');
  });

  it('trims cell values', () => {
    const rows = [['Tool #', 'Cost'], ['  A-3 ', ' 10.5 ']];
    const obj = proShopRowsToObjects(rows)[0];
    expect(obj['Tool #']).toBe('A-3');
    expect(obj['Cost']).toBe('10.5');
  });
});

describe('proShopHeaders — format detection', () => {
  it('detects tooldex vs proshop vs unknown', () => {
    expect(detectProShopFormat(['toolNumber', 'numberOfFlutes'])).toBe('tooldex');
    expect(detectProShopFormat(['Tool #', 'No.ofFlutes'])).toBe('proshop');
    expect(detectProShopFormat(['Foo', 'Bar'])).toBe('unknown');
    expect(detectProShopFormat([])).toBe('unknown');
  });
});
