// ToolDex UI kit — inline lucide icons (the app uses lucide-react). Stroke
// currentColor, 2px, rounded. Exported to window for the other kit scripts.
const I = (paths, vb = '24') => ({ size = 16, strokeWidth = 2, style } = {}) =>
  React.createElement('svg', {
    width: size, height: size, viewBox: `0 0 ${vb} ${vb}`, fill: 'none',
    stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', style,
  }, paths.map((d, i) => React.createElement('path', { key: i, d })));

const IconCircle = (children, extra = []) => ({ size = 16, strokeWidth = 2, style } = {}) =>
  React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', style,
  }, [React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 10 }), ...children]);

window.KitIcons = {
  Wrench: I(['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2 2.8-2.8z']),
  Library: I(['M12 7v14', 'M16 12h2', 'M16 8h2', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z']),
  Flask: I(['M10 2v7.31', 'M14 9.3V1.99', 'M8.5 2h7', 'M14 9.3a6.5 6.5 0 1 1-4 0', 'M5.52 16h12.96']),
  Building: I(['M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z', 'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2', 'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2', 'M10 6h4', 'M10 10h4', 'M10 14h4', 'M10 18h4']),
  Settings: I(['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z']),
  Refresh: I(['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5']),
  GitMerge: I(['M6 21V9', 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M6 9a9 9 0 0 0 9 9']),
  Plus: I(['M5 12h14', 'M12 5v14']),
  Grid: I(['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z']),
  List: I(['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01']),
  ChevronLeft: I(['M15 18l-6-6 6-6']),
  Pencil: I(['M21.17 6.83a2.83 2.83 0 0 0-4-4L3 17v4h4z', 'M15 5l4 4']),
  Copy: I(['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2', 'M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v0']),
  Download: I(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']),
  Upload: I(['M12 13v8', 'M4 17.5A4.5 4.5 0 0 1 5.5 9 6 6 0 0 1 17 7a4.5 4.5 0 0 1 2 8.5', 'M16 16l-4-4-4 4']),
  X: I(['M18 6 6 18', 'M6 6l12 12']),
  Trash: I(['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6']),
};
