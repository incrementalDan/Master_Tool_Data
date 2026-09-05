import { buildDesc } from '../../utils/toolNaming.js';
import { toolToExtractor } from '../../schema/toolSchema.js';
import {
  withBetaSuffix, hasBetaSuffix,
  withRetiredSuffix, stripRetiredSuffix, stripStatusSuffixes,
} from '../../utils/toolStatus.js';

// What changes when the lifecycle status changes. Lifted out of ToolForm so the
// unified page's Identity section and the new-tool form apply the SAME rules —
// two copies of this would drift, and each of the three rules below exists for
// a reason that is not obvious from the code.
//
// ⚠️ Lives in the component layer, not utils/toolStatus.js, on purpose:
// toolNaming.js already imports toolStatus.js (for the RETIRED suffix), so
// putting this there would close an import cycle.
export function statusPatch(data, next) {
  const patch = { tool_status: next };

  // Leaving `retired` CLEARS the replacement — "replaced by X" is only
  // meaningful for a tool actually out of service, and a stale one would sit on
  // a tool nobody retired.
  if (next !== 'retired') patch.replaced_by = null;

  // RETIRED is applied and removed outright. The write path enforces the same
  // rule, so doing it here just means the form SHOWS what will be saved rather
  // than the marker appearing out of nowhere on the next load. Explicitly
  // granted exception to "descriptions are never silently renamed": Fusion has
  // nowhere else to carry the status, and a programmer picking tools for a new
  // job has to see it there.
  const desc = next === 'retired'
    ? withRetiredSuffix(data.description)
    : stripRetiredSuffix(data.description);
  if (desc !== data.description) patch.description = desc;

  // BETA stays OFFERED, not enforced: it rides along with a description the app
  // GENERATED, and is never stripped on the app's say-so (a prompt asks).
  if (next === 'beta') {
    const base = patch.description ?? data.description;
    // ⚠️ Compare with EVERY marker off both sides — toolToExtractor carries the
    // tool's CURRENT status, so buildDesc would otherwise re-append the marker
    // being changed and "did the app generate this?" would never be true.
    const generated = stripStatusSuffixes(buildDesc(toolToExtractor(data)));
    if (base && !hasBetaSuffix(base) && stripStatusSuffixes(base) === generated) {
      patch.description = withBetaSuffix(base);
    }
  }
  return patch;
}
