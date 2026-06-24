// Weighted similarity scoring for fuzzy-matching a job tool against the library.
// Scores are 0–100. Thresholds: ≥80 = likely match, 50–79 = possible match.
//
// Matching priority (highest to lowest confidence):
//   1. tool_id exact match (Fusion's "product-id" field — stable ProShop number)
//   2. GUID exact match
//   3. Geometry fuzzy match (type + diameter + flutes + OAL + vendor + description)

const WEIGHTS = {
  tool_type: 30,
  diameter: 20,
  number_of_flutes: 10,
  overall_length: 8,
  tool_id: 12,   // secondary fuzzy signal (primary is exact match above)
  vendor: 10,
  description: 10,
};

function numericSim(a, b, tol = 0.001) {
  if (a == null || b == null || isNaN(Number(a)) || isNaN(Number(b))) return 0;
  const diff = Math.abs(Number(a) - Number(b));
  if (diff === 0) return 1;
  if (diff <= tol) return 0.9;
  if (diff <= tol * 10) return 0.5;
  if (diff <= tol * 100) return 0.2;
  return 0;
}

function stringSim(a, b) {
  if (!a || !b) return 0;
  const al = String(a).toLowerCase().trim();
  const bl = String(b).toLowerCase().trim();
  if (al === bl) return 1;
  if (al.includes(bl) || bl.includes(al)) return 0.6;
  const aw = new Set(al.split(/\W+/).filter(Boolean));
  const bw = bl.split(/\W+/).filter(Boolean);
  const shared = bw.filter(w => aw.has(w)).length;
  const total = Math.max(aw.size, bw.length);
  return total > 0 ? (shared / total) * 0.8 : 0;
}

export function scoreSimilarity(a, b) {
  let score = 0;
  score += WEIGHTS.tool_type * (a.tool_type === b.tool_type ? 1 : 0);
  score += WEIGHTS.diameter * numericSim(a.diameter, b.diameter, 0.001);
  score += WEIGHTS.number_of_flutes * (
    a.number_of_flutes != null && a.number_of_flutes === b.number_of_flutes ? 1 : 0
  );
  score += WEIGHTS.overall_length * numericSim(a.overall_length, b.overall_length, 0.01);
  score += WEIGHTS.tool_id * stringSim(a.tool_id, b.tool_id);
  score += WEIGHTS.vendor * stringSim(a.vendor, b.vendor);
  score += WEIGHTS.description * stringSim(a.description, b.description);
  return Math.min(100, Math.round(score));
}

export function findTopMatches(importedTool, libraryTools, maxResults = 3) {
  return libraryTools
    .map(tool => ({ tool, score: scoreSimilarity(importedTool, tool) }))
    .filter(s => s.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// Primary API: tries all match methods in priority order.
// Returns { tool, confidence, method, candidates }
// confidence: 'exact' | 'fuzzy' | 'none'
// method: 'product-id' | 'guid' | 'fuzzy' | 'none'
export function matchTool(incomingTool, libraryTools) {
  // 0. Tracking ID exact match (most reliable — the logical-tool family key).
  if (incomingTool.tracking_id) {
    const match = libraryTools.find(m => m.tracking_id && m.tracking_id === incomingTool.tracking_id);
    if (match) return { tool: match, confidence: 'exact', method: 'tracking-id', candidates: [] };
  }

  // 1. tool_id (Fusion product-id) exact match
  if (incomingTool.tool_id) {
    const match = libraryTools.find(
      m => m.tool_id && m.tool_id === incomingTool.tool_id
    );
    if (match) return { tool: match, confidence: 'exact', method: 'product-id', candidates: [] };
  }

  // 1b. Legacy ID match — the incoming ID is one this tool used to carry before a
  //     bulk re-number. Lets old job files / pasted tools still resolve to master.
  if (incomingTool.tool_id) {
    const match = libraryTools.find(
      m => Array.isArray(m.legacy_ids) && m.legacy_ids.includes(incomingTool.tool_id)
    );
    if (match) return { tool: match, confidence: 'exact', method: 'legacy-id', candidates: [] };
  }

  // 2. GUID exact match — the incoming job entry's guid is one of a logical
  //    tool's instance guids.
  if (incomingTool.id) {
    const match = libraryTools.find(m =>
      (m.assemblies || []).some(a => a.instance_guid === incomingTool.id) ||
      m.id === incomingTool.id
    );
    if (match) return { tool: match, confidence: 'exact', method: 'guid', candidates: [] };
  }

  // 3. Geometry fuzzy match
  const candidates = findTopMatches(incomingTool, libraryTools, 5);
  if (candidates.length > 0) {
    return {
      tool: candidates[0].tool,
      confidence: 'fuzzy',
      method: 'fuzzy',
      candidates,
    };
  }

  return { tool: null, confidence: 'none', method: 'none', candidates: [] };
}

export const MATCH_THRESHOLD_LIKELY = 80;
export const MATCH_THRESHOLD_POSSIBLE = 50;
