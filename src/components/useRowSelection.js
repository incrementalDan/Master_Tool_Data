import { useCallback, useEffect, useRef, useState } from 'react';

// Row selection for the tool lists — the ordinary desktop behaviour rather than
// a column of checkboxes: click selects, shift extends a range, ctrl/cmd adds
// one, Esc or a click elsewhere clears.
//
// ⚠️ THE SELECTION BELONGS TO EXACTLY ONE TABLE AT A TIME. A part page shows
// several tool lists (one per program, plus the all-tools list) and they share
// this state, so a click in one has to drop what was selected in another —
// otherwise "Print selected" on one table would silently include rows the user
// picked in a different one and can no longer see. That is the same rule as
// "clicking in dead space clears", so both are one check: on mousedown, find
// the nearest element carrying the scope attribute; if it isn't the table that
// owns the current selection, clear. Marking the whole CARD as the scope (not
// just the table) is what keeps the card's own Print buttons working — a
// mousedown on the button must not wipe what it is about to print.
export const SEL_SCOPE_ATTR = 'data-sel-scope';

// Spread onto the element that owns a selection, e.g. <div {...selScope(id)}>.
export const selScope = (scope) => ({ [SEL_SCOPE_ATTR]: scope });

// The selection rules, pure — the piece worth locking down, since "shift after
// a ctrl-click" and "click the last selected row" are exactly the cases that
// quietly stop matching what a desktop list does. Returns the next state AND
// the next anchor; the hook just stores them.
export function nextSelection(prev, anchor, { scope, orderedKeys, key, additive, ranged }) {
  const empty = { scope: null, keys: new Set() };

  // A click in a DIFFERENT table replaces the selection outright.
  if (prev.scope !== scope) return { sel: { scope, keys: new Set([key]) }, anchor: key };

  // Shift extends from the anchor. The anchor deliberately STAYS put, so
  // shift-clicking again re-ranges from the same origin rather than creeping.
  if (ranged && anchor != null) {
    const a = orderedKeys.indexOf(anchor);
    const b = orderedKeys.indexOf(key);
    if (a !== -1 && b !== -1) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return { sel: { scope, keys: new Set(orderedKeys.slice(lo, hi + 1)) }, anchor };
    }
  }

  if (additive) {
    const keys = new Set(prev.keys);
    if (keys.has(key)) keys.delete(key); else keys.add(key);
    // Ctrl-clicking the last one off leaves no selection AND no scope, so the
    // Print-selected button disappears instead of showing a count of zero.
    return keys.size ? { sel: { scope, keys }, anchor: key } : { sel: empty, anchor: null };
  }

  // Clicking the one selected row again deselects it — a way out that doesn't
  // require finding dead space.
  if (prev.keys.size === 1 && prev.keys.has(key)) return { sel: empty, anchor: null };

  return { sel: { scope, keys: new Set([key]) }, anchor: key };
}

export default function useRowSelection() {
  const [sel, setSel] = useState({ scope: null, keys: new Set() });
  const anchorRef = useRef(null);

  const clear = useCallback(() => {
    anchorRef.current = null;
    // Same reference when there is nothing to clear, so an outside click on an
    // unselected page doesn't re-render every table.
    setSel(prev => (prev.scope === null && prev.keys.size === 0
      ? prev
      : { scope: null, keys: new Set() }));
  }, []);

  // orderedKeys = that table's keys in DISPLAY order, which is what a shift
  // range means to the user — never insertion or sort-independent order.
  const selectRow = useCallback((scope, orderedKeys, key, e) => {
    const step = {
      scope, orderedKeys, key,
      additive: !!(e?.ctrlKey || e?.metaKey),
      ranged: !!e?.shiftKey,
    };
    setSel(prev => {
      const out = nextSelection(prev, anchorRef.current, step);
      anchorRef.current = out.anchor;
      return out.sel;
    });
  }, []);

  useEffect(() => {
    if (!sel.scope) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') clear(); };
    const onDown = (e) => {
      const owner = e.target?.closest?.(`[${SEL_SCOPE_ATTR}]`);
      if (!owner || owner.getAttribute(SEL_SCOPE_ATTR) !== sel.scope) clear();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [sel.scope, clear]);

  // keysIn(scope) — what this table has selected, and nothing from any other.
  const keysIn = useCallback(
    (scope) => (sel.scope === scope ? [...sel.keys] : []),
    [sel],
  );

  return { scope: sel.scope, keys: sel.keys, keysIn, selectRow, clear };
}
