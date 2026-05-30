import { fusionToolToInternal } from '../schema/toolSchema.js';
import { matchTool } from './duplicateDetector.js';

let _qid = 0;
function qid() { return `q-${++_qid}-${Math.random().toString(36).slice(2, 5)}`; }

// Queue entry shape:
// {
//   id: string,
//   incomingTool: internal tool object,
//   status: 'pending' | 'matched' | 'new' | 'committed' | 'skipped',
//   matchedMasterTool: null | master tool object,
//   matchConfidence: null | 'exact' | 'fuzzy' | 'none',
//   matchMethod: null | 'product-id' | 'guid' | 'fuzzy' | 'manual' | 'none',
//   fuzzyCandidates: [],   // top fuzzy candidates for MatchStep
//   selectedFields: Set,   // filled at DiffStep
//   revisionNote: '',      // filled at CommitStep
//   isNewTool: false,
// }

export function parseIncoming(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Invalid JSON — check that you copied the full content.'); }

  const fusionTools = [];
  if (Array.isArray(parsed?.data)) {
    fusionTools.push(...parsed.data);
  } else if (Array.isArray(parsed)) {
    fusionTools.push(...parsed);
  } else if (parsed && (parsed.guid || parsed.type)) {
    fusionTools.push(parsed);
  } else {
    throw new Error('Unrecognized format. Expected a Fusion tool object, array, or library JSON.');
  }

  if (fusionTools.length === 0) throw new Error('No tools found in the pasted content.');
  return fusionTools.map(fusionToolToInternal);
}

export function buildQueue(internalTools, libraryTools) {
  return internalTools.map(tool => {
    const { tool: matched, confidence, method, candidates } = matchTool(tool, libraryTools);

    if (confidence === 'exact') {
      return {
        id: qid(),
        incomingTool: tool,
        status: 'matched',
        matchedMasterTool: matched,
        matchConfidence: 'exact',
        matchMethod: method,
        fuzzyCandidates: [],
        selectedFields: new Set(),
        revisionNote: '',
        isNewTool: false,
      };
    }

    if (confidence === 'fuzzy') {
      return {
        id: qid(),
        incomingTool: tool,
        status: 'pending',   // needs user confirmation via MatchStep
        matchedMasterTool: null,
        matchConfidence: 'fuzzy',
        matchMethod: method,
        fuzzyCandidates: candidates,
        selectedFields: new Set(),
        revisionNote: '',
        isNewTool: false,
      };
    }

    // No match → new tool
    return {
      id: qid(),
      incomingTool: tool,
      status: 'new',
      matchedMasterTool: null,
      matchConfidence: 'none',
      matchMethod: 'none',
      fuzzyCandidates: [],
      selectedFields: new Set(),
      revisionNote: '',
      isNewTool: true,
    };
  });
}

export function queueProgress(queue) {
  const done = queue.filter(e => e.status === 'committed' || e.status === 'skipped').length;
  const committed = queue.filter(e => e.status === 'committed').length;
  const skipped = queue.filter(e => e.status === 'skipped').length;
  return { total: queue.length, done, committed, skipped, remaining: queue.length - done };
}
