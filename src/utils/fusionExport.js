import { internalToFusionTool } from '../schema/toolSchema.js';

function toFusionFormat(tool) {
  const f = internalToFusionTool(tool);
  delete f._fusionRaw;
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

export function exportSingleTool(tool) {
  downloadJSON({ data: [toFusionFormat(tool)] }, `fusion_tool_${tool.proshot_id || tool.id}.json`);
}

export function exportFullLibrary(tools) {
  downloadJSON({ data: tools.map(toFusionFormat) }, 'fusion_tool_library.json');
}

export async function copyToolToClipboard(tool) {
  const json = JSON.stringify(toFusionFormat(tool), null, 2);
  await navigator.clipboard.writeText(json);
}

export async function copyToolsToClipboard(tools) {
  const json = JSON.stringify(tools.map(toFusionFormat), null, 2);
  await navigator.clipboard.writeText(json);
}
