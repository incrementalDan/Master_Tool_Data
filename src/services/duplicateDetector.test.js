import { describe, it, expect } from 'vitest';
import {
  scoreSimilarity, findTopMatches, matchTool,
  MATCH_THRESHOLD_LIKELY, MATCH_THRESHOLD_POSSIBLE,
} from './duplicateDetector.js';

// Minimal internal-shaped library tools (what matchTool sees in the app).
const lib = (over = {}) => ({
  id: 'guid-lib-1',
  tracking_id: 'FTL-000001',
  tool_id: 'A-1',
  legacy_ids: [],
  assemblies: [],
  tool_type: 'flat end mill',
  diameter: 0.5,
  number_of_flutes: 4,
  overall_length: 3,
  vendor: 'Helical',
  description: '1/2 4FL EM',
  ...over,
});

describe('matchTool — priority order (what Sync Job trusts, in order)', () => {
  it('1. tracking ID exact match wins over everything', () => {
    const master = lib();
    const decoy = lib({ id: 'guid-2', tracking_id: 'FTL-000002', tool_id: 'B-9' });
    const incoming = { tracking_id: 'FTL-000001', tool_id: 'B-9' }; // tool_id points at decoy
    const res = matchTool(incoming, [decoy, master]);
    expect(res.method).toBe('tracking-id');
    expect(res.confidence).toBe('exact');
    expect(res.tool).toBe(master);
  });

  it('2. tool_id (ProShop #) exact match', () => {
    const master = lib();
    const res = matchTool({ tool_id: 'A-1' }, [lib({ id: 'x', tool_id: 'Z-9', tracking_id: 'FTL-0000ZZ' }), master]);
    expect(res.method).toBe('product-id');
    expect(res.tool).toBe(master);
  });

  it('3. legacy ID match — an old ID still resolves after a re-number', () => {
    const master = lib({ tool_id: '1042', legacy_ids: ['A-1'] });
    const res = matchTool({ tool_id: 'A-1' }, [master]);
    expect(res.method).toBe('legacy-id');
    expect(res.confidence).toBe('exact');
    expect(res.tool).toBe(master);
  });

  it('4. GUID match — via an assembly instance guid or the tool id itself', () => {
    const master = lib({
      tool_id: '',
      assemblies: [{ instance_guid: 'inst-77' }],
    });
    const viaInstance = matchTool({ id: 'inst-77' }, [master]);
    expect(viaInstance.method).toBe('guid');
    expect(viaInstance.tool).toBe(master);

    const viaToolId = matchTool({ id: 'guid-lib-1' }, [lib({ tool_id: '' })]);
    expect(viaToolId.method).toBe('guid');
  });

  it('5. geometry fuzzy match — needs user confirmation, carries candidates', () => {
    const master = lib({ tool_id: '', tracking_id: null });
    const incoming = {
      tool_type: 'flat end mill', diameter: 0.5, number_of_flutes: 4,
      overall_length: 3, vendor: 'Helical', description: '1/2 4FL EM',
    };
    const res = matchTool(incoming, [master]);
    expect(res.confidence).toBe('fuzzy');
    expect(res.method).toBe('fuzzy');
    expect(res.tool).toBe(master);
    expect(res.candidates.length).toBeGreaterThan(0);
  });

  it('6. nothing plausible → none (routes to Add-to-Library)', () => {
    const master = lib({ tool_id: '', tracking_id: null });
    const incoming = { tool_type: 'drill', diameter: 0.125 }; // shares nothing
    const res = matchTool(incoming, [master]);
    expect(res.confidence).toBe('none');
    expect(res.tool).toBeNull();
  });
});

describe('scoreSimilarity', () => {
  it('identical tools score 100', () => {
    const a = lib();
    expect(scoreSimilarity(a, lib())).toBe(100);
  });

  it('same geometry but no strings lands in the "possible" band (needs a human)', () => {
    const a = { tool_type: 'flat end mill', diameter: 0.5, number_of_flutes: 4, overall_length: 3 };
    const score = scoreSimilarity(a, { ...a });
    expect(score).toBeGreaterThanOrEqual(MATCH_THRESHOLD_POSSIBLE);
    expect(score).toBeLessThan(MATCH_THRESHOLD_LIKELY);
  });

  it('a different tool type costs the biggest penalty', () => {
    const a = lib();
    const same = scoreSimilarity(a, lib());
    const diffType = scoreSimilarity(a, lib({ tool_type: 'ball end mill' }));
    expect(same - diffType).toBe(30);
  });

  it('diameter similarity degrades with distance, not a cliff', () => {
    const a = lib();
    const close = scoreSimilarity(a, lib({ diameter: 0.5005 }));   // within 10x tol
    const far = scoreSimilarity(a, lib({ diameter: 0.75 }));       // way off
    expect(close).toBeGreaterThan(far);
  });
});

describe('findTopMatches', () => {
  it('filters weak candidates, sorts best-first, respects maxResults', () => {
    const incoming = lib();
    const strong = lib({ id: 'g1' });
    const medium = lib({ id: 'g2', tool_type: 'ball end mill', description: 'other' });
    const junk = { id: 'g3', tool_type: 'tap', diameter: 0.19 };
    const res = findTopMatches(incoming, [junk, medium, strong], 2);
    expect(res.length).toBeLessThanOrEqual(2);
    expect(res[0].tool).toBe(strong);
    expect(res[0].score).toBeGreaterThanOrEqual(res[1]?.score ?? 0);
    expect(res.find(r => r.tool === junk)).toBeUndefined();
  });
});
