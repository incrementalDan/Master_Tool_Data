import { internalToFusionTool } from '../schema/toolSchema.js';

function buildHolderObject(holderEntry) {
  if (!holderEntry) return null;
  return {
    description: holderEntry.description,
    guid: holderEntry.guid,
    'product-id': holderEntry['product-id'] || '',
    'product-link': holderEntry['product-link'] || '',
    vendor: holderEntry.vendor || '',
    gaugeLength: holderEntry.gaugeLength,
    unit: holderEntry.unit,
    segments: holderEntry.segments,
  };
}

// Build a Fusion-format tool object.
// assembly: optional assembly record — when provided, embeds its holder and writes
//           assembly-gauge-length (OOH). When absent, falls back to selected_holder_guid.
function toFusionFormat(tool, holders = [], assembly = null) {
  const f = internalToFusionTool(tool);
  delete f._fusionRaw;

  if (assembly) {
    const holder = holders.find(h => h.guid === assembly.holder_guid);
    if (holder) f.holder = buildHolderObject(holder);
    const ooh = tool.unit === 'millimeters' ? assembly.ooh * 25.4 : assembly.ooh;
    f['assembly-gauge-length'] = ooh;
  } else if (tool.selected_holder_guid && holders.length > 0) {
    const holder = holders.find(h => h.guid === tool.selected_holder_guid);
    if (holder) f.holder = buildHolderObject(holder);
  }

  return f;
}

function downloadJSON(content, filename) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportSingleTool(tool, holders = [], assembly = null) {
  downloadJSON({ data: [toFusionFormat(tool, holders, assembly)] }, `fusion_tool_${tool.proshot_id || tool.id}.json`);
}

export function exportFullLibrary(tools, holders = []) {
  // Full library export never uses per-tool assembly selection — uses selected_holder_guid only.
  downloadJSON({ data: tools.map(t => toFusionFormat(t, holders)) }, 'fusion_tool_library.json');
}

export async function copyToolToClipboard(tool, holders = [], assembly = null) {
  const json = JSON.stringify(toFusionFormat(tool, holders, assembly), null, 2);
  await navigator.clipboard.writeText(json);
}

export async function copyToolsToClipboard(tools, holders = []) {
  const json = JSON.stringify(tools.map(t => toFusionFormat(t, holders)), null, 2);
  await navigator.clipboard.writeText(json);
}
