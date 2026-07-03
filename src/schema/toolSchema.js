// Public entry point for the tool schema. The implementation lives in focused
// sibling modules — this barrel re-exports everything so callers keep importing
// from './schema/toolSchema.js' unchanged:
//
//   identity.js         IDs, tracking IDs, family signature, machine numbers
//   extractorConvert.js extractor ↔ internal model, facet/required fields
//   combine.js          combineToolsByToolId (fold duplicate tool_ids)
//   holderGauge.js      holder gauge-length derivation + buildHolderObject
//   fusionConvert.js    fusionToolToInternal / internalToFusionTool
//   threads.js          thread-size lists, resolveThreadSize, tap tolerances
//   metadataModel.js    buildMetadataTool / mergeFusionAndMetadata
//   logicalTools.js     buildLogicalTool / splitToFusionInstances
//   toolFactory.js      newTool, validateTool, validateGeometry
//
// Schema modules must import from each other directly — never from this barrel
// (that would be a circular import).
import {
  TT, TL,
  MA, CO, WM,
  PS_GROUPS, AUTO_GROUP, typeFromProShopGroup, COOLANT_OPTS,
  getVisibleFields,
} from '../../tool-extractor.tsx';
import { FIELD_REGISTRY, fieldLabel } from './fieldRegistry.js';

export * from './identity.js';
export * from './extractorConvert.js';
export * from './combine.js';
export * from './holderGauge.js';
export * from './fusionConvert.js';
export * from './threads.js';
export * from './metadataModel.js';
export * from './logicalTools.js';
export * from './toolFactory.js';

export { TT, TL, MA, CO, WM, PS_GROUPS, AUTO_GROUP, typeFromProShopGroup, COOLANT_OPTS };

// ─── Icons ─────────────────────────────────────────────────────────────────
// Tool-type icons are rendered by the <ToolTypeIcon> component
// (src/components/icons/ToolTypeIcon.jsx) as solid-silhouette SVGs.

export const TOOL_TYPES = TT;
export const TOOL_TYPE_LABELS = TL;

// ─── Re-export getVisibleFields for components ────────────────────────────
export { getVisibleFields };

// ─── Human-readable field labels ──────────────────────────────────────────
// Generated from the field registry (the single source of truth for labels).
// Linear-unit suffixes are derived centrally by fieldLabel() at the shop default
// unit — to show a record's own unit (e.g. mm), call fieldLabel(field, unit)
// directly instead of reading this static map. Add/rename fields in the registry.
export const FIELD_LABELS = Object.fromEntries(
  Object.keys(FIELD_REGISTRY).map(name => [name, fieldLabel(name)])
);
