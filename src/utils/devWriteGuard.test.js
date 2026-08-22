// The dev-build write guard.
//
// The failure it prevents: `npm run dev` points at the same metadata file and
// the same Autodesk library as the deployed site, and the app writes to Drive
// with no user action at all — so every dev session was a live write.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isDevBuild, isDevUnlocked, unlockDevWrites, lockDevWrites,
  writeLockReason, datasetLabel, DEV_LOCK_REASON,
} from './devWriteGuard.js';

const store = new Map();
vi.stubGlobal('sessionStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
});

describe('the policy', () => {
  beforeEach(() => store.clear());

  it('a DEPLOYED build always writes — the guard must never touch production', () => {
    expect(writeLockReason({ dev: false, unlocked: false })).toBeNull();
    expect(writeLockReason({ dev: false, unlocked: true })).toBeNull();
  });

  it('a dev build is LOCKED by default', () => {
    // Locked, not merely warned: the automatic load-time writes happen before
    // anyone has looked at the screen, so a badge would arrive too late.
    expect(writeLockReason({ dev: true, unlocked: false })).toBe(DEV_LOCK_REASON);
  });

  it('an explicit unlock releases it', () => {
    expect(writeLockReason({ dev: true, unlocked: true })).toBeNull();
  });
});

describe('the unlock', () => {
  beforeEach(() => store.clear());

  it('round-trips and can be taken back', () => {
    expect(isDevUnlocked()).toBe(false);
    unlockDevWrites();
    expect(isDevUnlocked()).toBe(true);
    lockDevWrites();
    expect(isDevUnlocked()).toBe(false);
  });

  it('lives in sessionStorage so it dies with the tab, never localStorage', () => {
    // A consent given once in March must not still be protecting nothing in
    // June — that is worse than no guard, because it still LOOKS guarded.
    unlockDevWrites();
    expect(store.get('dev_write_unlock')).toBe('yes');
  });

  it('stays LOCKED when storage is unavailable', () => {
    // Private mode / storage disabled. Failing closed is the only safe default:
    // an unreadable unlock is not an unlock.
    const original = globalThis.sessionStorage;
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(isDevUnlocked()).toBe(false);
    expect(() => unlockDevWrites()).not.toThrow();
    expect(isDevUnlocked()).toBe(false);
    vi.stubGlobal('sessionStorage', original);
  });
});

describe('isDevBuild', () => {
  it('reads the injected build env so the module stays pure', () => {
    expect(isDevBuild({ DEV: true })).toBe(true);
    expect(isDevBuild({ DEV: false })).toBe(false);
    expect(isDevBuild({})).toBe(false);
  });
});

describe('datasetLabel', () => {
  it('names the shop and disambiguates by file id', () => {
    // Two shops can share a name but never a file id, so the tail is what makes
    // "which data am I about to touch" actually answerable.
    expect(datasetLabel('Acme Machining', 'abcdEFGH1234wxyz')).toBe('Acme Machining · …wxyz');
  });

  it('degrades without either piece rather than rendering blank', () => {
    expect(datasetLabel('', '')).toBe('Unnamed shop');
    expect(datasetLabel('Acme', '')).toBe('Acme');
  });
});
