// Demo mode data + bootstrap.
//
// When the app is opened with `?demo=true` it skips all authentication and loads
// this bundled sample data instead of talking to Autodesk (APS) or Google Drive.
// It's meant for showing the UI off quickly — everything is read-only (no save
// path runs; see the localMode/demoMode guards in AppContext).
//
// The Fusion library entries here are real tools pulled from the shop's
// "FUSION TOOL Library REF/" reference files, trimmed to ~12 logical tools across
// the common tool types and tagged with FTL- tracking IDs. The metadata,
// materials, vendor registry and shop settings are hand-built minimal samples.
import demoFusionLibrary from './demo_fusion_library.json';
import demoMetadata from './demo_tool_metadata.json';
import demoHolders from './demo_holder_library.json';
import demoMaterials from './demo_materials.json';
import demoVendorRegistry from './demo_vendor_registry.json';
import demoShopSettings from './demo_shop_settings.json';
import demoJobs from './demo_jobs.json';
import demoComponents from './demo_components.json';
import { fusionHolderToRecord } from '../schema/holderRecord.js';
import { healHolderDescription, applyHealToRecord } from '../utils/holderDescription.js';
import { DEFAULT_HOLDER_CONFIG } from '../schema/holderOptions.js';

// True when the current URL requests demo mode (`?demo=true`). HashRouter puts
// the route after `#`, so the query lives in window.location.search as usual.
export function isDemoRequested() {
  try {
    return new URLSearchParams(window.location.search).get('demo') === 'true';
  } catch {
    return false;
  }
}

// Raw bundled data — AppContext builds the logical tools from these using the
// same pipeline (groupByTrackingId → buildLogicalTool → combineToolsByToolId)
// as a live load, so demo tools behave exactly like real ones.
export function getDemoData() {
  const fusionList = Array.isArray(demoFusionLibrary?.data) ? demoFusionLibrary.data : [];
  const metaList = Array.isArray(demoMetadata) ? demoMetadata : [];
  const holders = (Array.isArray(demoHolders?.data) ? demoHolders.data : [])
    .filter(h => h.type === 'holder');
  // The app-owned holder table, built from the same demo Fusion holders. In a
  // live shop this is the one-time import followed by a preview→commit heal;
  // demo is a throwaway sandbox, so it runs both up front to show the page with
  // classified records. It seeds against DEFAULT_HOLDER_CONFIG because the
  // option UUIDs are minted at module load and can't live in a static JSON.
  const holderRecords = holders.map(h =>
    applyHealToRecord(
      fusionHolderToRecord(h, { library_id: 'demo', library_name: 'Demo holders' }),
      healHolderDescription(h.description, DEFAULT_HOLDER_CONFIG),
    ));

  return {
    fusionList,
    metaList,
    holders,
    holderLibrary: { version: 1, holders: holderRecords },
    materials: demoMaterials,
    vendorRegistry: demoVendorRegistry,
    shopSettings: demoShopSettings,
    jobs: demoJobs,
    components: demoComponents,
  };
}
