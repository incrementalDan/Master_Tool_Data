// The shrink tripwire.
//
// It REFUSES writes, so the false-positive cases matter as much as the true
// ones: a guard that blocks ordinary editing gets ripped out, and then it
// protects nothing.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sizeOf, shrinkCheck, assertNotShrinking, recordSize, clearHighWater,
  MIN_MEANINGFUL, SHRINK_LIMIT, recordSizeFromLoad, recordSizeFromWrite,
} from './writeGuard.js';

const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
});

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

describe('sizeOf', () => {
  it('measures a metadata table by its length', () => {
    expect(sizeOf(rows(268))).toBe(268);
  });

  it('measures a shared file by its principal collection', () => {
    // holder_library carries holders AND parts; a collapse shows in the big one.
    expect(sizeOf({ version: 1, holders: rows(22), parts: rows(3) })).toBe(22);
  });

  it('has NO OPINION on a shape it does not recognise', () => {
    // Returning 0 here would make the guard fire on every settings save.
    expect(sizeOf({ shop_name: 'Acme', default_units: 'inches' })).toBeNull();
    expect(sizeOf('nonsense')).toBeNull();
    expect(sizeOf(null)).toBeNull();
  });
});

describe('what it lets through', () => {
  beforeEach(() => { store.clear(); });

  it('allows a write when there is no baseline yet', () => {
    expect(shrinkCheck('t', rows(3))).toBeNull();
  });

  it('allows ordinary editing — adding, and small removals', () => {
    recordSize('t', rows(268));
    expect(shrinkCheck('t', rows(269))).toBeNull();
    expect(shrinkCheck('t', rows(267))).toBeNull();
    expect(shrinkCheck('t', rows(200))).toBeNull();
  });

  it('ignores a tiny dataset, where a ratio means nothing', () => {
    // 3 records down to 1 is a 67% drop and completely normal on a new library.
    recordSize('t', rows(MIN_MEANINGFUL - 1));
    expect(shrinkCheck('t', rows(1))).toBeNull();
  });

  it('is NOT a ratchet — a deliberate shrink becomes the new baseline', () => {
    // Otherwise the guard tightens forever against a library that legitimately
    // got smaller, and eventually blocks everything.
    recordSize('t', rows(100));
    recordSize('t', rows(60));
    expect(shrinkCheck('t', rows(40))).toBeNull();
  });

  it('degrades to OFF rather than blocking when storage is unavailable', () => {
    const original = globalThis.localStorage;
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(() => recordSize('t', rows(268))).not.toThrow();
    expect(shrinkCheck('t', rows(1))).toBeNull();
    vi.stubGlobal('localStorage', original);
  });
});

describe('what it catches', () => {
  beforeEach(() => { store.clear(); });

  it('catches the 268 → 3 case', () => {
    // The real path: loadMetadata returned empty, so upsertMany "merged" into
    // nothing and was about to save only the records it happened to hold.
    recordSize('tool_metadata', rows(268));
    expect(shrinkCheck('tool_metadata', rows(3))).toEqual({ key: 'tool_metadata', from: 268, to: 3 });
  });

  it('catches a total wipe', () => {
    recordSize('t', rows(268));
    expect(shrinkCheck('t', [])).toMatchObject({ from: 268, to: 0 });
  });

  it('throws with the numbers in the message, tagged for the caller', () => {
    recordSize('t', rows(268));
    let err;
    try { assertNotShrinking('t', rows(2)); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('WRITE_SHRANK');
    expect(err.from).toBe(268);
    expect(err.to).toBe(2);
    // The number is the whole point — "a write was blocked" is not actionable.
    expect(err.message).toContain('268');
    expect(err.message).toContain('2');
  });

  it('fires exactly at the documented boundary, not approximately', () => {
    recordSize('t', rows(100));
    const edge = Math.floor(100 * SHRINK_LIMIT);
    expect(shrinkCheck('t', rows(edge))).toBeNull();
    expect(shrinkCheck('t', rows(edge - 1))).not.toBeNull();
  });

  it('tracks each dataset separately', () => {
    recordSize('tool_metadata', rows(268));
    recordSize('materials', rows(40));
    expect(shrinkCheck('materials', rows(30))).toBeNull();
    expect(shrinkCheck('tool_metadata', rows(30))).not.toBeNull();
  });
});

describe('clearHighWater', () => {
  it('resets a dataset back to no-opinion', () => {
    store.clear();
    recordSize('t', rows(268));
    expect(shrinkCheck('t', rows(1))).not.toBeNull();
    clearHighWater('t');
    expect(shrinkCheck('t', rows(1))).toBeNull();
  });
});

describe('⚠️ the bad read must not disarm the guard', () => {
  beforeEach(() => { store.clear(); });

  it('an EMPTY load does not reset a meaningful baseline to zero', () => {
    // THE BUG THIS EXISTS FOR: the guard defends against a read that came back
    // empty. But the load path also records the size it read — so an empty read
    // wrote a baseline of 0, `from < MIN_MEANINGFUL` short-circuited, and the
    // guard stood down for exactly the write it was built to stop. The bad read
    // disarmed its own alarm.
    recordSizeFromLoad('tool_metadata', rows(268));   // a good load, yesterday
    recordSizeFromLoad('tool_metadata', []);          // today's read comes back empty
    // The write that follows is the 268 -> 3 catastrophe. It must still be caught.
    expect(shrinkCheck('tool_metadata', rows(3))).toMatchObject({ from: 268, to: 3 });
  });

  it('but a genuine shrink still rebaselines, so the guard is not a ratchet', () => {
    // The tension: loads must be able to lower the mark (tools really do get
    // deleted, one at a time, and deleteById never records) or the guard
    // eventually blocks ordinary saves. Only a drop to ZERO is treated as
    // "no information" — a real, partial shrink is believed.
    recordSizeFromLoad('t', rows(268));
    recordSizeFromLoad('t', rows(68));
    expect(shrinkCheck('t', rows(60))).toBeNull();
  });

  it('a real first run still arms from zero', () => {
    // An empty table on a brand-new shop is genuinely empty, and must not be
    // permanently stuck at a baseline it never had.
    recordSizeFromLoad('fresh', []);
    recordSizeFromLoad('fresh', rows(12));
    expect(shrinkCheck('fresh', rows(1))).not.toBeNull();
  });

  it('a deliberate WRITE of zero is believed — it was asked for', () => {
    recordSizeFromLoad('t', rows(268));
    recordSizeFromWrite('t', []);
    expect(shrinkCheck('t', [])).toBeNull();
  });
});
