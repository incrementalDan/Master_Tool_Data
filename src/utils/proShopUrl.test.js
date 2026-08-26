import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PROSHOP_TOOL_URL_BASE, proShopToolUrl, proShopUrlPointsAt, proShopLinkForWrite,
} from './proShopUrl.js';

const lib = JSON.parse(readFileSync(
  new URL('../../FUSION TOOL Library REF/Full_Type_List Examples.json', import.meta.url), 'utf8')).data;
const unquote = (s) => String(s ?? '').replace(/^'|'$/g, '');

describe('proShopToolUrl', () => {
  it('composes the shop’s tool page from the ProShop number', () => {
    expect(proShopToolUrl('A-25')).toBe(`${PROSHOP_TOOL_URL_BASE}/A/A-25$`);
    expect(proShopToolUrl(' L-74 ')).toBe(`${PROSHOP_TOOL_URL_BASE}/L/L-74$`);
  });

  it('composes NOTHING for a blank id', () => {
    expect(proShopToolUrl('')).toBeNull();
    expect(proShopToolUrl(null)).toBeNull();
  });

  // An insert tool's ProShop page is an RTA page (/procnc/rtas/2026/22$) whose
  // year+number cannot be composed. A confident dead link is worse than none.
  it('composes NOTHING for a combined insert id', () => {
    expect(proShopToolUrl('I-167/ G-168')).toBeNull();
    expect(proShopToolUrl('G-125/I-126')).toBeNull();
  });
});

describe('proShopLinkForWrite', () => {
  it('fills a blank link — the new-tool case', () => {
    expect(proShopLinkForWrite('A-25', '')).toBe(`${PROSHOP_TOOL_URL_BASE}/A/A-25$`);
    expect(proShopLinkForWrite('A-25', undefined)).toBe(`${PROSHOP_TOOL_URL_BASE}/A/A-25$`);
  });

  it('is a no-op once the link is right — a second save has nothing to do', () => {
    const first = proShopLinkForWrite('A-25', '');
    expect(proShopLinkForWrite('A-25', first)).toBeNull();
  });

  it('leaves a link that already points at this tool alone, however it is spelled', () => {
    // 11 real links carry a pasted browser session tail; one has no trailing "$".
    expect(proShopLinkForWrite('M-151',
      `${PROSHOP_TOOL_URL_BASE}/M/M-151$hour=09&page=5BDD&token=C016`)).toBeNull();
    expect(proShopLinkForWrite('R-145', `${PROSHOP_TOOL_URL_BASE}/R/R-145`)).toBeNull();
  });

  it('NEVER overwrites a link the app didn’t compose', () => {
    // A scanned spec sheet puts the MANUFACTURER's product page in this same field.
    expect(proShopLinkForWrite('A-25', 'https://www.helicaltool.com/products/12345')).toBeNull();
    // An insert tool's RTA page is a real ProShop link we can't re-derive.
    expect(proShopLinkForWrite('A-25',
      'https://americanprecisionworks.adionsystems.com/procnc/rtas/2026/22$')).toBeNull();
  });

  it('corrects a link left on the OLD number after a Tool ID renumber', () => {
    expect(proShopLinkForWrite('A-90', `${PROSHOP_TOOL_URL_BASE}/A/A-25$`))
      .toBe(`${PROSHOP_TOOL_URL_BASE}/A/A-90$`);
  });
});

// The composed shape is measured against the shop's own library, not a guess.
describe('over the real reference library', () => {
  const linked = lib
    .map(t => ({ id: unquote(t['product-id']), link: (t['product-link'] || '').trim() }))
    .filter(t => t.link && t.id);

  it('recognises every existing /tools/ link as already pointing at its own tool', () => {
    const tools = linked.filter(t => t.link.startsWith(`${PROSHOP_TOOL_URL_BASE}/`));
    expect(tools.length).toBeGreaterThan(70);
    const strays = tools.filter(t => !proShopUrlPointsAt(t.link, t.id));
    expect(strays).toEqual([]);
  });

  it('would rewrite NOTHING in the existing library', () => {
    const changed = linked.filter(t => proShopLinkForWrite(t.id, t.link) !== null);
    expect(changed).toEqual([]);
  });
});
