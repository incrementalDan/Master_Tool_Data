#!/usr/bin/env node
/**
 * Render smoke test for the tool screens.
 *
 * `npm run build` only checks that the code PARSES — it does not catch a render
 * crash from an undefined variable, a bad prop, or a null access (those are valid
 * syntax that throw only when React renders the component). This server-renders
 * the edit form and the shared field renderer across every tool type so such
 * crashes surface here instead of as a blank screen in the browser.
 *
 *     node scripts/render-smoke.mjs        # exits non-zero on any render failure
 *
 * Components that need AppContext are given a minimal stub; this is a smoke test
 * (does it render at all), not a behavior test.
 */
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const TYPES = [
  'flat end mill', 'ball end mill', 'bull nose end mill', 'chamfer mill', 'tapered mill',
  'drill', 'spot drill', 'reamer', 'tap', 'thread mill', 'counter bore',
  'turning general', 'boring head', 'circle segment barrel', 'form mill',
];

const entry = `
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ToolForm = require('./src/components/ToolForm.jsx').default;
const ToolFields = require('./src/components/ToolFields.jsx').default;
const ToolTypeDropdown = require('./src/components/ToolTypeDropdown.jsx').default;

const TYPES = ${JSON.stringify(TYPES)};
// A tool with both a populated and a metric/STI/tap variant, to exercise the
// thread block, inclusive-angle transform, and unit formatting.
const mk = (t, i) => ({
  id: 'x', tool_type: t, unit: i % 2 ? 'millimeters' : 'inches', description: 'SMOKE ' + t,
  diameter: 0.5, flute_length: 1, overall_length: 3, number_of_flutes: 4, shank_diameter: 0.5,
  corner_radius: 0.03, taper_angle: 45, tip_angle: 135, tip_diameter: 0.1, min_ooh: 1.2,
  material: 'carbide', coating: 'AlTiN', cutting_direction: i % 2 ? 'Left Hand' : 'Right Hand',
  tsc_capable: true, custom_grind: i % 2 === 0, tags: ['a'], material_suitability: ['M', 'P'],
  machine_tool_number: 42, tap_sub_type: 'form', is_sti: true, tap_thread_unit: i % 2 ? 'metric' : 'inch',
  pitch: i % 2 ? 'M6 x 1.0' : '1/4-20 UNC', thread_pitch: 0.04, tap_class: '', class_of_fit: '',
  point_type: 'Plug', tip_to_first_thread: 0.1,
});

let failures = 0;
const run = (name, fn) => { try { fn(); } catch (e) { failures++; console.log('FAIL ' + name + ' :: ' + e.message); } };

TYPES.forEach((t, i) => {
  const tool = mk(t, i);
  // Also test the empty tool (no values) — the "stable positions" path.
  const empty = { id: 'e', tool_type: t, unit: 'inches', tags: [], material_suitability: [] };
  ['view', 'edit'].forEach(mode => {
    run('ToolFields ' + mode + ' ' + t, () =>
      renderToStaticMarkup(React.createElement(ToolFields, { tool, mode, setField: () => {}, geoIssueFields: new Set() })));
    run('ToolFields ' + mode + ' empty ' + t, () =>
      renderToStaticMarkup(React.createElement(ToolFields, { tool: empty, mode, setField: () => {}, geoIssueFields: new Set() })));
  });
  [false, true].forEach(isNew => {
    run('ToolForm ' + (isNew ? 'new ' : 'edit ') + t, () =>
      renderToStaticMarkup(React.createElement(ToolForm, { tool, onSave: () => {}, onCancel: () => {}, isSaving: false, isNew })));
  });
});
run('ToolTypeDropdown', () => renderToStaticMarkup(React.createElement(ToolTypeDropdown, { value: 'flat end mill', onChange: () => {} })));

if (failures) { console.log('\\n' + failures + ' render failure(s).'); process.exit(1); }
console.log('All ' + (TYPES.length * 4 + 1) + ' renders OK.');
`;

const result = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'js' },
  bundle: true, format: 'cjs', platform: 'node', write: false,
  jsx: 'automatic', loader: { '.js': 'jsx', '.jsx': 'jsx' },
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  logLevel: 'silent',
  plugins: [{
    name: 'stub-appctx',
    setup(b) {
      b.onResolve({ filter: /context\/AppContext\.jsx$/ }, () => ({ path: 'appctx', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const useApp = () => ({ tools: [{ machine_tool_number: 5 }] }); export default {};',
        loader: 'js',
      }));
    },
  }],
});

const tmp = resolve(ROOT, '.render-smoke.cjs');
writeFileSync(tmp, result.outputFiles[0].text);
try {
  createRequire(import.meta.url)(tmp);
} finally {
  unlinkSync(tmp);
}
