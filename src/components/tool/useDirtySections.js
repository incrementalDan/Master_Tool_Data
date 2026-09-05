import { useRef, useCallback } from 'react';

// Which buffered sections on the tool page have uncommitted edits.
//
// ⚠️ THE EDIT FORM WAS ONE DRAFT; THE PAGE IS SEVERAL. The old leave guard
// asked one question ("is the form dirty?") because there was one form. On the
// unified page Geometry, Identity, Presets and Assemblies each hold their own
// draft, so a guard that watches only one of them lets the other three be
// thrown away silently — which is worse than the modal it replaced, because
// nothing on screen said an edit was pending.
//
// A REF, not state, deliberately: a section reports its dirtiness from an
// effect, and re-rendering the whole page every time a keystroke flips a flag
// would re-render the drawing and every panel on it. Nothing here is displayed
// — it is read at the moment someone tries to leave.
export function useDirtySections() {
  const ref = useRef(new Map());

  // Stable, so a section can pass it straight to an effect without it
  // re-firing on every render of the page.
  const setDirty = useCallback((key, dirty) => {
    if (dirty) ref.current.set(key, true);
    else ref.current.delete(key);
  }, []);

  const dirtyNames = useCallback(() => [...ref.current.keys()], []);
  const anyDirty = useCallback(() => ref.current.size > 0, []);
  const clear = useCallback(() => { ref.current.clear(); }, []);

  return { setDirty, dirtyNames, anyDirty, clear };
}

/** "Geometry and Identity" — for the leave prompt, so it names what is at risk. */
export function listNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
