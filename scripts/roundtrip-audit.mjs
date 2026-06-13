#!/usr/bin/env node
/**
 * Round-trip diff harness for the Fusion 360 tool library converters.
 *
 * For every tool in the reference exports (FUSION TOOL Library REF/), runs:
 *     fusionToolToInternal(raw)  →  internalToFusionTool(internal)
 * and deep-diffs the output against the original raw Fusion entry.
 *
 * Each diff is classified EXPECTED (intentional transformation, with a reason)
 * or UNEXPECTED (likely bug). Unexpected diffs are grouped by Fusion tool type.
 *
 * Usage:
 *     node scripts/roundtrip-audit.mjs              # summary (counts per type)
 *     node scripts/roundtrip-audit.mjs --verbose    # every unexpected diff
 *     node scripts/roundtrip-audit.mjs --type drill # restrict to one Fusion type
 *
 * Exit code is 1 when any unexpected diff is found, so this can run as a
 * regression test once the converters are clean.
 *
 * toolSchema.js imports from tool-extractor.tsx (JSX), so the module graph is
 * bundled in-memory with esbuild (a vite dependency) before importing.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF_DIR = join(ROOT, 'FUSION TOOL Library REF');

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const TYPE_FILTER = args.includes('--type') ? args[args.indexOf('--type') + 1] : null;

// ─── 1. Bundle toolSchema.js (handles the .tsx import) and load it ──────────
async function loadSchema() {
  const result = await build({
    entryPoints: [join(ROOT, 'src/schema/toolSchema.js')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    // react/lucide-react come along via tool-extractor's UI component (never
    // rendered here); they bundle fine under node, so no stubbing needed.
    logLevel: 'silent',
  });
  const dir = mkdtempSync(join(tmpdir(), 'rt-audit-'));
  const file = join(dir, 'schema.mjs');
  writeFileSync(file, result.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

// ─── 2. Deep diff ────────────────────────────────────────────────────────────
// Yields { path, kind: 'added'|'removed'|'changed', before, after }
function* deepDiff(before, after, path = '') {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (Array.isArray(before) && Array.isArray(after)) {
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) {
      if (i >= before.length) yield { path: `${path}[${i}]`, kind: 'added', after: after[i] };
      else if (i >= after.length) yield { path: `${path}[${i}]`, kind: 'removed', before: before[i] };
      else yield* deepDiff(before[i], after[i], `${path}[${i}]`);
    }
    return;
  }
  if (isObj(before) && isObj(after)) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in after)) yield { path: p, kind: 'removed', before: before[k] };
      else if (!(k in before)) yield { path: p, kind: 'added', after: after[k] };
      else yield* deepDiff(before[k], after[k], p);
    }
    return;
  }
  if (before !== after) yield { path, kind: 'changed', before, after };
}

// ─── 3. Expected-diff classification ────────────────────────────────────────
// Returns a reason string when the diff is an intentional/benign transformation.
const NUM_EXPR = /^(-?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*(in|mm|inpm|mmpm|fpm|m\/min|rpm|degrees)?$/;
function sameNumericExpression(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ma = a.trim().match(NUM_EXPR), mb = b.trim().match(NUM_EXPR);
  if (!ma || !mb) return false;
  return Math.abs(Number(ma[1]) - Number(mb[1])) < 1e-9 && (ma[2] || '') === (mb[2] || '');
}

function classifyExpected(d, raw) {
  const { path, kind, before, after } = d;
  if (path === 'last_modified') return 'last_modified regenerated on every write (by design)';
  if (path === 'reference_guid' && kind === 'removed' && before === '<NEW TOOL GUID>')
    return 'Fusion "<NEW TOOL GUID>" placeholder stripped (documented guid-minting fix)';
  if (kind === 'changed' && sameNumericExpression(before, after))
    return 'numeric expression reformatted, same value+unit (e.g. ".570000000 in" → "0.57 in")';
  if (/tool-coolant$/.test(path) && before === 'flood and through tool' && after === 'flood tool')
    return 'invalid coolant value remapped (documented)';
  if (kind === 'changed' && typeof before === 'number' && typeof after === 'number'
      && Math.abs(before - after) < 1e-9)
    return 'float formatting, numerically equal';
  // Fusion itself re-derives the root vendor from expressions.tool_vendor; the app
  // writes the derived value, making an inconsistent native pair consistent.
  if (path === 'vendor' && kind === 'changed' && raw.expressions?.tool_vendor != null
      && after === String(raw.expressions.tool_vendor).replace(/^'(.*)'$/, '$1'))
    return 'root vendor re-derived from expressions.tool_vendor (matches Fusion behavior)';
  if (kind === 'changed' && typeof before === 'string' && typeof after === 'string') {
    const strip = (s) => s.replace(/^'(.*)'$/, '$1').trim();
    if (strip(before) === strip(after))
      return 'whitespace-only normalization of a quoted string expression';
  }
  if ((path === 'post-process.diameter-offset' || path === 'post-process.length-offset')
      && kind === 'changed' && after === raw['post-process']?.number)
    return 'offsets follow machine tool number (documented app policy)';
  return null;
}

// ─── 4. Run ──────────────────────────────────────────────────────────────────
const { fusionToolToInternal, internalToFusionTool } = await loadSchema();

const files = ['Full_Type_List Examples.json', 'Special Cases.json'];
const perType = new Map();   // fusionType → { tools, toolsWithUnexpected, diffs: Map(signature → {count, examples}) }
let expectedTally = new Map();
let toolCount = 0, errorCount = 0;

// Signature: collapse per-tool noise (indices, values) so identical diff shapes aggregate.
const sig = (d) => `${d.kind} ${d.path.replace(/\[\d+\]/g, '[]')}`;

for (const f of files) {
  const lib = JSON.parse(readFileSync(join(REF_DIR, f), 'utf8'));
  for (const raw of lib.data) {
    if (TYPE_FILTER && raw.type !== TYPE_FILTER) continue;
    toolCount++;
    const entry = perType.get(raw.type) || { tools: 0, toolsWithUnexpected: 0, diffs: new Map() };
    entry.tools++;
    perType.set(raw.type, entry);
    let out;
    try {
      // JSON round-trip the output exactly as an upload would serialize it
      // (drops undefined-valued keys etc.).
      out = JSON.parse(JSON.stringify(internalToFusionTool(fusionToolToInternal(raw))));
    } catch (e) {
      errorCount++;
      const s = `THROWS: ${e.message}`;
      const rec = entry.diffs.get(s) || { count: 0, examples: [] };
      rec.count++;
      if (rec.examples.length < 2) rec.examples.push({ tool: raw.description, file: f });
      entry.diffs.set(s, rec);
      entry.toolsWithUnexpected++;
      continue;
    }
    let hadUnexpected = false;
    for (const d of deepDiff(raw, out)) {
      const reason = classifyExpected(d, raw);
      if (reason) { expectedTally.set(reason, (expectedTally.get(reason) || 0) + 1); continue; }
      hadUnexpected = true;
      const s = sig(d);
      const rec = entry.diffs.get(s) || { count: 0, examples: [] };
      rec.count++;
      if (rec.examples.length < 3) rec.examples.push({
        tool: raw.description, path: d.path,
        before: JSON.stringify(d.before)?.slice(0, 80), after: JSON.stringify(d.after)?.slice(0, 80),
      });
      entry.diffs.set(s, rec);
    }
    if (hadUnexpected) entry.toolsWithUnexpected++;
  }
}

// ─── 5. Report ───────────────────────────────────────────────────────────────
console.log(`\nRound-trip audit: ${toolCount} tools, ${errorCount} threw.\n`);
console.log('── EXPECTED diffs (allowlisted) ──');
for (const [reason, n] of [...expectedTally].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(5)}× ${reason}`);

let totalUnexpected = 0;
for (const [type, e] of [...perType].sort((a, b) => b[1].diffs.size - a[1].diffs.size)) {
  if (e.diffs.size === 0) continue;
  console.log(`\n── ${type} (${e.toolsWithUnexpected}/${e.tools} tools with unexpected diffs) ──`);
  for (const [s, rec] of [...e.diffs].sort((a, b) => b[1].count - a[1].count)) {
    totalUnexpected += rec.count;
    console.log(`  ${String(rec.count).padStart(4)}× ${s}`);
    if (VERBOSE) for (const ex of rec.examples)
      console.log(`        e.g. "${ex.tool}" ${ex.path ?? ''} ${ex.before ?? ''} → ${ex.after ?? ''}`);
  }
}
const cleanTypes = [...perType].filter(([, e]) => e.diffs.size === 0).map(([t]) => t);
if (cleanTypes.length) console.log(`\nClean types (no unexpected diffs): ${cleanTypes.join(', ')}`);
console.log(`\nTotal unexpected diffs: ${totalUnexpected}`);
process.exit(totalUnexpected > 0 || errorCount > 0 ? 1 : 0);
