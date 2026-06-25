// Location system helpers — resolves tool_location IDs against the
// shop's location_system config stored in shop_settings.json.
//
// Hierarchy: Zone → Station → Drawer → Bin
// Each level links to its parent via a parent-id field:
//   station.zone_id, drawer.station_id, bin.drawer_id
//
// tool_location stores four nullable IDs:
//   { zone_id, station_id, drawer_id, bin_id }
// Only the most-specific assigned level should be non-null; more-general
// levels are derived. The redundant IDs are stored for easy filtering at
// any level without traversing the hierarchy at query time.
//
// Empty location_system: { zones: [], stations: [], drawers: [], bins: [] }

export function findZone(ls, id) {
  return ls?.zones?.find(z => z.id === id) || null;
}
export function findStation(ls, id) {
  return ls?.stations?.find(s => s.id === id) || null;
}
export function findDrawer(ls, id) {
  return ls?.drawers?.find(d => d.id === id) || null;
}
export function findBin(ls, id) {
  return ls?.bins?.find(b => b.id === id) || null;
}

export function stationsForZone(ls, zoneId) {
  return (ls?.stations || []).filter(s => s.zone_id === zoneId);
}
export function drawersForStation(ls, stationId) {
  return (ls?.drawers || []).filter(d => d.station_id === stationId);
}
export function binsForDrawer(ls, drawerId) {
  return (ls?.bins || []).filter(b => b.drawer_id === drawerId);
}

// Resolve labels for each assigned level in tool_location.
// Returns { zone, station, drawer, bin } where each is the label
// string or null when that level is not assigned.
export function resolveLocationLabels(toolLocation, ls) {
  if (!toolLocation) return { zone: null, station: null, drawer: null, bin: null };
  const zoneRec    = toolLocation.zone_id    ? findZone(ls, toolLocation.zone_id)       : null;
  const stationRec = toolLocation.station_id ? findStation(ls, toolLocation.station_id) : null;
  const drawerRec  = toolLocation.drawer_id  ? findDrawer(ls, toolLocation.drawer_id)   : null;
  const binRec     = toolLocation.bin_id     ? findBin(ls, toolLocation.bin_id)         : null;
  return {
    zone:    zoneRec    ? zoneRec.label                    : null,
    station: stationRec ? stationRec.label                 : null,
    drawer:  drawerRec  ? drawerRec.label                  : null,
    bin:     binRec     ? String(binRec.slot_number)       : null,
  };
}

// Compose the short display / Fusion-vendor string from a tool_location.
// Uses the deepest assigned levels, joined with " / ".
// e.g. zone "LC" + station "LC-01" + drawer "D1" → "LC / LC-01 / D1"
export function composeLocationString(toolLocation, ls) {
  if (!toolLocation) return '';
  const { zone, station, drawer, bin } = resolveLocationLabels(toolLocation, ls);
  const parts = [zone, station, drawer, bin ? `Bin ${bin}` : null].filter(Boolean);
  return parts.join(' / ');
}

// Given a bin record, return a tool_location with all parent IDs filled in.
export function locationFromBin(ls, bin) {
  if (!bin) return null;
  const drawer  = findDrawer(ls, bin.drawer_id);
  const station = drawer ? findStation(ls, drawer.station_id) : null;
  const zone    = station ? findZone(ls, station.zone_id) : null;
  return {
    zone_id:    zone    ? zone.id    : null,
    station_id: station ? station.id : null,
    drawer_id:  drawer  ? drawer.id  : null,
    bin_id:     bin.id,
  };
}

// Given a drawer record, return a tool_location with parent IDs filled in.
export function locationFromDrawer(ls, drawer) {
  if (!drawer) return null;
  const station = findStation(ls, drawer.station_id);
  const zone    = station ? findZone(ls, station.zone_id) : null;
  return {
    zone_id:    zone    ? zone.id    : null,
    station_id: station ? station.id : null,
    drawer_id:  drawer.id,
    bin_id:     null,
  };
}

// Given a station record, return a tool_location with parent IDs filled in.
export function locationFromStation(ls, station) {
  if (!station) return null;
  const zone = findZone(ls, station.zone_id);
  return {
    zone_id:    zone ? zone.id : null,
    station_id: station.id,
    drawer_id:  null,
    bin_id:     null,
  };
}

// Given a zone record, return a tool_location for zone-only assignment.
export function locationFromZone(zone) {
  if (!zone) return null;
  return { zone_id: zone.id, station_id: null, drawer_id: null, bin_id: null };
}

// An empty tool_location (no level assigned).
export const EMPTY_TOOL_LOCATION = {
  zone_id: null, station_id: null, drawer_id: null, bin_id: null,
};

// Resolve which parent IDs to fill on the tool given what the picker selected.
// level is 'zone' | 'station' | 'drawer' | 'bin' | null (clear).
export function buildToolLocation(ls, level, id) {
  if (!level || !id) return EMPTY_TOOL_LOCATION;
  switch (level) {
    case 'zone':    return locationFromZone(findZone(ls, id));
    case 'station': return locationFromStation(ls, findStation(ls, id));
    case 'drawer':  return locationFromDrawer(ls, findDrawer(ls, id));
    case 'bin':     return locationFromBin(ls, findBin(ls, id));
    default:        return EMPTY_TOOL_LOCATION;
  }
}

// Apply resolved location string to a tool object, if tool_location is set.
// Used as a pre-write step in AppContext so internalToFusionTool sees the
// correct `location` string without needing access to locationSystem itself.
export function withResolvedLocation(tool, ls) {
  const tl = tool.tool_location;
  if (!tl || (!tl.zone_id && !tl.station_id && !tl.drawer_id && !tl.bin_id)) return tool;
  return { ...tool, location: composeLocationString(tl, ls) };
}
