// Linked tools — a SYMMETRIC tool↔tool relationship: a tap and the drill that
// precedes it, a reamer and its drill. "Related to", nothing more; there is no
// direction and no role. Framework-free, like locationSystem.js.
//
// ⚠️ THE LINK IS A TRACKING ID, never a ProShop number and never a description.
// You LOOK a tool up by its ProShop #/EDP — that is the picker's job — but what
// gets STORED is the partner's stable `tool.id` (its FTL-XXXXXX tracking id).
// A ProShop number is re-numberable by design (that is what `legacy_ids` is
// for), so storing one would quietly sever every link the next time the shop
// changed its ID scheme. See "Relational integrity — every link is an ID".
//
// ⚠️ SYMMETRY IS STORED ON BOTH SIDES, not derived from one. A JSON file per
// tool has no join table, so each side carries the other's id and the pair is
// written in ONE metadata save — a single write cannot leave half a link. The
// load-time repair below is the belt to that braces: it exists for links written
// before this rule, or by a future writer that forgets, and it heals them in
// memory so a half-link is never visible to anyone.

// Dedupe, drop blanks, and drop a self-link (a tool is not related to itself).
export function normalizeLinkIds(ids, selfId = null) {
  const seen = new Set();
  const out = [];
  for (const raw of ids || []) {
    const id = String(raw ?? '').trim();
    if (!id || id === selfId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isLinked(tool, otherId) {
  return (tool?.linked_tools || []).includes(otherId);
}

// The partner tools, resolved for DISPLAY. A link whose target isn't in the
// library is skipped here but deliberately NOT removed from storage — see the
// dangling note on symmetrizeToolLinks.
export function linkedTools(tool, tools) {
  const byId = new Map((tools || []).map(t => [t.id, t]));
  return normalizeLinkIds(tool?.linked_tools, tool?.id)
    .map(id => byId.get(id))
    .filter(Boolean);
}

// Both halves of a link change, as a { toolId -> linked_tools[] } patch. One
// caller, one write — the two sides can't drift because they are never written
// apart.
export function linkPatch(a, b, linked) {
  if (!a?.id || !b?.id || a.id === b.id) return null;
  const set = (tool, otherId) => {
    const cur = normalizeLinkIds(tool.linked_tools, tool.id);
    const next = linked
      ? (cur.includes(otherId) ? cur : [...cur, otherId])
      : cur.filter(x => x !== otherId);
    return next;
  };
  return { [a.id]: set(a, b.id), [b.id]: set(b, a.id) };
}

// ⚠️ Returns the SAME array and the SAME tool references when everything already
// agrees. Callers use identity to decide whether there is anything to persist —
// a fresh object per load would make every tool look dirty forever and the
// repair could never report "nothing to do" on its second run. (Same rule as
// syncPresetMaterialName.)
//
// ⚠️ A DANGLING id is KEPT. "Not in the list I was handed" is not "deleted" —
// the library may be partly loaded, or the partner may be a record this pass
// didn't build. Dropping it here and persisting would silently destroy a real
// link; the repair only ever ADDS the missing reverse half, for partners that
// are actually present.
export function symmetrizeToolLinks(tools) {
  const list = tools || [];
  if (!list.length) return list;
  const byId = new Map(list.map(t => [t.id, t]));

  const additions = new Map();   // id -> Set of ids to add
  for (const t of list) {
    for (const otherId of normalizeLinkIds(t.linked_tools, t.id)) {
      const other = byId.get(otherId);
      if (!other) continue;                       // dangling — keep, can't mirror
      if (isLinked(other, t.id)) continue;        // already symmetric
      if (!additions.has(otherId)) additions.set(otherId, new Set());
      additions.get(otherId).add(t.id);
    }
  }
  if (!additions.size) return list;

  return list.map(t => {
    const add = additions.get(t.id);
    if (!add) return t;
    return { ...t, linked_tools: [...normalizeLinkIds(t.linked_tools, t.id), ...add] };
  });
}

// The tools whose stored links this pass changed — what a caller persists.
export function toolsNeedingLinkRepair(before, after) {
  const out = [];
  for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) out.push(after[i]);
  return out;
}
