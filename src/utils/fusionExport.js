import { internalToFusionTool } from '../schema/toolSchema.js';

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
  const fusionTool = internalToFusionTool(tool);
  const safe = { ...fusionTool };
  delete safe._fusionRaw;
  downloadJSON({ data: [safe] }, `fusion_tool_${tool.proshot_id || tool.id}.json`);
}

export function exportFullLibrary(tools) {
  const fusionTools = tools.map(tool => {
    const f = internalToFusionTool(tool);
    delete f._fusionRaw;
    return f;
  });
  downloadJSON({ data: fusionTools }, 'fusion_tool_library.json');
}
