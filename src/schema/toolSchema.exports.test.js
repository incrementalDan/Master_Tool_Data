// Barrel surface lock. toolSchema.js re-exports nine modules via `export *`,
// and ESM has a nasty failure mode there: if two modules ever export the same
// name, the barrel drops it SILENTLY (ambiguous star exports resolve to
// nothing) — callers get `undefined` at runtime with no build error. This test
// pins the complete public surface as of the split, so a dropped or renamed
// export fails CI instead of surfacing as a runtime crash.
import { describe, it, expect } from 'vitest';
import * as schema from './toolSchema.js';

// Every name exported by toolSchema.js before the module split (verified
// against the pre-split file), plus writeups added since. Add new names here
// when a schema module gains a public export.
const EXPECTED_EXPORTS = [
  // tool-extractor re-exports
  'TT', 'TL', 'MA', 'CO', 'WM', 'PS_GROUPS', 'AUTO_GROUP',
  'typeFromProShopGroup', 'COOLANT_OPTS', 'getVisibleFields',
  'TOOL_TYPES', 'TOOL_TYPE_LABELS', 'FIELD_LABELS',
  // identity.js
  'generateId', 'generateAssemblyId', 'generateTrackingId', 'readTrackingId',
  'readOohFromFusion', 'familySignature', 'groupByTrackingId', 'stripQuotes',
  'RESERVED_MACHINE_NUMBERS', 'generateMachineNumbers', 'getNextMachineNumber',
  'applyToolIdToFusion', 'applyMachineNumberToFusion',
  // extractorConvert.js
  'getFacetFields', 'getRequiredFields', 'extractorToTool', 'toolToExtractor',
  // combine.js
  'combineToolsByToolId', 'duplicateIdClusters',
  // holderGauge.js
  'computeGaugeLength', 'buildGaugeLengthExpression', 'buildHolderObject',
  // fusionConvert.js
  'fusionToolToInternal', 'internalToFusionTool',
  // threads.js
  'INCH_THREAD_SIZES', 'METRIC_THREAD_SIZES', 'threadKey', 'resolveThreadSize',
  'TAP_LIMIT_TOLERANCE_OPTIONS_INCH', 'TAP_LIMIT_TOLERANCE_DEFAULT_INCH',
  'TAP_LIMIT_TOLERANCE_OPTIONS_METRIC', 'TAP_LIMIT_TOLERANCE_DEFAULT_METRIC',
  'CLASS_OF_FIT_OPTIONS', 'CLASS_OF_FIT_DEFAULT',
  // metadataModel.js
  'mergeFusionAndMetadata', 'buildMetadataTool',
  // logicalTools.js
  'buildLogicalTool', 'splitToFusionInstances', 'splitToFusionAndMetadata',
  // toolFactory.js
  'newTool', 'validateTool', 'validateGeometry',
];

describe('toolSchema barrel export surface', () => {
  it('exports every expected name (no silent drops from ambiguous export *)', () => {
    const missing = EXPECTED_EXPORTS.filter(name => schema[name] === undefined);
    expect(missing).toEqual([]);
  });

  it('has no unexpected disappearances of core function types', () => {
    // Spot-check that key exports are the right kind of thing, not just defined.
    expect(typeof schema.fusionToolToInternal).toBe('function');
    expect(typeof schema.internalToFusionTool).toBe('function');
    expect(typeof schema.buildLogicalTool).toBe('function');
    expect(typeof schema.splitToFusionInstances).toBe('function');
    expect(typeof schema.buildMetadataTool).toBe('function');
    expect(typeof schema.combineToolsByToolId).toBe('function');
    expect(Array.isArray(schema.TOOL_TYPES)).toBe(true);
  });
});
