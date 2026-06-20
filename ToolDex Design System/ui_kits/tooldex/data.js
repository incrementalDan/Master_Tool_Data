// ToolDex UI kit — sample library data (fake, representative of a real shop).
// Field names mirror the product's tool schema so ToolCard/DataBadge read them.
window.TOOLDEX_TOOLS = [
  {
    id: 't1', tool_type: 'drill', description: 'PS D-53 5/16 Carbide Drill 1.693 LOC',
    proshop_id: 'D-53', machine_tool_number: 4, diameter: 0.3125, number_of_flutes: 2,
    flute_length: 1.693, vendor: 'Guhring', coating: 'TiAlN', location: 'CAB-2 · B3', unit: 'in',
    overall_length: 3.386, shank: 0.3125, point_angle: 140,
    assemblies: [{ holder_description: 'NBT30-SK20C-60', ooh: 1.500 }],
    presets: [
      { name: 'AL 1.500 30-SK20-60 - Drill', material: 'Aluminum' },
      { name: 'SS 1.500 30-SK20-60 - Drill', material: '304 Stainless' },
    ],
  },
  {
    id: 't2', tool_type: 'flat end mill', description: '1/2" 3FL AlTiN Rougher',
    proshop_id: 'A-12', machine_tool_number: 7, diameter: 0.5, number_of_flutes: 3,
    flute_length: 1.25, vendor: 'Helical', coating: 'AlTiN', preferred_machine: 'VF-2',
    location: 'CAB-1 · A2', unit: 'in', overall_length: 3.0, shank: 0.5,
    assemblies: [{ holder_description: 'NBT30-SK13C-90', ooh: 1.625 }],
    presets: [
      { name: 'AL 1.625 30-SK13-90 - Rough', material: 'Aluminum' },
      { name: 'AL 1.625 30-SK13-90 - Finish', material: 'Aluminum' },
      { name: 'P 1.625 30-SK13-90 - Rough', material: '4140 Alloy Steel' },
    ],
  },
  {
    id: 't3', tool_type: 'ball end mill', description: '1/4" 4FL Ball — Finishing',
    proshop_id: 'B-07', machine_tool_number: 2, diameter: 0.25, number_of_flutes: 4,
    flute_length: 0.75, vendor: 'Harvey Tool', coating: 'AlTiN', location: 'CAB-1 · A5', unit: 'in',
    overall_length: 2.5, shank: 0.25,
    assemblies: [{ holder_description: 'NBT30-SK13C-120', ooh: 2.000 }],
    presets: [
      { name: 'SS 2.000 30-SK13-120 - Fine Finish', material: '316 Stainless' },
      { name: 'TI 2.000 30-SK13-120 - Finish', material: 'Titanium' },
    ],
  },
  {
    id: 't4', tool_type: 'tap', description: '1/4-20 Spiral Flute Tap',
    proshop_id: 'T-18', machine_tool_number: 11, diameter: 0.25, vendor: 'OSG',
    coating: 'Bright', location: 'CAB-3 · C1', unit: 'in', overall_length: 2.5,
    assemblies: [{ holder_description: 'DRILL CHUCK', ooh: 1.250 }],
    presets: [{ name: 'AL 1.250 DRILL CHUCK - Tap', material: 'Aluminum' }],
  },
  {
    id: 't5', tool_type: 'face mill', description: '2" 5-Insert Face Mill',
    proshop_id: 'F-02', machine_tool_number: 1, diameter: 2.0, number_of_flutes: 5,
    vendor: 'Sandvik', location: 'SHELF · D', unit: 'in', overall_length: 1.75,
    assemblies: [{ holder_description: 'NBT30-SK20C-90', ooh: 1.000 }],
    presets: [
      { name: 'P 1.000 30-SK20-90 - Face', material: '1045 Steel' },
      { name: 'K 1.000 30-SK20-90 - Face', material: 'Gray Cast Iron' },
    ],
  },
  {
    id: 't6', tool_type: 'chamfer mill', description: '1/2" 90° Chamfer Mill',
    proshop_id: 'C-04', machine_tool_number: 6, diameter: 0.5, number_of_flutes: 4,
    vendor: 'Lakeshore', coating: 'TiN', location: 'CAB-1 · A3', unit: 'in', overall_length: 2.5,
    assemblies: [{ holder_description: 'NBT30-SK13C-60', ooh: 1.375 }],
    presets: [{ name: 'AL 1.375 30-SK13-60 - Chamfer', material: 'Aluminum' }],
  },
  {
    id: 't7', tool_type: 'spot drill', description: '1/2" 90° Spot Drill',
    proshop_id: 'D-22', machine_tool_number: 5, diameter: 0.5, number_of_flutes: 2,
    vendor: 'Guhring', coating: 'TiAlN', location: 'CAB-2 · B1', unit: 'in', overall_length: 2.5,
    assemblies: [{ holder_description: 'NBT30-SK20C-60', ooh: 1.200 }],
    presets: [{ name: 'P 1.200 30-SK20-60 - Spot', material: 'A36 Steel' }],
  },
  {
    id: 't8', tool_type: 'bull nose end mill', description: '3/8" Bull .060R 4FL',
    proshop_id: 'A-31', machine_tool_number: 8, diameter: 0.375, number_of_flutes: 4,
    flute_length: 1.0, vendor: 'Helical', coating: 'AlTiN', corner_radius: 0.06,
    location: 'CAB-1 · A2', unit: 'in', overall_length: 2.5,
    assemblies: [{ holder_description: 'NBT30-SK13C-90', ooh: 1.500 }],
    presets: [
      { name: 'AL 1.500 30-SK13-90 - Rough', material: 'Aluminum' },
      { name: 'SS 1.500 30-SK13-90 - Rough', material: '304 Stainless' },
    ],
  },
  {
    id: 't9', tool_type: 'reamer', description: '0.250 Chucking Reamer',
    proshop_id: 'R-09', machine_tool_number: 12, diameter: 0.25, number_of_flutes: 6,
    vendor: 'Guhring', location: 'CAB-3 · C2', unit: 'in', overall_length: 3.0,
    assemblies: [{ holder_description: 'DRILL CHUCK', ooh: 1.500 }],
    presets: [{ name: 'P 1.500 DRILL CHUCK - Ream', material: '4140 Alloy Steel' }],
  },
  {
    id: 't10', tool_type: 'ball end mill', description: '1/8" 2FL Ball Micro',
    proshop_id: 'B-15', machine_tool_number: 3, diameter: 0.125, number_of_flutes: 2,
    flute_length: 0.5, vendor: 'Harvey Tool', coating: 'AlTiN', location: 'CAB-1 · A6', unit: 'in',
    overall_length: 1.5,
    assemblies: [{ holder_description: 'NBT30-SK13C-150', ooh: 2.250 }],
    presets: [{ name: 'TI 2.250 30-SK13-150 - Fine Finish', material: 'Titanium' }],
  },
  {
    id: 't11', tool_type: 'counter sink', description: '82° Countersink 1/2"',
    proshop_id: 'CS-01', machine_tool_number: 9, diameter: 0.5, number_of_flutes: 3,
    vendor: 'KEO', location: 'CAB-2 · B4', unit: 'in', overall_length: 2.25,
    assemblies: [{ holder_description: 'NBT30-SK13C-60', ooh: 1.100 }],
    presets: [{ name: 'AL 1.100 30-SK13-60 - C-Sink', material: 'Aluminum' }],
  },
  {
    id: 't12', tool_type: 'thread mill', description: '3/8-16 Single-Profile Thread Mill',
    proshop_id: 'TM-03', machine_tool_number: 10, diameter: 0.3, number_of_flutes: 3,
    vendor: 'Vargus', coating: 'TiAlN', location: 'CAB-3 · C3', unit: 'in', overall_length: 2.5,
    assemblies: [{ holder_description: 'NBT30-SK13C-90', ooh: 1.400 }],
    presets: [{ name: 'SS 1.400 30-SK13-90 - Thread', material: '316 Stainless' }],
  },
];
