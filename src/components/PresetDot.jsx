import { presetMaterialColor } from '../utils/presetNaming.js';

// A small colored dot for a preset, tinted by its material's group color from
// the Materials library (materials.json). Renders nothing when the material is
// unknown or its group has no color — safe to drop in front of any preset chip.
export function PresetDot({ query, materials }) {
  const color = presetMaterialColor(query, materials);
  if (!color) return null;
  return (
    <span
      aria-hidden="true"
      style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', marginRight: 5, flexShrink: 0 }}
    />
  );
}
