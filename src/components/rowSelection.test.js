import { describe, it, expect } from 'vitest';
import { nextSelection } from './useRowSelection.js';

const KEYS = ['a', 'b', 'c', 'd', 'e'];
const NONE = { scope: null, keys: new Set() };
const at = (scope, ...keys) => ({ scope, keys: new Set(keys) });
const click = (prev, anchor, key, mod = {}) =>
  nextSelection(prev, anchor, { scope: 'T1', orderedKeys: KEYS, key, ...mod });
const list = (out) => [...out.sel.keys];

describe('row selection', () => {
  it('a plain click selects exactly that row', () => {
    expect(list(click(NONE, null, 'b'))).toEqual(['b']);
    expect(list(click(at('T1', 'b'), 'b', 'd'))).toEqual(['d']);
  });

  it('ctrl/cmd adds and removes one row at a time', () => {
    const one = click(NONE, null, 'b');
    const two = click(one.sel, one.anchor, 'd', { additive: true });
    expect(list(two).sort()).toEqual(['b', 'd']);
    const back = click(two.sel, two.anchor, 'b', { additive: true });
    expect(list(back)).toEqual(['d']);
  });

  it('shift takes the range between the anchor and the click, either direction', () => {
    const one = click(NONE, null, 'b');
    expect(list(click(one.sel, one.anchor, 'd', { ranged: true }))).toEqual(['b', 'c', 'd']);
    const four = click(NONE, null, 'd');
    expect(list(click(four.sel, four.anchor, 'b', { ranged: true }))).toEqual(['b', 'c', 'd']);
  });

  // The anchor stays put, or a second shift-click walks the range along instead
  // of re-ranging from where the user started.
  it('shift re-ranges from the SAME origin, it does not creep', () => {
    const one = click(NONE, null, 'b');
    const wide = click(one.sel, one.anchor, 'e', { ranged: true });
    expect(list(wide)).toEqual(['b', 'c', 'd', 'e']);
    expect(list(click(wide.sel, wide.anchor, 'c', { ranged: true }))).toEqual(['b', 'c']);
  });

  it('clicking the one selected row deselects it', () => {
    const one = click(NONE, null, 'b');
    const off = click(one.sel, one.anchor, 'b');
    expect(list(off)).toEqual([]);
    expect(off.sel.scope).toBe(null);
  });

  // Otherwise "Print selected" would sit there reading 0.
  it('ctrl-clicking the last row off drops the scope too', () => {
    const one = click(NONE, null, 'b');
    const off = click(one.sel, one.anchor, 'b', { additive: true });
    expect(off.sel.scope).toBe(null);
    expect(off.anchor).toBe(null);
  });

  // ⚠️ The reason selection is scoped at all: a Print-selected on one table must
  // never include rows picked in another table the user can no longer see.
  it('a click in another table replaces the selection outright', () => {
    const inT1 = at('T1', 'b', 'c');
    const out = nextSelection(inT1, 'b', { scope: 'T2', orderedKeys: ['x', 'y'], key: 'y' });
    expect(out.sel.scope).toBe('T2');
    expect([...out.sel.keys]).toEqual(['y']);
  });

  it('shift with no anchor behaves like a plain click', () => {
    expect(list(click(at('T1'), null, 'c', { ranged: true }))).toEqual(['c']);
  });

  it('never mutates the previous selection', () => {
    const prev = at('T1', 'b');
    click(prev, 'b', 'd', { additive: true });
    expect([...prev.keys]).toEqual(['b']);
  });
});
