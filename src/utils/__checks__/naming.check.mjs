// Lightweight runtime checks for the integrity-critical naming utilities.
// No test framework is configured, so this runs as a plain Node ESM script:
//   node src/utils/__checks__/naming.check.mjs
// It exits non-zero on the first failed assertion.

import assert from 'node:assert';
import { composePresetName, parsePresetName, presetMatchesAssembly, matchOpType, formatOoh, materialCategory } from '../presetNaming.js';
import { holderShortName } from '../holderNaming.js';

// Preset material category ("Filter by Type") — never blank
assert.equal(materialCategory(''), 'all');
assert.equal(materialCategory('SS'), 'metal');
assert.equal(materialCategory('ST'), 'metal');
assert.equal(materialCategory('PLASTIC'), 'plastic');

// Holder short name derivation
assert.equal(holderShortName('NBT30-SK13C-60'), '30-SK13-60');
assert.equal(holderShortName('NBT30-SK20C-90'), '30-SK20-90');
assert.equal(holderShortName('NBT30-SK13C-60 w/ER16 EXT 2.2OOH'), '30-SK13-60 w/ER16 EXT 2.2OOH');

// Compose → parse round trip
const name = composePresetName({ materialQuery: 'SS', ooh: 2.125, holderShort: '30-SK13-60', opType: 'rough' });
assert.equal(name, 'SS 2.125 30-SK13-60 - Rough');
const parsed = parsePresetName(name);
assert.equal(parsed.materialCode, 'SS');
assert.equal(parsed.ooh, 2.125);
assert.equal(parsed.holderShortName, '30-SK13-60');
assert.equal(parsed.opType, 'rough');

// OOH formatting + tolerance matching
assert.equal(formatOoh(2.125), '2.125');
assert.equal(presetMatchesAssembly({ name }, { holder_description: 'NBT30-SK13C-60', ooh: 2.1250004 }), true);
assert.equal(presetMatchesAssembly({ name }, { holder_description: 'NBT30-SK13C-60', ooh: 2.130 }), false);

// Operation aliases
assert.equal(matchOpType('Small Bore'), 'small_bore');
assert.equal(matchOpType('FIN'), 'finish');
assert.equal(matchOpType('R'), 'rough');
assert.equal(matchOpType('Finsh'), 'finish');

// Legacy bare-word preset names (no " - <Operation>" suffix) — whole-name
// fallback so normalization can auto-detect operation_type without prompting.
assert.equal(parsePresetName('Rough').opType, 'rough');
assert.equal(parsePresetName('R').opType, 'rough');
assert.equal(parsePresetName('Finish').opType, 'finish');
assert.equal(parsePresetName('FIN').opType, 'finish');
assert.equal(parsePresetName('F').opType, 'finish');
assert.equal(parsePresetName('Finsh').opType, 'finish');
assert.equal(parsePresetName('SM Bore').opType, 'small_bore');
assert.equal(parsePresetName('Small Bore').opType, 'small_bore');

console.log('naming.check.mjs: all assertions passed');
