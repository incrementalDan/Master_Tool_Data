import { describe, it, expect } from 'vitest';
import {
  tipVersionFromItem,
  latestFromVersionList,
  storageIdOfVersion,
  shouldRetryRequest,
  retryDelayMs,
  nextLink,
} from './apsService.js';

// The bug these lock down: loading an OLD version of the tool library, treating
// it as current, and writing it straight back as the newest version — reverting
// the whole shop's library with a success message. Both pickers below have to be
// right, because the second is the fallback for the first.

const version = (id, num, { storage = `urn:adsk.objects:os.object:b/${id}` } = {}) => ({
  type: 'versions',
  id,
  attributes: { versionNumber: num },
  relationships: storage ? { storage: { data: { id: storage, type: 'objects' } } } : {},
});

const itemPayload = (tipId, included) => ({
  data: { type: 'items', id: 'urn:item', relationships: { tip: { data: { id: tipId, type: 'versions' } } } },
  included,
});

describe('tipVersionFromItem — the tip is found BY ID, never by position', () => {
  it('returns the version the item names as its tip', () => {
    const tip = version('urn:v3', 3);
    const got = tipVersionFromItem(itemPayload('urn:v3', [version('urn:v1', 1), tip]));
    expect(got).toBe(tip);
  });

  // ⚠️ The whole point of matching on the id. If `included` ever arrives with
  // something other than the tip first, position-based picking reads the wrong
  // version — which is the exact failure this change exists to remove.
  it('ignores included[0] when included[0] is not the tip', () => {
    const tip = version('urn:v9', 9);
    const got = tipVersionFromItem(itemPayload('urn:v9', [version('urn:v1', 1), version('urn:v2', 2), tip]));
    expect(got.id).toBe('urn:v9');
  });

  it('returns null when the item names no tip', () => {
    expect(tipVersionFromItem({ data: { relationships: {} }, included: [version('urn:v1', 1)] })).toBeNull();
  });

  it('returns null when the named tip is not in included', () => {
    expect(tipVersionFromItem(itemPayload('urn:missing', [version('urn:v1', 1)]))).toBeNull();
  });

  it('returns null when included is absent or not an array', () => {
    expect(tipVersionFromItem(itemPayload('urn:v1', undefined))).toBeNull();
    expect(tipVersionFromItem(itemPayload('urn:v1', 'nope'))).toBeNull();
  });

  it('ignores a matching id that is not a version', () => {
    const decoy = { type: 'items', id: 'urn:v1' };
    expect(tipVersionFromItem(itemPayload('urn:v1', [decoy]))).toBeNull();
  });

  it('survives an empty or malformed payload without throwing', () => {
    expect(tipVersionFromItem(undefined)).toBeNull();
    expect(tipVersionFromItem({})).toBeNull();
    expect(tipVersionFromItem({ data: null, included: null })).toBeNull();
  });
});

describe('latestFromVersionList — the fallback, and correct on its own', () => {
  // ⚠️ THE failure case. The old code took data[0]; an ascending list therefore
  // handed back version 1 as "current".
  it('picks the highest version when the list arrives OLDEST first', () => {
    const payload = { data: [version('urn:v1', 1), version('urn:v2', 2), version('urn:v3', 3)] };
    expect(latestFromVersionList(payload).id).toBe('urn:v3');
  });

  it('picks the highest version when the list arrives newest first', () => {
    const payload = { data: [version('urn:v3', 3), version('urn:v2', 2), version('urn:v1', 1)] };
    expect(latestFromVersionList(payload).id).toBe('urn:v3');
  });

  it('picks the highest version from an arbitrary order', () => {
    const payload = { data: [version('urn:v2', 2), version('urn:v12', 12), version('urn:v7', 7)] };
    expect(latestFromVersionList(payload).id).toBe('urn:v12');
  });

  it('compares numerically, not as text (12 beats 9)', () => {
    const payload = { data: [version('urn:v9', 9), version('urn:v12', 12)] };
    expect(latestFromVersionList(payload).id).toBe('urn:v12');
  });

  it('handles a single version', () => {
    expect(latestFromVersionList({ data: [version('urn:v1', 1)] }).id).toBe('urn:v1');
  });

  it('returns null for an empty, missing, or non-array list', () => {
    expect(latestFromVersionList({ data: [] })).toBeNull();
    expect(latestFromVersionList({})).toBeNull();
    expect(latestFromVersionList(undefined)).toBeNull();
    expect(latestFromVersionList({ data: 'nope' })).toBeNull();
  });

  // Degrade, never throw: a shape we have not seen should still load.
  it('falls back to the first entry when nothing carries a version number', () => {
    const payload = { data: [{ id: 'urn:a' }, { id: 'urn:b' }] };
    expect(latestFromVersionList(payload).id).toBe('urn:a');
  });

  it('a numbered version always outranks an unnumbered one', () => {
    const payload = { data: [{ id: 'urn:unnumbered' }, version('urn:v2', 2)] };
    expect(latestFromVersionList(payload).id).toBe('urn:v2');
  });
});

describe('storageIdOfVersion', () => {
  it('reads the storage urn', () => {
    expect(storageIdOfVersion(version('urn:v1', 1))).toBe('urn:adsk.objects:os.object:b/urn:v1');
  });

  // The gate that makes the tip path fall through to the versions list: a tip we
  // cannot download from is not usable, so it must not be accepted.
  it('returns null when the version has no storage relationship', () => {
    expect(storageIdOfVersion(version('urn:v1', 1, { storage: null }))).toBeNull();
    expect(storageIdOfVersion(undefined)).toBeNull();
    expect(storageIdOfVersion({})).toBeNull();
  });
});

describe('shouldRetryRequest — a write is NEVER repeated', () => {
  // ⚠️ The rule this whole retry policy is built around. Every POST in this
  // module creates something: a storage location, or a new version of the
  // shop's library. If the request succeeded and only the response was lost,
  // retrying makes a SECOND one.
  it('refuses to retry a POST, even on a rate limit', () => {
    expect(shouldRetryRequest({ method: 'POST', status: 429, attempt: 0 })).toBe(false);
    expect(shouldRetryRequest({ method: 'POST', status: 503, attempt: 0 })).toBe(false);
  });

  it('refuses to retry any non-GET method', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE', 'post']) {
      expect(shouldRetryRequest({ method, status: 429, attempt: 0 })).toBe(false);
    }
  });

  it('retries a GET on a rate limit and on server errors', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(shouldRetryRequest({ method: 'GET', status, attempt: 0 })).toBe(true);
    }
  });

  it('treats a missing method as GET', () => {
    expect(shouldRetryRequest({ status: 429, attempt: 0 })).toBe(true);
  });

  // A 4xx other than 429 means the request itself is wrong — repeating it just
  // asks the same wrong question again.
  it('does not retry client errors that will not change', () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(shouldRetryRequest({ method: 'GET', status, attempt: 0 })).toBe(false);
    }
  });

  it('gives up after the attempt cap', () => {
    expect(shouldRetryRequest({ method: 'GET', status: 429, attempt: 2 })).toBe(true);
    expect(shouldRetryRequest({ method: 'GET', status: 429, attempt: 3 })).toBe(false);
    expect(shouldRetryRequest({ method: 'GET', status: 429, attempt: 99 })).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off exponentially when APS sends no hint', () => {
    expect(retryDelayMs(null, 0)).toBe(800);
    expect(retryDelayMs(null, 1)).toBe(1600);
    expect(retryDelayMs(null, 2)).toBe(3200);
  });

  it('honours Retry-After, in seconds', () => {
    expect(retryDelayMs('2', 0)).toBe(2000);
    expect(retryDelayMs(5, 0)).toBe(5000);
  });

  // Never let a header stall the app for minutes.
  it('caps the wait however large the hint', () => {
    expect(retryDelayMs('600', 0)).toBe(8000);
    expect(retryDelayMs(null, 20)).toBe(8000);
  });

  it('ignores a junk or non-positive Retry-After', () => {
    expect(retryDelayMs('soon', 0)).toBe(800);
    expect(retryDelayMs('0', 0)).toBe(800);
    expect(retryDelayMs('-5', 0)).toBe(800);
    expect(retryDelayMs(undefined, 0)).toBe(800);
  });
});

describe('nextLink — paging, without which a long list is silently truncated', () => {
  it('reads the JSON:API object shape', () => {
    expect(nextLink({ links: { next: { href: 'https://x/page2' } } })).toBe('https://x/page2');
  });

  it('reads a plain string link too', () => {
    expect(nextLink({ links: { next: 'https://x/page2' } })).toBe('https://x/page2');
  });

  // The common case by far: one page, no next link, behave exactly as before.
  it('returns null on the last page', () => {
    expect(nextLink({ links: { self: { href: 'https://x/page1' } } })).toBeNull();
    expect(nextLink({ links: {} })).toBeNull();
    expect(nextLink({})).toBeNull();
    expect(nextLink(undefined)).toBeNull();
  });

  it('returns null for an empty or malformed link', () => {
    expect(nextLink({ links: { next: { href: '' } } })).toBeNull();
    expect(nextLink({ links: { next: {} } })).toBeNull();
    expect(nextLink({ links: { next: 42 } })).toBeNull();
  });
});
