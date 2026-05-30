// Weighted similarity scoring for fuzzy-matching a job tool against the library.
// Scores are 0–100. Thresholds: ≥80 = likely match, 50–79 = possible match.

const WEIGHTS = {
  tool_type: 30,
  diameter: 20,
  number_of_flutes: 10,
  overall_length: 8,
  product_id: 12,
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
  score += WEIGHTS.product_id * stringSim(a.product_id, b.product_id);
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

export const MATCH_THRESHOLD_LIKELY = 80;
export const MATCH_THRESHOLD_POSSIBLE = 50;
