window.PROSHOP_LABEL_CONFIG = {
  // Match EVERYTHING under /procnc/ (covers tools, ots, workorders, fixtures, parts/sequence, etc.)
  pageMatch: /\/procnc\//i,

  selectors: {
    toolNumber: '', description: '', edp: '', image: '',
    // optional: dedicated selector for the WO part picture
    workImage: '.part-images img, [alt*="Part"] img, .MuiCardMedia-root img',
    image: ''
  },

  // DK-11201 (3.5" × 1.1")
  label: { widthIn: 3.5, heightIn: 1.1 },

  // Tooling tag layout (2.2" tag area with a 0.25" footer band)
  tag: { widthIn: 2.2, footerIn: 0.25 },

  //Nudge ONLY the tool tag right/down a hair to avoid clipping
  printOffset: { leftIn: 0.04, topIn: 0.02 },

  // native bridge (off by default; you're using manual print)
  bridge: { host: 'com.apw.printbridge', printer: 'Brother QL-1110NWB', template_key: 'tool_storage_29x90', send: false },

  // position only — content.js sets button text dynamically
  button: { position: { right: '150px', bottom: '18px' } }
};
